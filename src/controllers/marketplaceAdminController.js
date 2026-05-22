const Booking = require("../models/Booking");
const Business = require("../models/Business");
const BusinessService = require("../models/BusinessService");
const Room = require("../models/Room");
const Supplier = require("../models/Supplier");
const {
  buildAnalyticsSummary,
  buildSupplierPayload,
  normalizeBookingRules,
  normalizePriceModel,
  normalizeServiceSchedule,
} = require("../services/marketplaceService");
const {
  REALTIME_EVENTS,
  emitHotelRealtime,
  emitRealtime,
  emitUserRealtime,
} = require("../utils/realtime");

const getMarketplaceOverview = async (_req, res) => {
  try {
    const [suppliers, bookings, rooms, services] = await Promise.all([
      Supplier.find({}).lean(),
      Booking.find({}).lean(),
      Room.find({}).lean(),
      BusinessService.find({}).lean(),
    ]);

    const analytics = buildAnalyticsSummary({ suppliers, bookings, rooms, services });

    return res.json({
      analytics,
      suppliersByCategory: suppliers.reduce((acc, supplier) => {
        acc[supplier.category] = (acc[supplier.category] || 0) + 1;
        return acc;
      }, {}),
      bookingsByStatus: bookings.reduce((acc, booking) => {
        acc[booking.status] = (acc[booking.status] || 0) + 1;
        return acc;
      }, {}),
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch marketplace overview.",
      error: error.message,
    });
  }
};

const listSuppliers = async (_req, res) => {
  try {
    const suppliers = await Supplier.find({})
      .populate("hotelId", "name location starRating hotelType")
      .populate("ownerUserId", "name email role")
      .sort({ createdAt: -1 });
    return res.json({ suppliers });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch suppliers.",
      error: error.message,
    });
  }
};

const createSupplier = async (req, res) => {
  try {
    const payload = buildSupplierPayload(req.body);
    if (!payload.name) {
      return res.status(400).json({ message: "Supplier name is required." });
    }
    const supplier = await Supplier.create(payload);
    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "supplier-created" });
    return res.status(201).json({ message: "Supplier created successfully.", supplier });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to create supplier.",
      error: error.message,
    });
  }
};

const updateSupplierVerification = async (req, res) => {
  try {
    const { supplierId } = req.params;
    const { verificationStatus } = req.body;
    const supplier = await Supplier.findById(supplierId);
    if (!supplier) {
      return res.status(404).json({ message: "Supplier not found." });
    }

    supplier.verificationStatus = verificationStatus || supplier.verificationStatus;
    await supplier.save();

    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, {
      reason: "supplier-verification-updated",
      supplierId: supplier._id,
      verificationStatus: supplier.verificationStatus,
    });

    return res.json({
      message: "Supplier verification updated successfully.",
      supplier,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to update supplier verification.",
      error: error.message,
    });
  }
};

const listHotelCatalog = async (_req, res) => {
  try {
    const hotels = await Business.find({})
      .populate("supplierId", "name category verificationStatus commission")
      .sort({ createdAt: -1 });
    const rooms = await Room.find({})
      .populate("hotelId", "name location")
      .sort({ createdAt: -1 });
    const services = await BusinessService.find({})
      .populate("hotelId", "name location")
      .sort({ createdAt: -1 });

    return res.json({ hotels, rooms, services });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch hotel marketplace catalog.",
      error: error.message,
    });
  }
};

const upsertHotelServiceByAdmin = async (req, res) => {
  try {
    const { serviceId } = req.params;
    const { hotelId, supplierId, category, name, description } = req.body;

    if (!hotelId || !category || !name) {
      return res.status(400).json({
        message: "hotelId, category and name are required.",
      });
    }

    const servicePayload = {
      hotelId,
      supplierId: supplierId || null,
      category: String(category).trim(),
      name: String(name).trim(),
      description: String(description || "").trim(),
      priceModel: normalizePriceModel(req.body.priceModel),
      availabilitySchedule: normalizeServiceSchedule(req.body.availabilitySchedule),
      bookingIntegration: {
        bookableWithReservation:
          req.body.bookingIntegration?.bookableWithReservation !== false,
        requiresSeparateConfirmation: Boolean(
          req.body.bookingIntegration?.requiresSeparateConfirmation
        ),
        providerReference: String(
          req.body.bookingIntegration?.providerReference || ""
        ).trim(),
      },
      isActive: req.body.isActive !== false,
    };

    const service = serviceId
      ? await BusinessService.findByIdAndUpdate(serviceId, servicePayload, {
          new: true,
          runValidators: true,
        })
      : await BusinessService.create(servicePayload);

    if (!service) {
      return res.status(404).json({ message: "Service not found." });
    }

    emitHotelRealtime(service.hotelId, REALTIME_EVENTS.SERVICE_CHANGED, {
      action: serviceId ? "updated" : "created",
      serviceId: service._id,
      hotelId: service.hotelId,
      isActive: service.isActive,
      inventory: service.availabilitySchedule?.inventory,
    });
    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "admin-service-saved" });

    return res.json({
      message: serviceId
        ? "Hotel service updated successfully."
        : "Hotel service created successfully.",
      service,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to save hotel service.",
      error: error.message,
    });
  }
};

