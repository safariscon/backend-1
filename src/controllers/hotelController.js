const Booking = require("../models/Booking");
const Hotel = require("../models/Hotel");
const HotelService = require("../models/HotelService");
const Room = require("../models/Room");
const Transaction = require("../models/Transaction");
const {
  REALTIME_EVENTS,
  emitHotelRealtime,
  emitRealtime,
  emitUserRealtime,
} = require("../utils/realtime");
const {
  normalizeAvailabilityCalendar,
  normalizeCapacity,
  normalizePriceModel,
  normalizeServiceSchedule,
} = require("../services/marketplaceService");

const ensureHotelUser = (req, res) => {
  if (!["hotel", "supplier"].includes(req.user?.role)) {
    res.status(403).json({ message: "Seller role required." });
    return null;
  }
  return req.user.hotelId || null;
};

const sellerBusinessFilter = (req) => ({
  $or: [
    { ownerUserId: req.user._id },
    { ownerEmail: req.user.email },
    ...(req.user.hotelId ? [{ _id: req.user.hotelId }] : []),
  ],
});

const getMyHotelOverview = async (req, res) => {
  try {
    if (ensureHotelUser(req, res) === null && !["hotel", "supplier"].includes(req.user?.role)) return;

    const businesses = await Hotel.find(sellerBusinessFilter(req)).sort({ createdAt: -1 });
    const businessIds = businesses.map((business) => business._id);
    const primaryBusiness = businesses[0] || null;
    const [totalRooms, availableRooms, occupiedRooms, bookings, totalServices, transactions] =
      await Promise.all([
        Room.countDocuments({ hotelId: { $in: businessIds } }),
        Room.countDocuments({ hotelId: { $in: businessIds }, status: "available" }),
        Room.countDocuments({ hotelId: { $in: businessIds }, status: "occupied" }),
        Booking.countDocuments({ hotelId: { $in: businessIds } }),
        HotelService.countDocuments({ hotelId: { $in: businessIds }, isActive: true }),
        Transaction.find({ businessId: { $in: businessIds } }).lean(),
      ]);

    return res.json({
      hotel: primaryBusiness,
      business: primaryBusiness,
      businesses,
      stats: {
        totalRooms,
        availableRooms,
        occupiedRooms,
        bookings,
        services: totalServices + businesses.length,
        earnings: transactions
          .filter((tx) => tx.status === "paid")
          .reduce((sum, tx) => sum + Number(tx.sellerEarnings || 0), 0),
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
    if (ensureHotelUser(req, res) === null && !["hotel", "supplier"].includes(req.user?.role)) return;
    const businesses = await Hotel.find(sellerBusinessFilter(req)).select("_id");
    const businessIds = businesses.map((business) => business._id);

    const bookings = await Booking.find({ hotelId: { $in: businessIds } })
      .populate("touristId", "name email")
      .populate("hotelId", "name location type ownerEmail")
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
    const hotelId = ensureHotelUser(req, res) || req.body.hotelId;
    if (!hotelId) return res.status(400).json({ message: "Select a business before adding rooms." });

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
    const hotelId = ensureHotelUser(req, res) || req.body.hotelId;
    if (!hotelId) return res.status(400).json({ message: "Select a business before editing rooms." });

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

    emitHotelRealtime(hotelId, REALTIME_EVENTS.ROOM_CHANGED, {
      action: "created",
      roomId: room._id,
      hotelId,
      status: room.status,
    });
    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "room-created", hotelId });

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
    const hotelId = ensureHotelUser(req, res) || req.body.hotelId;
    if (!hotelId) return res.status(400).json({ message: "Select a business before deleting rooms." });

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

    emitHotelRealtime(hotelId, REALTIME_EVENTS.ROOM_CHANGED, {
      action: "updated",
      roomId: room._id,
      hotelId,
      status: room.status,
    });
    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "room-updated", hotelId });

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

    emitHotelRealtime(hotelId, REALTIME_EVENTS.ROOM_CHANGED, {
      action: "deleted",
      roomId: room._id,
      hotelId,
    });
    emitRealtime(REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "room-deleted",
      hotelId,
      roomId: room._id,
    });
    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "room-deleted", hotelId });

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
    if (ensureHotelUser(req, res) === null && !["hotel", "supplier"].includes(req.user?.role)) return;
    const businesses = await Hotel.find(sellerBusinessFilter(req)).sort({ createdAt: -1 }).lean();
    const businessIds = businesses.map((business) => business._id);

    const services = await HotelService.find({ hotelId: { $in: businessIds } }).sort({
      category: 1,
      name: 1,
    });
    const businessListings = businesses.map((business) => ({
      ...business,
      title: business.name,
      name: business.name,
      category: business.type,
      serviceType: business.type,
      status: business.status,
      approvalStatus: business.approvalStatus,
      verificationStatus: business.approvalStatus,
      availableQuantity: business.quantityRemaining ?? business.availableQuantity ?? 0,
      availabilityText: `${business.quantityRemaining ?? business.availableQuantity ?? 0} remaining`,
    }));
    return res.json({ services: businessListings.concat(services) });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch hotel services.",
      error: error.message,
    });
  }
};

