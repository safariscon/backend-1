const Booking = require("../models/Booking");
const Hotel = require("../models/Hotel");
const Room = require("../models/Room");
const User = require("../models/User");
const Supplier = require("../models/Supplier");
const HotelService = require("../models/HotelService");
const Transaction = require("../models/Transaction");
const SiteSetting = require("../models/SiteSetting");
const bcrypt = require("bcrypt");
const { registerHotelByAdmin } = require("./authController");
const { prefixedCode, secureToken } = require("../utils/secureIds");
const {
  REALTIME_EVENTS,
  emitHotelRealtime,
  emitRealtime,
  emitUserRealtime,
} = require("../utils/realtime");
const { clearCache } = require("../utils/cache");

const registerHotel = registerHotelByAdmin;
const registerBusiness = registerHotelByAdmin;

const createSeller = async (req, res) => {
  try {
    const name = String(req.body.name || req.body.fullName || "").trim();
    const email = String(req.body.email || "").toLowerCase().trim();
    if (!name || !email) {
      return res.status(400).json({ message: "Seller full name and email are required." });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: "A user with this email already exists." });
    }

    const sellerId = prefixedCode("SELLER", 8);
    const generatedPassword = prefixedCode("SCN", 14);
    const hashedPassword = await bcrypt.hash(generatedPassword, 12);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role: "hotel",
      sellerId,
      mustSetPassword: false,
    });

    return res.status(201).json({
      message: "Seller account created successfully.",
      seller: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        sellerId,
      },
      credentials: {
        fullName: name,
        email,
        sellerId,
        password: generatedPassword,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create seller.", error: error.message });
  }
};