const upgradeHotelMarketplaceProfile = async (req, res) => {
  try {
    const { hotelId } = req.params;
    const hotel = await Business.findById(hotelId);
    if (!hotel) {
      return res.status(404).json({ message: "Business not found." });
    }

    if (req.body.starRating !== undefined) hotel.starRating = req.body.starRating;
    if (req.body.hotelType !== undefined) hotel.hotelType = req.body.hotelType;
    if (req.body.bookingRules !== undefined) {
      hotel.bookingRules = normalizeBookingRules(req.body.bookingRules);
    }
    if (req.body.checkInWindow !== undefined) {
      hotel.checkInWindow = {
        from: String(req.body.checkInWindow?.from || hotel.checkInWindow?.from || "14:00").trim(),
        to: String(req.body.checkInWindow?.to || hotel.checkInWindow?.to || "23:00").trim(),
      };
    }

    await hotel.save();

    emitRealtime(REALTIME_EVENTS.HOTEL_CHANGED, {
      action: "updated",
      hotelId: hotel._id,
    });
    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "hotel-profile-updated" });

    return res.json({
      message: "Hotel marketplace profile updated successfully.",
      hotel,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to update hotel marketplace profile.",
      error: error.message,
    });
  }
};

const createCompositeBooking = async (req, res) => {
  try {
    const {
      touristId,
      destinationPlace,
      destinationLocation,
      items = [],
      checkIn,
      checkOut,
      pricingMode,
      totalPrice,
      cancellation,
      availabilityLocks = [],
    } = req.body;

    if (!touristId || !destinationPlace || !destinationLocation) {
      return res.status(400).json({
        message: "touristId, destinationPlace and destinationLocation are required.",
      });
    }

    const serviceItems = items.filter((item) => item.serviceId);
    const claimedServices = [];

    for (const item of serviceItems) {
      const quantity = Math.max(1, Number(item.quantity) || 1);
      const updatedService = await BusinessService.findOneAndUpdate(
        {
          _id: item.serviceId,
          isActive: true,
          "availabilitySchedule.inventory": { $gte: quantity },
        },
        { $inc: { "availabilitySchedule.inventory": -quantity } },
        { new: true, runValidators: true }
      );

      if (!updatedService) {
        for (const claimed of claimedServices) {
          await BusinessService.updateOne(
            { _id: claimed.serviceId },
            { $inc: { "availabilitySchedule.inventory": claimed.quantity } }
          );
        }

        return res.status(409).json({
          message: "One or more selected services are no longer available.",
          unavailableServiceId: item.serviceId,
        });
      }

      claimedServices.push({
        serviceId: updatedService._id,
        hotelId: updatedService.hotelId,
        quantity,
        inventory: updatedService.availabilitySchedule?.inventory,
      });
    }

    const booking = await Booking.create({
      touristId,
      destinationPlace: String(destinationPlace).trim(),
      destinationLocation: String(destinationLocation).trim(),
      preferredHotelId: req.body.preferredHotelId || null,
      hotelId: req.body.hotelId || null,
      roomId: req.body.roomId || null,
      supplierId: req.body.supplierId || null,
      items: Array.isArray(items) ? items : [],
      checkIn: checkIn || null,
      checkOut: checkOut || null,
      pricingMode: pricingMode || "mixed",
      totalPrice: Number(totalPrice) || 0,
      status: "pending",
      cancellation: {
        policyType: String(cancellation?.policyType || "moderate").trim(),
        refundableUntil: cancellation?.refundableUntil || null,
        refundAmount: Number(cancellation?.refundAmount) || 0,
      },
      availabilityLocks,
      isConnected: Boolean(req.body.hotelId || req.body.roomId),
      adminResponseMessage:
        "Marketplace booking created. Availability lock and supplier confirmation pending.",
    });

    for (const claimed of claimedServices) {
      emitHotelRealtime(claimed.hotelId, REALTIME_EVENTS.SERVICE_CHANGED, {
        action: "reserved",
        serviceId: claimed.serviceId,
        hotelId: claimed.hotelId,
        inventory: claimed.inventory,
      });
    }
    emitUserRealtime(touristId, REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "created",
      bookingId: booking._id,
      status: booking.status,
    });
    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "marketplace-booking-created" });

    return res.status(201).json({
      message: "Composite booking created successfully.",
      booking,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to create marketplace booking.",
      error: error.message,
    });
  }
};

module.exports = {
  getMarketplaceOverview,
  listSuppliers,
  createSupplier,
  updateSupplierVerification,
  listHotelCatalog,
  upsertHotelServiceByAdmin,
  upgradeHotelMarketplaceProfile,
  createCompositeBooking,
};