const updateBookingStatus = async (req, res) => {
  try {
    if (ensureHotelUser(req, res) === null && !["hotel", "supplier"].includes(req.user?.role)) return;

    const { bookingId } = req.params;
    const { status } = req.body;
    const allowedStatuses = ["confirmed", "cancelled", "completed"];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        message: `status must be one of: ${allowedStatuses.join(", ")}.`,
      });
    }

    const businesses = await Hotel.find(sellerBusinessFilter(req)).select("_id");
    const businessIds = businesses.map((business) => business._id);
    const booking = await Booking.findOne({ _id: bookingId, hotelId: { $in: businessIds } });
    if (!booking) {
      return res.status(404).json({ message: "Booking not found." });
    }

    booking.status = status;
    await booking.save();

    if (status === "cancelled" && booking.roomId) {
      await Room.updateOne(
        { _id: booking.roomId, hotelId: booking.hotelId },
        { $set: { status: "available" } }
      );
      emitHotelRealtime(booking.hotelId, REALTIME_EVENTS.ROOM_CHANGED, {
        action: "released",
        roomId: booking.roomId,
        hotelId: booking.hotelId,
        status: "available",
      });
    }

    emitUserRealtime(booking.touristId, REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "status-updated",
      bookingId: booking._id,
      hotelId: booking.hotelId,
      status: booking.status,
    });

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
    if (ensureHotelUser(req, res) === null && !["hotel", "supplier"].includes(req.user?.role)) return;

    const { serviceId } = req.params;
    const { category, name, description } = req.body;
    const title = String(req.body.title || name || "").trim();
    if (!category || !title) {
      return res.status(400).json({ message: "category and business name are required." });
    }
    const quantity = Math.max(0, Number(req.body.availableQuantity || req.body.quantityRemaining || 1));
    const amount = Number(req.body.pricing?.amount || req.body.price || 0);
    const images = Array.isArray(req.body.images) ? req.body.images.filter(Boolean).slice(0, 6) : [];

    if (serviceId) {
      const business = await Hotel.findOneAndUpdate(
        { _id: serviceId, ...sellerBusinessFilter(req) },
        {
          $set: {
            name: title,
            type: String(category).trim(),
            description: String(description || "").trim(),
            basePrice: Number.isFinite(amount) ? amount : 0,
            priceText: String(req.body.priceText || "").trim(),
            images,
            services: [String(category).trim()],
            status: req.body.status === "unavailable" ? "unavailable" : "available",
            availableQuantity: quantity,
            quantityRemaining: quantity,
            approvalStatus: "pending",
          },
        },
        { new: true, runValidators: true }
      );
      if (business) {
        emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "seller-business-updated", hotelId: business._id });
        return res.json({ message: "Business updated and sent for admin approval.", service: business });
      }
    }

    const business = await Hotel.create({
      name: title,
      type: String(category).trim(),
      location: String(req.body.location || "Rwanda").trim(),
      description: String(description || "").trim(),
      basePrice: Number.isFinite(amount) ? amount : 0,
      priceText: String(req.body.priceText || "").trim(),
      amenities: [],
      contactInfo: req.user.email,
      images,
      services: [String(category).trim()],
      ownerEmail: `${req.user.sellerId || req.user._id}-${Date.now()}@seller.local`.toLowerCase(),
      sellerContactEmail: req.user.email,
      ownerUserId: req.user._id,
      supplierId: req.user.supplierId || null,
      approvalStatus: "pending",
      status: req.body.status === "unavailable" ? "unavailable" : "available",
      availableQuantity: quantity,
      quantityRemaining: quantity,
    });

    if (!req.user.hotelId) {
      req.user.hotelId = business._id;
      await req.user.save();
    }

    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "seller-business-created", hotelId: business._id });
    return res.status(201).json({
      message: "Business created and sent for admin approval.",
      service: business,
    });

    const payload = {
      hotelId: req.body.hotelId || req.user.hotelId,
      category: String(category).trim(),
      name: title,
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

    emitHotelRealtime(hotelId, REALTIME_EVENTS.SERVICE_CHANGED, {
      action: serviceId ? "updated" : "created",
      serviceId: service._id,
      hotelId,
      isActive: service.isActive,
      inventory: service.availabilitySchedule?.inventory,
    });
    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "service-saved", hotelId });

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
    if (ensureHotelUser(req, res) === null && !["hotel", "supplier"].includes(req.user?.role)) return;

    const { serviceId } = req.params;
    const deletedBusiness = await Hotel.findOneAndDelete({ _id: serviceId, ...sellerBusinessFilter(req) });
    if (deletedBusiness) {
      emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "seller-business-deleted", hotelId: deletedBusiness._id });
      return res.json({ message: "Business deleted successfully." });
    }
    const businesses = await Hotel.find(sellerBusinessFilter(req)).select("_id");
    const businessIds = businesses.map((business) => business._id);
    const deleted = await HotelService.findOneAndDelete({ _id: serviceId, hotelId: { $in: businessIds } });

    if (!deleted) {
      return res.status(404).json({ message: "Service not found." });
    }

    emitHotelRealtime(deleted.hotelId, REALTIME_EVENTS.SERVICE_CHANGED, {
      action: "deleted",
      serviceId: deleted._id,
      hotelId: deleted.hotelId,
    });
    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "service-deleted", hotelId: deleted.hotelId });

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
