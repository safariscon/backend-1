const Booking = require("../models/Booking");
const Business = require("../models/Business");
const BusinessService = require("../models/BusinessService");
const { REALTIME_EVENTS, emitUserRealtime } = require("../utils/realtime");
const { emitRealtime, emitHotelRealtime } = require("../utils/realtime");
const { decorateBusiness, getMarketplaceTypeConfig } = require("../utils/marketplaceTypes");

const calculateQuantity = ({ bookingModel, pricingModel, checkIn, checkOut, durationHours, durationDays, quantity }) => {
  if (pricingModel === "per_night" || bookingModel === "rental") {
    if (!checkIn || !checkOut) return 0;
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 0;
    return Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
  }

  if (pricingModel === "per_hour") {
    return Math.max(1, Number(durationHours) || 1);
  }

  if (pricingModel === "per_day") {
    return Math.max(1, Number(durationDays) || 1);
  }

  if (pricingModel === "per_person") {
    return Math.max(1, Number(quantity) || 1);
  }

  return 1;
};

const createBookingRequest = async (req, res) => {
  try {
    const {
      hotelId,
      checkIn,
      checkOut,
      guests,
      totalPrice,
      destinationPlace,
      destinationLocation,
      bookingDetails = {},
      reservationDate,
      reservationTime,
      pickupLocation,
      dropoffLocation,
      vehicleType,
      durationHours,
      durationDays,
      packageType,
      specialRequests,
      quantity,
    } = req.body;

    if (!destinationPlace || !destinationLocation) {
      return res.status(400).json({
        message: "destinationPlace and destinationLocation are required.",
      });
    }

    let preferredHotelId = null;
    let preferredBusiness = null;
    if (hotelId) {
      const hotel = await Business.findById(hotelId);
      if (!hotel) {
        return res.status(404).json({ message: "Preferred business not found." });
      }
      preferredHotelId = hotel._id;
      preferredBusiness = decorateBusiness(hotel);
    }

    const marketplaceConfig = preferredBusiness
      ? getMarketplaceTypeConfig(preferredBusiness.businessType || preferredBusiness.type)
      : getMarketplaceTypeConfig();
    const resolvedQuantity = calculateQuantity({
      bookingModel: marketplaceConfig.bookingModel,
      pricingModel: marketplaceConfig.pricingModel,
      checkIn,
      checkOut,
      durationHours,
      durationDays,
      quantity,
    });
    const resolvedTotal =
      Number(totalPrice) ||
      (preferredBusiness ? Number(preferredBusiness.basePrice || 0) * resolvedQuantity : 0);

    const booking = await Booking.create({
      touristId: req.user._id,
      destinationPlace: destinationPlace.trim(),
      destinationLocation: destinationLocation.trim(),
      preferredHotelId,
      preferredBusinessId: preferredHotelId,
      businessType: marketplaceConfig.businessType,
      serviceCategory: marketplaceConfig.serviceCategory,
      bookingModel: marketplaceConfig.bookingModel,
      pricingModel: marketplaceConfig.pricingModel,
      pricingUnit: marketplaceConfig.pricingUnit,
      assignmentType: marketplaceConfig.assignmentType,
      checkIn: checkIn || null,
      checkOut: checkOut || null,
      guests: Number(guests) || 1,
      quantity: resolvedQuantity,
      reservationDate: reservationDate || bookingDetails.reservationDate || null,
      reservationTime: reservationTime || bookingDetails.reservationTime || "",
      pickupLocation: pickupLocation || bookingDetails.pickupLocation || "",
      dropoffLocation: dropoffLocation || bookingDetails.dropoffLocation || "",
      vehicleType: vehicleType || bookingDetails.vehicleType || "",
      durationHours: Number(durationHours || bookingDetails.durationHours || 0),
      durationDays: Number(durationDays || bookingDetails.durationDays || 0),
      packageType: packageType || bookingDetails.packageType || "",
      specialRequests: specialRequests || bookingDetails.specialRequests || "",
      bookingDetails,
      totalPrice: resolvedTotal,
      status: "pending",
      isConnected: false,
      adminResponseMessage:
        "Your request has been submitted successfully. Please wait for admin response.",
    });

    emitUserRealtime(req.user._id, REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "created",
      bookingId: booking._id,
      touristId: req.user._id,
      hotelId: preferredHotelId,
      status: booking.status,
    });

    return res.status(201).json({
      message: "Booking request created.",
      booking,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to create booking request.",
      error: error.message,
    });
  }
};

const multiplierForUnit = ({ unit, quantity, startDate, endDate, durationHours, durationDays, bookingType }) => {
  if (bookingType === "transport") return Math.max(1, Number(durationDays) || 1);
  if (bookingType === "appointment") return Math.max(1, Number(durationHours) || 1);
  if (unit === "per_hour") return Math.max(1, Number(durationHours) || 1);
  if (["per_day", "per_night"].includes(unit)) {
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end > start) {
        return Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
      }
    }
    return Math.max(1, Number(durationDays) || 1);
  }
  return Math.max(1, Number(quantity) || 1);
};

const parsePriceTextAmount = (priceText) => {
  const match = String(priceText || "").replace(/,/g, "").match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
};