const listServices = async (_req, res) => {
  try {
    const services = await Hotel.find({})
      .populate("ownerUserId", "name email sellerId")
      .sort({ createdAt: -1 })
      .lean();
    return res.json({
      services: services.map((business) => ({
        ...business,
        title: business.name,
        category: business.type,
        businessId: business,
        availableQuantity: business.quantityRemaining ?? business.availableQuantity ?? 0,
        verificationStatus: business.approvalStatus,
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch services.", error: error.message });
  }
};

const updateBusinessVerification = async (req, res) => {
  try {
    const { businessId } = req.params;
    const requestedStatus = req.body.status || req.body.verificationStatus;
    const approvalStatus =
      requestedStatus === "verified" || requestedStatus === "approved"
        ? "approved"
        : requestedStatus === "rejected"
          ? "rejected"
          : "pending";

    const business = await Hotel.findByIdAndUpdate(
      businessId,
      {
        $set: {
          approvalStatus,
          ...(approvalStatus === "approved" ? { status: "available" } : {}),
        },
        ...(approvalStatus === "approved"
          ? { $max: { availableQuantity: 1, quantityRemaining: 1 } }
          : {}),
      },
      { returnDocument: "after", runValidators: true }
    );
    if (!business) return res.status(404).json({ message: "Business not found." });

    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, {
      reason: "business-approval-updated",
      businessId: business._id,
      approvalStatus,
    });
    clearCache("public:");

    return res.json({
      message: approvalStatus === "approved" ? "Business posted publicly." : "Business review updated.",
      business,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update business approval.", error: error.message });
  }
};

const updateAnnouncement = async (req, res) => {
  try {
    const text = String(req.body.text || "").trim();
    const linkUrl = String(req.body.linkUrl || "").trim();
    const linkLabel = String(req.body.linkLabel || "").trim();
    const enabled = req.body.enabled !== false;

    if (enabled && !text) {
      return res.status(400).json({ message: "Announcement text is required when the bar is enabled." });
    }

    const setting = await SiteSetting.findOneAndUpdate(
      { key: "announcement" },
      {
        $set: {
          value: {
            enabled,
            text,
            linkUrl,
            linkLabel,
          },
        },
      },
      { upsert: true, returnDocument: "after", runValidators: true }
    );

    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "announcement-updated" });
    return res.json({ message: "Announcement updated.", announcement: setting.value });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update announcement.", error: error.message });
  }
};

const approveBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const booking = await Booking.findOneAndUpdate(
      {
        _id: bookingId,
        status: { $ne: "confirmed" },
        isConnected: { $ne: true },
      },
      {
        $set: {
          status: "reviewing",
          isAcknowledgedByAdmin: true,
          acknowledgedAt: new Date(),
          adminResponseMessage: "Admin is approving this booking.",
        },
      },
      { returnDocument: "after", runValidators: true }
    );
    if (!booking) {
      const existingBooking = await Booking.findById(bookingId).select("status isConnected");
      if (existingBooking) {
        return res.status(409).json({ message: "Booking is already approved or connected." });
      }
      return res.status(404).json({ message: "Booking not found." });
    }

    const businessId = req.body.businessId || booking.preferredHotelId || booking.hotelId;
    const quantity = Math.max(1, Number(req.body.quantity || booking.quantity || booking.guests || 1));
    if (!businessId) {
      await Booking.updateOne(
        { _id: booking._id, status: "reviewing" },
        {
          $set: {
            status: "pending",
            isConnected: false,
            adminResponseMessage: "Admin must select a business before this booking can be approved.",
          },
        }
      );
      return res.status(400).json({ message: "Select a business before approving this booking." });
    }

    const business = await Hotel.findOneAndUpdate(
      {
        _id: businessId,
        approvalStatus: "approved",
        status: "available",
        quantityRemaining: { $gte: quantity },
      },
      { $inc: { quantityRemaining: -quantity, availableQuantity: -quantity } },
      { returnDocument: "after", runValidators: true }
    );

    if (!business) {
      await Booking.updateOne(
        { _id: booking._id, status: "reviewing" },
        {
          $set: {
            status: "pending",
            isConnected: false,
            adminResponseMessage:
              "Business is not approved, unavailable, or does not have enough quantity remaining.",
          },
        }
      );
      return res.status(409).json({
        message: "Business is not approved, unavailable, or does not have enough quantity remaining.",
      });
    }

    booking.hotelId = business._id;
    booking.preferredHotelId = booking.preferredHotelId || business._id;
    booking.supplierId = business.supplierId || null;
    booking.quantity = quantity;
    booking.status = "confirmed";
    booking.isConnected = true;
    booking.isAcknowledgedByAdmin = true;
    booking.acknowledgedAt = new Date();
    booking.adminResponseMessage = `Booking approved and assigned to ${business.name}.`;
    if (!booking.bookingCode) booking.bookingCode = prefixedCode("SCN", 10);
    if (!booking.verificationCode) booking.verificationCode = prefixedCode("VERIFY", 10);
    if (!booking.verificationToken) {
      booking.verificationToken = secureToken([booking._id, booking.bookingCode, booking.touristId]);
    }
    await booking.save();

    if (Number(business.quantityRemaining || 0) <= 0) {
      business.status = "unavailable";
      business.inventoryStatus = "fully-booked";
      await business.save();
    } else if (Number(business.quantityRemaining || 0) <= 3) {
      business.inventoryStatus = "limited";
      await business.save();
    }

    emitUserRealtime(booking.touristId, REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "confirmed",
      bookingId: booking._id,
      status: booking.status,
    });
    emitHotelRealtime(business._id, REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "assigned",
      bookingId: booking._id,
      businessId: business._id,
    });
    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "booking-approved", businessId: business._id });

    return res.json({ message: "Booking approved and sent to seller.", booking, business });
  } catch (error) {
    return res.status(500).json({ message: "Failed to approve booking.", error: error.message });
  }
};

