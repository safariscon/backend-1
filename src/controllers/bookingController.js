const Booking = require("../models/Booking");
const Business = require("../models/Business");
const { REALTIME_EVENTS, emitUserRealtime } = require("../utils/realtime");
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

const listMyBookings = async (req, res) => {
  try {
    const bookings = await Booking.find({ touristId: req.user._id })
      .populate("touristId", "name email")
      .populate("preferredHotelId", "name location basePrice")
      .populate("preferredBusinessId", "name location basePrice type businessType bookingModel pricingModel pricingUnit")
      .populate("hotelId", "name location basePrice")
      .populate("roomId", "roomNumber type price status")
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

module.exports = {
  createBookingRequest,
  listMyBookings,
};