const createServiceBooking = async (req, res) => {
  try {
    const {
      serviceId,
      quantity = 1,
      startDate,
      endDate,
      durationHours,
      durationDays,
      reservationTime,
      destinationPlace,
      destinationLocation,
      pickupLocation,
      dropoffLocation,
      vehicleType,
      packageType,
      specialRequests,
      bookingDetails = {},
    } = req.body;

    if (!serviceId) {
      return res.status(400).json({ message: "serviceId is required." });
    }

    const requestedQuantity = Math.max(1, Number(quantity) || 1);
    const service = await BusinessService.findOneAndUpdate(
      {
        _id: serviceId,
        isActive: true,
        status: "available",
        availableQuantity: { $gte: requestedQuantity },
      },
      { $inc: { availableQuantity: -requestedQuantity } },
      { new: true, runValidators: true }
    );

    if (!service) {
      return res.status(409).json({
        message: "This service is not available in that quantity right now.",
      });
    }

    if (service.availableQuantity === 0) {
      service.status = "fully_booked";
      await service.save();
    }

    const business = await Business.findById(service.businessId || service.hotelId);
    if (!business) {
      await BusinessService.updateOne(
        { _id: service._id },
        { $inc: { availableQuantity: requestedQuantity }, $set: { status: "available" } }
      );
      return res.status(404).json({ message: "Business not found for this service." });
    }

    const units = multiplierForUnit({
      unit: service.pricing?.unit,
      quantity: requestedQuantity,
      startDate,
      endDate,
      durationHours,
      durationDays,
      bookingType: bookingDetails.bookingType,
    });
    const unitPrice = Number(service.pricing?.amount || 0) || parsePriceTextAmount(service.priceText);
    const totalPrice = unitPrice * requestedQuantity * units;

    const booking = await Booking.create({
      userId: req.user._id,
      touristId: req.user._id,
      businessId: business._id,
      hotelId: business._id,
      preferredBusinessId: business._id,
      preferredHotelId: business._id,
      serviceId: service._id,
      destinationPlace: String(destinationPlace || bookingDetails.destinationPlace || service.title || service.name).trim(),
      destinationLocation: String(destinationLocation || bookingDetails.destinationLocation || service.location || business.location).trim(),
      businessType: business.businessType || business.type,
      serviceCategory: service.category,
      pricingModel: service.pricing?.unit || "per_day",
      pricingUnit: service.pricing?.unit || "per_day",
      assignmentType: "service",
      assignmentTargetId: service._id,
      assignmentLabel: service.title || service.name,
      quantity: requestedQuantity,
      startDate: startDate || null,
      endDate: endDate || startDate || null,
      checkIn: startDate || null,
      checkOut: endDate || null,
      reservationDate: startDate || null,
      reservationTime: reservationTime || "",
      pickupLocation: pickupLocation || bookingDetails.pickupLocation || "",
      dropoffLocation: dropoffLocation || bookingDetails.dropoffLocation || "",
      vehicleType: vehicleType || bookingDetails.vehicleType || "",
      durationHours: Number(durationHours || 0),
      durationDays: Number(durationDays || 0),
      packageType: packageType || bookingDetails.packageType || "",
      specialRequests: specialRequests || "",
      bookingDetails,
      totalPrice,
      paymentStatus: "pending",
      bookingStatus: "pending",
      status: "pending",
      items: [
        {
          itemType: "service",
          hotelId: business._id,
          serviceId: service._id,
          name: service.title || service.name,
          quantity: requestedQuantity,
          pricingUnit: service.pricing?.unit || "per_day",
          unitPrice,
          total: totalPrice,
        },
      ],
    });

    const updatePayload = {
      action: "booked",
      serviceId: service._id,
      businessId: business._id,
      availableQuantity: service.availableQuantity,
      status: service.status,
    };
    emitRealtime("newBooking", {
      bookingId: booking._id,
      bookingCode: booking.bookingCode,
      serviceId: service._id,
      businessId: business._id,
      status: booking.status,
    });
    emitRealtime("serviceUpdated", service);
    emitRealtime(REALTIME_EVENTS.SERVICE_CHANGED, updatePayload);
    emitHotelRealtime(business._id, REALTIME_EVENTS.SERVICE_CHANGED, updatePayload);
    emitUserRealtime(req.user._id, REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "created",
      bookingId: booking._id,
      bookingCode: booking.bookingCode,
      status: booking.status,
    });

    return res.status(201).json({
      message: "Booking request sent.",
      booking,
      service,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to create service booking.",
      error: error.message,
    });
  }
};

const listMyBookings = async (req, res) => {
  try {
    const bookings = await Booking.find({ $or: [{ touristId: req.user._id }, { userId: req.user._id }] })
      .populate("touristId", "name email")
      .populate("preferredHotelId", "name location basePrice")
      .populate("preferredBusinessId", "name location basePrice type businessType bookingModel pricingModel pricingUnit")
      .populate("hotelId", "name location basePrice")
      .populate("businessId", "businessName name location basePrice")
      .populate("serviceId", "title name category pricing availableQuantity status")
      .populate("tourHelpers", "name phone email")
      .sort({ createdAt: -1 });

    return res.json({ bookings });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch your bookings.",
      error: error.message,
    });
  }
};

const getMyBookingById = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.bookingId)
      .populate("businessId", "businessName name location phone email verificationStatus")
      .populate("serviceId", "title name category pricing availableQuantity status");

    if (!booking) {
      return res.status(404).json({ message: "Booking not found." });
    }

    if (String(booking.userId || booking.touristId) !== String(req.user._id)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    return res.json({ booking });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch booking.",
      error: error.message,
    });
  }
};

module.exports = {
  createBookingRequest,
  createServiceBooking,
  listMyBookings,
  getMyBookingById,
};