const listTransactions = async (_req, res) => {
  try {
    const transactions = await Transaction.find({})
      .populate("bookingId", "bookingCode status paymentStatus")
      .populate("userId", "name email")
      .populate("sellerId", "name email sellerId")
      .populate("businessId", "name type")
      .sort({ createdAt: -1 });

    const summary = transactions.reduce(
      (acc, tx) => {
        if (tx.status === "paid") {
          acc.totalReceived += Number(tx.amount || 0);
          acc.commissionEarned += Number(tx.commissionAmount || 0);
        } else {
          acc.pendingPayments += Number(tx.amount || 0);
        }
        return acc;
      },
      { totalReceived: 0, commissionEarned: 0, pendingPayments: 0 }
    );

    return res.json({ transactions, summary });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch transactions.", error: error.message });
  }
};

const ACCOMMODATION_TYPES = new Set([
  "hotel",
  "hotels-and-resorts",
  "homestays-and-guesthouses",
  "tent-rentals-and-camping-sites",
  "vacation-rentals-and-apartments",
]);

const normalizeBusinessType = (value) =>
  String(value || "hotel")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[ /]+/g, "-");

const getBusinessInventoryMeta = (type) => {
  const normalizedType = normalizeBusinessType(type);

  if (ACCOMMODATION_TYPES.has(normalizedType)) {
    return {
      supportsRooms: true,
      inventoryLabel: "rooms",
      availableLabel: "available rooms",
    };
  }

  if (
    ["car-rentals", "motorbike-and-scooter-rentals", "taxi-and-ride-services", "bus-and-minivan-charters"].includes(
      normalizedType
    )
  ) {
    return {
      supportsRooms: false,
      inventoryLabel: "vehicles",
      availableLabel: "available services",
    };
  }

  if (
    ["restaurants", "bars-and-pubs", "coffee-shops-and-cafes", "food-trucks-and-street-food-stalls"].includes(
      normalizedType
    )
  ) {
    return {
      supportsRooms: false,
      inventoryLabel: "menu items",
      availableLabel: "available services",
    };
  }

  if (
    ["conference-event-halls-mice", "wedding-venues", "entertainment-venues"].includes(
      normalizedType
    )
  ) {
    return {
      supportsRooms: false,
      inventoryLabel: "venue packages",
      availableLabel: "available services",
    };
  }

  if (normalizedType === "tour-and-activity-operators") {
    return {
      supportsRooms: false,
      inventoryLabel: "activities",
      availableLabel: "available services",
    };
  }

  return {
    supportsRooms: false,
    inventoryLabel: "services",
    availableLabel: "available services",
  };
};

