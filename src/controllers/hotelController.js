const Booking = require("../models/Booking");
const Hotel = require("../models/Hotel");
const HotelService = require("../models/HotelService");
const Room = require("../models/Room");
const {
  normalizeAvailabilityCalendar,
  normalizeCapacity,
  normalizePriceModel,
  normalizeServiceSchedule,
} = require("../services/marketplaceService");

const ensureHotelUser = (req, res) => {
  if (!req.user?.hotelId) {
    res.status(400).json({ message: "Hotel user is not linked to a hotel." });
    return null;
  }
  return req.user.hotelId;
};

const getMyHotelOverview = async (req, res) => {
  try {
    const hotelId = ensureHotelUser(req, res);
    if (!hotelId) return;

    const [hotel, totalRooms, availableRooms, occupiedRooms, bookings, totalServices] =
      await Promise.all([
        Hotel.findById(hotelId),
        Room.countDocuments({ hotelId }),
        Room.countDocuments({ hotelId, status: "available" }),
        Room.countDocuments({ hotelId, status: "occupied" }),
        Booking.countDocuments({ hotelId }),
        HotelService.countDocuments({ hotelId, isActive: true }),
      ]);

    if (!hotel) {
      return res.status(404).json({ message: "Hotel not found." });
    }

    return res.json({
      hotel,
      stats: {
        totalRooms,
        availableRooms,
        occupiedRooms,
        bookings,
        services: totalServices,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch hotel overview.",
      error: error.message,
    });
  }
};

const listMyBookings = async (req, res) => {
  try {
    const hotelId = ensureHotelUser(req, res);
    if (!hotelId) return;

    const bookings = await Booking.find({ hotelId })
      .populate("touristId", "name email")
      .populate("roomId", "roomNumber type price status")
      .populate("tourHelpers", "name phone email")
      .sort({ createdAt: -1 });

    return res.json({ bookings });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch hotel bookings.",
      error: error.message,
    });
  }
};

const listMyRooms = async (req, res) => {
  try {
    const hotelId = ensureHotelUser(req, res);
    if (!hotelId) return;

    const rooms = await Room.find({ hotelId }).sort({ roomNumber: 1 });
    return res.json({ rooms });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch rooms.",
      error: error.message,
    });
  }
};

const createRoom = async (req, res) => {
  try {
    const hotelId = ensureHotelUser(req, res);
    if (!hotelId) return;

    const { roomNumber, type, roomType, price, pricePerNight, status } = req.body;
    const resolvedPrice =
      price !== undefined ? Number(price) : Number(pricePerNight);

    if (!roomNumber || !Number.isFinite(resolvedPrice)) {
      return res
        .status(400)
        .json({ message: "roomNumber and price are required." });
    }

    const room = await Room.create({
      hotelId,
      roomNumber: String(roomNumber).trim(),
      type: (type || "standard").trim(),
      roomType: (roomType || type || "standard").trim(),
      price: resolvedPrice,
      pricePerNight:
        pricePerNight === undefined ? resolvedPrice : Number(pricePerNight),
      capacity: normalizeCapacity(req.body.capacity),
      amenities: Array.isArray(req.body.amenities) ? req.body.amenities : [],
      availabilityCalendar: normalizeAvailabilityCalendar(req.body.availabilityCalendar),
      smokingAllowed: Boolean(req.body.smokingAllowed),
      occupancyType: String(req.body.occupancyType || "double").trim(),
      status: status || "available",
    });

    return res.status(201).json({ message: "Room created successfully.", room });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to create room.",
      error: error.message,
    });
  }
};

