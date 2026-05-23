const Booking = require("../models/Booking");
const Business = require("../models/Business");
const BusinessService = require("../models/BusinessService");
const { REALTIME_EVENTS, emitHotelRealtime, emitRealtime, emitUserRealtime } = require("../utils/realtime");
const { normalizePriceModel, normalizeServiceSchedule } = require("../services/marketplaceService");
const { clearCache } = require("../utils/cache");

const ensureBusinessOwner = (req, res) => {
  if (!req.user?.hotelId) {
    res.status(400).json({ message: "Business owner is not linked to a business." });
    return null;
  }
  return req.user.hotelId;
};

const getMyHotelOverview = async (req, res) => {
  try {
    const businessId = ensureBusinessOwner(req, res);
    if (!businessId) return;

    const [business, services, bookings] = await Promise.all([
      Business.findById(businessId),
      BusinessService.find({ businessId }).sort({ createdAt: -1 }),
      Booking.find({ businessId }).sort({ createdAt: -1 }),
    ]);

    if (!business) return res.status(404).json({ message: "Business not found." });

    const activeServices = services.filter((service) => service.isActive !== false);
    const availableQuantity = services.reduce(
      (sum, service) => sum + Number(service.availableQuantity || 0),
      0
    );

    return res.json({
      hotel: business,
      business,
      services,
      stats: {
        totalServices: services.length,
        activeServices: activeServices.length,
        bookings: bookings.length,
        totalBookings: bookings.length,
        availableQuantity,
        revenue: bookings.reduce((sum, booking) => sum + Number(booking.totalPrice || 0), 0),
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch business overview.", error: error.message });
  }
};

const listMyBookings = async (req, res) => {
  try {
    const businessId = ensureBusinessOwner(req, res);
    if (!businessId) return;

    const bookings = await Booking.find({ businessId })
      .populate("userId touristId", "name email phone")
      .populate("serviceId", "title name category pricing")
      .sort({ createdAt: -1 });

    return res.json({ bookings });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch business bookings.", error: error.message });
  }
};

const listMyServices = async (req, res) => {
  try {
    const businessId = ensureBusinessOwner(req, res);
    if (!businessId) return;

    const services = await BusinessService.find({ businessId }).sort({ category: 1, title: 1 });
    return res.json({ services });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch business services.", error: error.message });
  }
};

const updateBookingStatus = async (req, res) => {
  try {
    const businessId = ensureBusinessOwner(req, res);
    if (!businessId) return;

    const { bookingId } = req.params;
    const { status } = req.body;
    const allowedStatuses = ["pending", "confirmed", "active", "cancelled", "completed"];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: `status must be one of: ${allowedStatuses.join(", ")}.` });
    }

    const booking = await Booking.findOne({ _id: bookingId, businessId });
    if (!booking) return res.status(404).json({ message: "Booking not found." });

    booking.status = status;
    booking.bookingStatus = status;
    await booking.save();

    const payload = {
      action: "status-updated",
      bookingId: booking._id,
      bookingCode: booking.bookingCode,
      businessId,
      serviceId: booking.serviceId,
      status,
    };
    emitRealtime("bookingStatusChanged", payload);
    emitHotelRealtime(businessId, REALTIME_EVENTS.BOOKING_CHANGED, payload);
    emitUserRealtime(booking.userId || booking.touristId, REALTIME_EVENTS.BOOKING_CHANGED, payload);

    return res.json({ message: "Booking status updated successfully.", booking });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update booking status.", error: error.message });
  }
};

const upsertMyService = async (req, res) => {
  try {
    const businessId = ensureBusinessOwner(req, res);
    if (!businessId) return;

    const { serviceId } = req.params;
    const { category, serviceType, name, title, description } = req.body;
    const serviceTitle = String(title || name || "").trim();
    if (!category || !serviceTitle) {
      return res.status(400).json({ message: "category and title are required." });
    }

    const payload = {
      businessId,
      hotelId: businessId,
      category: String(category).trim(),
      serviceType: String(serviceType || category || "rental").trim(),
      title: serviceTitle,
      name: serviceTitle,
      description: String(description || "").trim(),
      images: Array.isArray(req.body.images) ? req.body.images : [],
      pricing: {
        amount: Number(req.body.pricing?.amount ?? req.body.priceModel?.amount ?? 0),
        unit: String(req.body.pricing?.unit || req.body.priceModel?.unit || "per_day").trim(),
        currency: String(req.body.pricing?.currency || req.body.priceModel?.currency || "USD").trim(),
      },
      priceText: String(req.body.priceText || req.body.price || "").trim(),
      availableQuantity: Math.max(0, Number(req.body.availableQuantity ?? req.body.availabilitySchedule?.inventory ?? 1)),
      features: Array.isArray(req.body.features) ? req.body.features : [],
      location: String(req.body.location || "").trim(),
      status: String(req.body.status || "available").trim(),
      rules: Array.isArray(req.body.rules) ? req.body.rules : [],
      cancellationPolicy: String(req.body.cancellationPolicy || "").trim(),
      priceModel: normalizePriceModel(req.body.priceModel),
      availabilitySchedule: normalizeServiceSchedule(req.body.availabilitySchedule),
      bookingIntegration: {
        bookableWithReservation: req.body.bookingIntegration?.bookableWithReservation !== false,
        requiresSeparateConfirmation: Boolean(req.body.bookingIntegration?.requiresSeparateConfirmation),
        providerReference: String(req.body.bookingIntegration?.providerReference || "").trim(),
      },
      isActive: req.body.isActive !== false,
    };

    const service = serviceId
      ? await BusinessService.findOneAndUpdate({ _id: serviceId, businessId }, payload, { new: true, runValidators: true })
      : await BusinessService.create(payload);

    if (!service) return res.status(404).json({ message: "Service not found." });

    const updatePayload = {
      action: serviceId ? "updated" : "created",
      serviceId: service._id,
      businessId,
      availableQuantity: service.availableQuantity,
      status: service.status,
    };
    emitRealtime("serviceUpdated", service);
    emitHotelRealtime(businessId, REALTIME_EVENTS.SERVICE_CHANGED, updatePayload);
    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "service-saved", businessId });
    clearCache("public:");

    return res.json({
      message: serviceId ? "Service updated successfully." : "Service created successfully.",
      service,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to save service.", error: error.message });
  }
};

const deleteService = async (req, res) => {
  try {
    const businessId = ensureBusinessOwner(req, res);
    if (!businessId) return;

    const { serviceId } = req.params;
    const deleted = await BusinessService.findOneAndDelete({ _id: serviceId, businessId });
    if (!deleted) return res.status(404).json({ message: "Service not found." });

    emitHotelRealtime(businessId, REALTIME_EVENTS.SERVICE_CHANGED, {
      action: "deleted",
      serviceId: deleted._id,
      businessId,
    });
    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "service-deleted", businessId });
    clearCache("public:");

    return res.json({ message: "Service deleted successfully." });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete service.", error: error.message });
  }
};

module.exports = {
  getMyHotelOverview,
  listMyBookings,
  listMyServices,
  updateBookingStatus,
  upsertMyService,
  deleteService,
};