const getHotelStatus = async (req, res) => {
  try {
    const { hotelId } = req.params;

    const [hotel, rooms, bookings] = await Promise.all([
      Hotel.findById(hotelId),
      Room.find({ hotelId }).sort({ roomNumber: 1 }),
      Booking.find({
        $or: [{ hotelId }, { preferredHotelId: hotelId }],
      })
        .populate("touristId", "name email")
        .populate("roomId", "roomNumber type price status")
        .populate("tourHelpers", "name phone email")
        .sort({ createdAt: -1 }),
    ]);

    if (!hotel) {
      return res.status(404).json({ message: "Hotel not found." });
    }

    const inventoryMeta = getBusinessInventoryMeta(hotel.type);
    const serviceList = Array.isArray(hotel.services) ? hotel.services : [];
    const availableRooms = rooms.filter((room) => room.status === "available");
    const occupiedRooms = rooms.filter((room) => room.status === "occupied");
    const maintenanceRooms = rooms.filter((room) => room.status === "maintenance");
    const assignedBookings = bookings.filter(
      (booking) => String(booking.hotelId) === String(hotel._id)
    );
    const pendingPreferredBookings = bookings.filter(
      (booking) =>
        String(booking.preferredHotelId) === String(hotel._id) &&
        String(booking.hotelId || "") !== String(hotel._id)
    );

    return res.json({
      hotel,
      rooms,
      bookings,
      stats: {
        totalRooms: rooms.length,
        availableRooms: availableRooms.length,
        occupiedRooms: occupiedRooms.length,
        maintenanceRooms: maintenanceRooms.length,
        availableRoomNumbers: availableRooms.map((room) => room.roomNumber),
        totalInventory: inventoryMeta.supportsRooms ? rooms.length : serviceList.length,
        availableInventory: inventoryMeta.supportsRooms
          ? availableRooms.length
          : serviceList.length,
        inventoryLabel: inventoryMeta.inventoryLabel,
        availableLabel: inventoryMeta.availableLabel,
        supportsRooms: inventoryMeta.supportsRooms,
        servicesCount: serviceList.length,
        services: serviceList,
        assignedBookings: assignedBookings.length,
        pendingPreferredBookings: pendingPreferredBookings.length,
        canAcceptVisitors: inventoryMeta.supportsRooms
          ? availableRooms.length > 0
          : serviceList.length > 0,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch hotel status.",
      error: error.message,
    });
  }
};

const connectTour = async (req, res) => {
  try {
    const { bookingId, hotelId, roomId, helperIds = [] } = req.body;

    if (!bookingId || !hotelId || !roomId) {
      return res
        .status(400)
        .json({ message: "bookingId, hotelId and roomId are required." });
    }

    const [booking, hotel, room] = await Promise.all([
      Booking.findById(bookingId),
      Hotel.findById(hotelId),
      Room.findById(roomId),
    ]);

    if (!booking) {
      return res.status(404).json({ message: "Booking not found." });
    }
    if (booking.isConnected || booking.status === "confirmed") {
      return res.status(400).json({ message: "Booking is already connected." });
    }
    if (!hotel) {
      return res.status(404).json({ message: "Hotel not found." });
    }
    if (!room) {
      return res.status(404).json({ message: "Room not found." });
    }
    if (String(room.hotelId) !== String(hotel._id)) {
      return res
        .status(400)
        .json({ message: "Room does not belong to this hotel." });
    }
    if (room.status !== "available") {
      return res.status(400).json({ message: "Room is not available." });
    }

    const uniqueHelperIds = Array.isArray(helperIds)
      ? [...new Set(helperIds.filter(Boolean))]
      : [];
    if (uniqueHelperIds.length === 0) {
      return res.status(400).json({
        message: "Select at least one tour helper for this trip.",
      });
    }

    const helpers = uniqueHelperIds.length
      ? await User.find({
          _id: { $in: uniqueHelperIds },
          role: "tourHelper",
        }).select("name email phone")
      : [];

    if (uniqueHelperIds.length !== helpers.length) {
      return res.status(400).json({
        message: "One or more selected tour helpers are invalid.",
      });
    }

    const claimedRoom = await Room.findOneAndUpdate(
      { _id: roomId, hotelId: hotel._id, status: "available" },
      { $set: { status: "occupied" } },
      { returnDocument: "after", runValidators: true }
    );

    if (!claimedRoom) {
      return res.status(409).json({
        message: "Room was just booked by another request. Please select another available room.",
      });
    }

    const adminResponseMessage = `Assigned to ${hotel.name} in ${hotel.location}.${helpers.length > 0 ? ` Tour helpers: ${helpers.map((helper) => `${helper.name} - ${helper.phone || helper.email}`).join(", ")}.` : ""}`;
    const connectedBooking = await Booking.findOneAndUpdate(
      {
        _id: bookingId,
        isConnected: { $ne: true },
        status: { $ne: "confirmed" },
      },
      {
        $set: {
          hotelId: hotel._id,
          roomId: claimedRoom._id,
          tourHelpers: helpers.map((helper) => helper._id),
          status: "confirmed",
          isConnected: true,
          isAcknowledgedByAdmin: true,
          acknowledgedAt: booking.acknowledgedAt || new Date(),
          totalPrice: booking.totalPrice || claimedRoom.price,
          adminResponseMessage,
        },
      },
      { returnDocument: "after", runValidators: true }
    );

    if (!connectedBooking) {
      await Room.updateOne(
        { _id: claimedRoom._id, status: "occupied" },
        { $set: { status: "available" } }
      );
      return res.status(409).json({
        message: "Booking was already connected. Room was released.",
      });
    }

    emitHotelRealtime(hotel._id, REALTIME_EVENTS.ROOM_CHANGED, {
      action: "claimed",
      roomId: claimedRoom._id,
      hotelId: hotel._id,
      status: claimedRoom.status,
    });
    emitUserRealtime(connectedBooking.touristId, REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "confirmed",
      bookingId: connectedBooking._id,
      hotelId: hotel._id,
      roomId: claimedRoom._id,
      status: connectedBooking.status,
    });
    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "booking-confirmed", hotelId: hotel._id });

    return res.json({
      message: "Tourist request connected to room successfully.",
      booking: connectedBooking,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Failed to connect tour.", error: error.message });
  }
};

