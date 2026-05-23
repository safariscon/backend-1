const Business = require("../models/Business");
const BusinessService = require("../models/BusinessService");
const Booking = require("../models/Booking");
const { REALTIME_EVENTS, emitRealtime, emitHotelRealtime } = require("../utils/realtime");

const ALLOWED_UNITS = new Set([
  "per_hour",
  "per_day",
  "per_night",
  "per_person",
  "per_plate",
  "per_bottle",
  "per_trip",
  "per_event",
  "per_session",
]);

const normalizeServicePayload = (body, businessId) => {
  const pricingUnit = String(body.pricing?.unit || body.priceModel?.unit || "per_day").trim();
  return {
    businessId,
    hotelId: businessId,
    title: String(body.title || body.name || "").trim(),
    name: String(body.title || body.name || "").trim(),
    description: String(body.description || "").trim(),
    serviceType: String(body.serviceType || body.category || "rental").trim(),
    category: String(body.category || body.serviceType || "rental").trim(),
    pricing: {
      amount: Number(body.pricing?.amount ?? body.priceModel?.amount ?? 0),
      unit: ALLOWED_UNITS.has(pricingUnit) ? pricingUnit : "per_day",
      currency: String(body.pricing?.currency || body.priceModel?.currency || "USD").trim(),
    },
    priceText: String(body.priceText || body.price || "").trim(),
    availableQuantity: Math.max(0, Number(body.availableQuantity ?? 1)),
    status: String(body.status || "available").trim(),
    images: Array.isArray(body.images) ? body.images : [],
    location: String(body.location || "").trim(),
    rules: Array.isArray(body.rules) ? body.rules : [],
    cancellationPolicy: String(body.cancellationPolicy || "").trim(),
    isActive: body.isActive !== false,
  };
};

const listServices = async (req, res) => {
  try {
    const filter = { isActive: true };
    if (req.query.serviceType) filter.serviceType = req.query.serviceType;
    if (req.query.category) filter.category = req.query.category;
    if (req.query.businessId) filter.businessId = req.query.businessId;

    const services = await BusinessService.find(filter)
      .populate("businessId", "businessName name businessType location verificationStatus")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ services });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch services.", error: error.message });
  }
};

const getService = async (req, res) => {
  try {
    const service = await BusinessService.findById(req.params.serviceId)
      .populate("businessId", "businessName name businessType location verificationStatus phone email")
      .lean();
    if (!service) return res.status(404).json({ message: "Service not found." });
    return res.json({ service });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch service.", error: error.message });
  }
};

const createService = async (req, res) => {
  try {
    const businessId = req.user?.hotelId || req.body.businessId;
    if (!businessId) return res.status(400).json({ message: "Business owner is not linked to a business." });

    const business = await Business.findById(businessId);
    if (!business) return res.status(404).json({ message: "Business not found." });
    if (req.user.role !== "admin" && String(business.ownerId || "") !== String(req.user._id)) {
      return res.status(403).json({ message: "Only the business owner can create services." });
    }

    const payload = normalizeServicePayload(req.body, business._id);
    if (!payload.title) return res.status(400).json({ message: "Service title is required." });
    const service = await BusinessService.create(payload);

    emitRealtime("serviceUpdated", service);
    emitHotelRealtime(business._id, REALTIME_EVENTS.SERVICE_CHANGED, { action: "created", serviceId: service._id, businessId: business._id });
    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "service-created" });
    return res.status(201).json({ message: "Service created successfully.", service });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create service.", error: error.message });
  }
};

const updateService = async (req, res) => {
  try {
    const service = await BusinessService.findById(req.params.serviceId);
    if (!service) return res.status(404).json({ message: "Service not found." });

    const business = await Business.findById(service.businessId);
    if (!business) return res.status(404).json({ message: "Business not found." });
    if (req.user.role !== "admin" && String(business.ownerId || "") !== String(req.user._id)) {
      return res.status(403).json({ message: "Only the business owner can edit this service." });
    }

    Object.assign(service, normalizeServicePayload(req.body, business._id));
    await service.save();

    emitRealtime("serviceUpdated", service);
    emitHotelRealtime(business._id, REALTIME_EVENTS.SERVICE_CHANGED, { action: "updated", serviceId: service._id, businessId: business._id });
    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "service-updated" });
    return res.json({ message: "Service updated successfully.", service });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update service.", error: error.message });
  }
};

const deleteService = async (req, res) => {
  try {
    const service = await BusinessService.findById(req.params.serviceId);
    if (!service) return res.status(404).json({ message: "Service not found." });

    const business = await Business.findById(service.businessId);
    if (req.user.role !== "admin" && String(business?.ownerId || "") !== String(req.user._id)) {
      return res.status(403).json({ message: "Only the business owner can delete this service." });
    }

    const activeBookings = await Booking.countDocuments({
      serviceId: service._id,
      status: { $in: ["pending", "confirmed", "active"] },
    });
    if (activeBookings > 0) {
      return res.status(409).json({ message: "This service has active bookings and cannot be deleted." });
    }

    await BusinessService.deleteOne({ _id: service._id });
    emitRealtime("serviceUpdated", { action: "deleted", serviceId: service._id });
    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "service-deleted" });
    return res.json({ message: "Service deleted successfully." });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete service.", error: error.message });
  }
};

module.exports = {
  listServices,
  getService,
  createService,
  updateService,
  deleteService,
};