const updateRoom = async (req, res) => {
  try {
    const hotelId = ensureHotelUser(req, res);
    if (!hotelId) return;

    const { roomId } = req.params;
    const room = await Room.findOne({ _id: roomId, hotelId });
    if (!room) {
      return res.status(404).json({ message: "Room not found." });
    }

    const { roomNumber, type, roomType, price, pricePerNight, status } = req.body;
    if (roomNumber !== undefined) room.roomNumber = String(roomNumber).trim();
    if (type !== undefined) room.type = String(type).trim();
    if (roomType !== undefined) room.roomType = String(roomType).trim();
    if (price !== undefined) room.price = Number(price);
    if (pricePerNight !== undefined) room.pricePerNight = Number(pricePerNight);
    if (req.body.capacity !== undefined) room.capacity = normalizeCapacity(req.body.capacity);
    if (req.body.amenities !== undefined) {
      room.amenities = Array.isArray(req.body.amenities) ? req.body.amenities : [];
    }
    if (req.body.availabilityCalendar !== undefined) {
      room.availabilityCalendar = normalizeAvailabilityCalendar(
        req.body.availabilityCalendar
      );
    }
    if (req.body.smokingAllowed !== undefined) {
      room.smokingAllowed = Boolean(req.body.smokingAllowed);
    }
    if (req.body.occupancyType !== undefined) {
      room.occupancyType = String(req.body.occupancyType).trim();
    }
    if (status !== undefined) room.status = status;

    await room.save();

    return res.json({ message: "Room updated successfully.", room });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to update room.",
      error: error.message,
    });
  }
};

const deleteRoom = async (req, res) => {
  try {
    const hotelId = ensureHotelUser(req, res);
    if (!hotelId) return;

    const { roomId } = req.params;
    const room = await Room.findOne({ _id: roomId, hotelId });
    if (!room) {
      return res.status(404).json({ message: "Room not found." });
    }

    await Booking.updateMany(
      { roomId: room._id, hotelId },
      {
        $set: {
          roomId: null,
          hotelId: null,
          isConnected: false,
          status: "pending",
          adminResponseMessage:
            "Your assigned room was removed by hotel owner. Admin will reassign.",
        },
      }
    );

    await Room.deleteOne({ _id: room._id });

    return res.json({ message: "Room deleted successfully." });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to delete room.",
      error: error.message,
    });
  }
};

const listMyServices = async (req, res) => {
  try {
    const hotelId = ensureHotelUser(req, res);
    if (!hotelId) return;

    const services = await HotelService.find({ hotelId }).sort({
      category: 1,
      name: 1,
    });
    return res.json({ services });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch hotel services.",
      error: error.message,
    });
  }
};

const updateBookingStatus = async (req, res) => {
  try {
    const hotelId = ensureHotelUser(req, res);
    if (!hotelId) return;

    const { bookingId } = req.params;
    const { status } = req.body;
    const allowedStatuses = ["confirmed", "cancelled", "completed"];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        message: `status must be one of: ${allowedStatuses.join(", ")}.`,
      });
    }

    const booking = await Booking.findOne({ _id: bookingId, hotelId });
    if (!booking) {
      return res.status(404).json({ message: "Booking not found." });
    }

    booking.status = status;
    await booking.save();

    return res.json({
      message: "Booking status updated successfully.",
      booking,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to update booking status.",
      error: error.message,
    });
  }
};

const upsertMyService = async (req, res) => {
  try {
    const hotelId = ensureHotelUser(req, res);
    if (!hotelId) return;

    const { serviceId } = req.params;
    const { category, name, description } = req.body;
    if (!category || !name) {
      return res.status(400).json({ message: "category and name are required." });
    }

    const payload = {
      hotelId,
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
      ? await HotelService.findOneAndUpdate({ _id: serviceId, hotelId }, payload, {
          new: true,
          runValidators: true,
        })
      : await HotelService.create(payload);

    if (!service) {
      return res.status(404).json({ message: "Service not found." });
    }

    return res.json({
      message: serviceId
        ? "Service updated successfully."
        : "Service created successfully.",
      service,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to save service.",
      error: error.message,
    });
  }
};

const deleteService = async (req, res) => {
  try {
    const hotelId = ensureHotelUser(req, res);
    if (!hotelId) return;

    const { serviceId } = req.params;
    const deleted = await HotelService.findOneAndDelete({ _id: serviceId, hotelId });

    if (!deleted) {
      return res.status(404).json({ message: "Service not found." });
    }

    return res.json({ message: "Service deleted successfully." });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to delete service.",
      error: error.message,
    });
  }
};

module.exports = {
  getMyHotelOverview,
  listMyBookings,
  listMyRooms,
  listMyServices,
  updateBookingStatus,
  createRoom,
  updateRoom,
  upsertMyService,
  deleteService,
  deleteRoom,
};
