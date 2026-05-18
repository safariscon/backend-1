const Booking = require("../models/Booking");
const Hotel = require("../models/Hotel");
const { REALTIME_EVENTS, emitUserRealtime } = require("../utils/realtime");

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
    } = req.body;

    if (!destinationPlace || !destinationLocation) {
      return res.status(400).json({
        message: "destinationPlace and destinationLocation are required.",
      });
    }

    let preferredHotelId = null;
    if (hotelId) {
      const hotel = await Hotel.findById(hotelId);
      if (!hotel) {
        return res.status(404).json({ message: "Preferred hotel not found." });
      }
      preferredHotelId = hotel._id;
    }

    const booking = await Booking.create({
      touristId: req.user._id,
      destinationPlace: destinationPlace.trim(),
      destinationLocation: destinationLocation.trim(),
      preferredHotelId,
      checkIn: checkIn || null,
      checkOut: checkOut || null,
      guests: Number(guests) || 1,
      totalPrice: Number(totalPrice) || 0,
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