const acknowledgeRequest = async (req, res) => {
  try {
    const { bookingId, message } = req.body;

    if (!bookingId) {
      return res.status(400).json({ message: "bookingId is required." });
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found." });
    }

    booking.isAcknowledgedByAdmin = true;
    booking.acknowledgedAt = new Date();
    booking.adminResponseMessage =
      (message || "").trim() ||
      "Admin has received your request and is reviewing the best hotel option for you.";

    await booking.save();

    emitUserRealtime(booking.touristId, REALTIME_EVENTS.NOTIFICATION, {
      action: "booking-acknowledged",
      bookingId: booking._id,
      message: booking.adminResponseMessage,
    });
    emitRealtime(REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "acknowledged",
      bookingId: booking._id,
      status: booking.status,
    });

    return res.json({
      message: "User request acknowledgment sent successfully.",
      booking,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to acknowledge request.",
      error: error.message,
    });
  }
};

const listUsers = async (_req, res) => {
  try {
    const users = await User.find({})
      .select("-password")
      .sort({ createdAt: -1 });

    return res.json({ users });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch users.",
      error: error.message,
    });
  }
};

const listHotels = async (_req, res) => {
  try {
    const hotelsRaw = await Hotel.aggregate([
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: "rooms",
          localField: "_id",
          foreignField: "hotelId",
          as: "rooms",
        },
      },
      {
        $addFields: {
          type: { $ifNull: ["$type", "hotel"] },
          totalRooms: { $size: "$rooms" },
          availableRooms: {
            $size: {
              $filter: {
                input: "$rooms",
                as: "room",
                cond: { $eq: ["$$room.status", "available"] },
              },
            },
          },
          occupiedRooms: {
            $size: {
              $filter: {
                input: "$rooms",
                as: "room",
                cond: { $eq: ["$$room.status", "occupied"] },
              },
            },
          },
          maintenanceRooms: {
            $size: {
              $filter: {
                input: "$rooms",
                as: "room",
                cond: { $eq: ["$$room.status", "maintenance"] },
              },
            },
          },
        },
      },
      {
        $addFields: {
          canAcceptVisitors: { $gt: ["$availableRooms", 0] },
          servicesCount: { $size: { $ifNull: ["$services", []] } },
        },
      },
      { $project: { rooms: 0 } },
    ]);

    const hotels = hotelsRaw.map((hotel) => {
      const inventoryMeta = getBusinessInventoryMeta(hotel.type);
      const servicesCount = Number(hotel.servicesCount || 0);

      return {
        ...hotel,
        inventoryLabel: inventoryMeta.inventoryLabel,
        supportsRooms: inventoryMeta.supportsRooms,
        totalInventory: inventoryMeta.supportsRooms
          ? Number(hotel.totalRooms || 0)
          : servicesCount,
        availableInventory: inventoryMeta.supportsRooms
          ? Number(hotel.availableRooms || 0)
          : servicesCount,
        canAcceptVisitors: inventoryMeta.supportsRooms
          ? Number(hotel.availableRooms || 0) > 0
          : servicesCount > 0,
      };
    });

    return res.json({ hotels, businesses: hotels });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch hotels.",
      error: error.message,
    });
  }
};

const listBookings = async (_req, res) => {
  try {
    const bookings = await Booking.find({})
      .populate("touristId", "name email role")
      .populate("preferredHotelId", "name location ownerEmail")
      .populate("hotelId", "name location ownerEmail")
      .populate("roomId", "roomNumber type price status")
      .populate("tourHelpers", "name phone email")
      .sort({ createdAt: -1 });

    return res.json({ bookings });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch bookings.",
      error: error.message,
    });
  }
};

const listHotelRooms = async (req, res) => {
  try {
    const { hotelId } = req.params;
    const rooms = await Room.find({ hotelId }).sort({ roomNumber: 1 });
    return res.json({ rooms });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch hotel rooms.",
      error: error.message,
    });
  }
};

const listRooms = async (_req, res) => {
  try {
    const rooms = await Room.find({})
      .populate("hotelId", "name location")
      .sort({ createdAt: -1 });

    return res.json({ rooms });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch rooms.",
      error: error.message,
    });
  }
};

const deleteHotel = async (req, res) => {
  try {
    const { hotelId } = req.params;
    const hotel = await Hotel.findById(hotelId);
    if (!hotel) {
      return res.status(404).json({ message: "Hotel not found." });
    }

    await Promise.all([
      // Remove the hotel owner account.
      User.deleteMany({ role: "hotel", hotelId: hotel._id }),
      // Remove rooms linked to this hotel.
      Room.deleteMany({ hotelId: hotel._id }),
      // Reset linked bookings so they become unassigned and visible for reassignment.
      Booking.updateMany(
        { hotelId: hotel._id },
        {
          $set: {
            hotelId: null,
            roomId: null,
            isConnected: false,
            status: "pending",
            adminResponseMessage:
              "Your assigned hotel was removed. Admin will reassign your request.",
          },
        }
      ),
    ]);

    await Hotel.deleteOne({ _id: hotel._id });

    emitRealtime(REALTIME_EVENTS.HOTEL_CHANGED, {
      action: "deleted",
      hotelId: hotel._id,
    });
    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "hotel-deleted" });

    return res.json({
      message: "Hotel deleted successfully.",
      deletedHotelId: hotel._id,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to delete hotel.",
      error: error.message,
    });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const targetUser = await User.findById(userId);

    if (!targetUser) {
      return res.status(404).json({ message: "User not found." });
    }

    if (String(targetUser._id) === String(req.user._id)) {
      return res.status(400).json({ message: "Admin cannot delete own account." });
    }

    if (targetUser.role === "hotel") {
      const hotels = await Hotel.find({
        $or: [
          { ownerUserId: targetUser._id },
          { ownerEmail: targetUser.email },
          ...(targetUser.hotelId ? [{ _id: targetUser.hotelId }] : []),
        ],
      }).select("_id");
      const hotelIds = hotels.map((hotel) => hotel._id);

      if (hotelIds.length > 0) {
        await Promise.all([
          Room.deleteMany({ hotelId: { $in: hotelIds } }),
          HotelService.deleteMany({ hotelId: { $in: hotelIds } }),
          Booking.updateMany(
            { hotelId: { $in: hotelIds } },
            {
              $set: {
                hotelId: null,
                roomId: null,
                isConnected: false,
                status: "pending",
                adminResponseMessage:
                  "Your assigned hotel owner account was removed. Admin will reassign your request.",
              },
            }
          ),
        ]);
        await Hotel.deleteMany({ _id: { $in: hotelIds } });
        emitRealtime(REALTIME_EVENTS.HOTEL_CHANGED, {
          action: "deleted",
          hotelIds,
        });
        emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "hotel-user-deleted" });
      }

      await User.deleteOne({ _id: targetUser._id });
      return res.json({
        message: "Seller user and linked business data deleted successfully.",
      });
    }

    if (targetUser.role === "tourist") {
      const userBookings = await Booking.find({ touristId: targetUser._id }).select(
        "roomId"
      );
      const roomIds = userBookings
        .map((booking) => booking.roomId)
        .filter((roomId) => roomId);

      if (roomIds.length > 0) {
        await Room.updateMany({ _id: { $in: roomIds } }, { $set: { status: "available" } });
      }

      await Booking.deleteMany({ touristId: targetUser._id });
      emitRealtime(REALTIME_EVENTS.BOOKING_CHANGED, {
        action: "tourist-deleted",
        touristId: targetUser._id,
      });
    }

    await User.deleteOne({ _id: targetUser._id });

    return res.json({ message: "User deleted successfully." });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to delete user.",
      error: error.message,
    });
  }
};

const findBookingForVerification = async (lookup, sellerFilter = null) => {
  const query = {
    $or: [
      { _id: /^[a-f\d]{24}$/i.test(String(lookup)) ? lookup : undefined },
      { bookingCode: lookup },
      { verificationCode: lookup },
      { verificationToken: lookup },
      { paymentReference: lookup },
    ].filter((item) => Object.values(item)[0] !== undefined),
  };
  if (sellerFilter) query.hotelId = sellerFilter;
  return Booking.findOne(query)
    .populate("touristId", "name email phone role")
    .populate("preferredHotelId", "name location type sellerContactEmail ownerEmail")
    .populate("hotelId", "name location type sellerContactEmail ownerEmail")
    .populate("roomId", "roomNumber type price status")
    .populate("tourHelpers", "name phone email");
};

const verifyBookingByLookup = async (req, res) => {
  try {
    const booking = await findBookingForVerification(req.params.lookup);
    if (!booking) return res.status(404).json({ message: "Booking not found." });
    return res.json({ booking });
  } catch (error) {
    return res.status(500).json({ message: "Failed to verify booking.", error: error.message });
  }
};

const deleteUsers = async (req, res) => {
  try {
    const userIds = Array.isArray(req.body.userIds)
      ? req.body.userIds.filter(Boolean)
      : [];

    if (userIds.length === 0) {
      return res.status(400).json({ message: "Select at least one user to delete." });
    }

    if (userIds.some((userId) => String(userId) === String(req.user._id))) {
      return res.status(400).json({ message: "Admin cannot delete own account." });
    }

    const results = [];
    for (const userId of userIds) {
      const targetUser = await User.findById(userId);
      if (!targetUser) {
        results.push({ userId, status: "not-found" });
        continue;
      }

      if (targetUser.role === "hotel") {
        const businessIds = await Hotel.find({
          $or: [
            { ownerUserId: targetUser._id },
            { ownerEmail: targetUser.email },
            ...(targetUser.hotelId ? [{ _id: targetUser.hotelId }] : []),
          ],
        }).select("_id");
        const ids = businessIds.map((business) => business._id);
        await Promise.all([
          Hotel.deleteMany({ _id: { $in: ids } }),
          Room.deleteMany({ hotelId: { $in: ids } }),
          Booking.updateMany(
            { hotelId: { $in: ids } },
            {
              $set: {
                hotelId: null,
                roomId: null,
                isConnected: false,
                status: "pending",
                adminResponseMessage:
                  "The assigned seller account was removed. Admin will reassign this booking.",
              },
            }
          ),
        ]);
      }

      if (["tourist", "customer"].includes(targetUser.role)) {
        await Booking.deleteMany({ touristId: targetUser._id });
      }

      await User.deleteOne({ _id: targetUser._id });
      results.push({ userId, status: "deleted" });
    }

    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "users-deleted" });
    emitRealtime(REALTIME_EVENTS.BOOKING_CHANGED, { action: "users-deleted" });

    return res.json({
      message: `${results.filter((item) => item.status === "deleted").length} user(s) deleted.`,
      results,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to delete selected users.",
      error: error.message,
    });
  }
};

const deleteBusiness = async (req, res) => {
  try {
    const { businessId } = req.params;
    const business = await Hotel.findById(businessId);
    if (!business) {
      return res.status(404).json({ message: "Business not found." });
    }

    await Promise.all([
      Room.deleteMany({ hotelId: business._id }),
      HotelService.deleteMany({ hotelId: business._id }),
      Booking.updateMany(
        { hotelId: business._id },
        {
          $set: {
            hotelId: null,
            roomId: null,
            isConnected: false,
            status: "pending",
            adminResponseMessage:
              "The assigned business was removed. Admin will reassign this booking.",
          },
        }
      ),
    ]);
    await Hotel.deleteOne({ _id: business._id });

    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "business-deleted" });
    return res.json({ message: "Business deleted successfully." });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to delete business.",
      error: error.message,
    });
  }
};

const purgeVisitors = async (_req, res) => {
  try {
    const visitors = await User.find({ role: "tourist" }).select("_id");
    const visitorIds = visitors.map((visitor) => visitor._id);

    if (visitorIds.length > 0) {
      const visitorBookings = await Booking.find({
        touristId: { $in: visitorIds },
      }).select("roomId");
      const roomIds = visitorBookings
        .map((booking) => booking.roomId)
        .filter((roomId) => roomId);

      if (roomIds.length > 0) {
        await Room.updateMany(
          { _id: { $in: roomIds } },
          { $set: { status: "available" } }
        );
      }

      await Booking.deleteMany({ touristId: { $in: visitorIds } });
      await User.deleteMany({ role: "tourist" });
    }

    const remaining = await User.find({})
      .select("name email role")
      .sort({ role: 1, createdAt: 1 });

    return res.json({
      message:
        "All visitor/tourist users deleted. Admin and hotel users were kept.",
      remainingUsers: remaining,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to purge visitors.",
      error: error.message,
    });
  }
};

const dashboardStats = async (_req, res) => {
  try {
    const [businesses, totalRooms, availableRooms, totalBookings, revenueAgg] =
      await Promise.all([
        Hotel.find({}).select("type services approvalStatus"),
        Room.countDocuments(),
        Room.countDocuments({ status: "available" }),
        Booking.countDocuments(),
        Booking.aggregate([
          {
            $match: {
              status: { $in: ["confirmed", "completed"] },
            },
          },
          {
            $group: {
              _id: null,
              revenue: { $sum: "$totalPrice" },
            },
          },
        ]),
      ]);

    const totalHotels = businesses.length;
    const pendingApprovals = businesses.filter((business) => business.approvalStatus === "pending").length;
    const totalServices = businesses.reduce(
      (sum, business) => sum + (Array.isArray(business.services) ? business.services.length : 0),
      0
    );
    const availableInventory = businesses.reduce((sum, business) => {
      const inventoryMeta = getBusinessInventoryMeta(business.type);
      if (inventoryMeta.supportsRooms) return sum;
      return sum + (Array.isArray(business.services) ? business.services.length : 0);
    }, availableRooms);

    return res.json({
      totalHotels,
      totalBusinesses: totalHotels,
      totalRooms,
      availableRooms,
      totalServices,
      availableInventory,
      totalBookings,
      revenue: revenueAgg[0]?.revenue || 0,
      totalRevenue: revenueAgg[0]?.revenue || 0,
      totalUsers: await User.countDocuments(),
      pendingApprovals,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch dashboard stats.",
      error: error.message,
    });
  }
};

module.exports = {
  registerHotel,
  registerBusiness,
  createSeller,
  updateAnnouncement,
  listServices,
  updateBusinessVerification,
  approveBooking,
  verifyBookingByLookup,
  listTransactions,
  deleteUsers,
  deleteBusiness,
  getHotelStatus,
  connectTour,
  acknowledgeRequest,
  dashboardStats,
  listUsers,
  listHotels,
  listBookings,
  listRooms,
  listHotelRooms,
  deleteHotel,
  deleteUser,
  purgeVisitors,
};
