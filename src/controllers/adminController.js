const Booking = require("../models/Booking");
const Hotel = require("../models/Hotel");
const Room = require("../models/Room");
const User = require("../models/User");
const { registerHotelByAdmin } = require("./authController");

const registerHotel = registerHotelByAdmin;
const registerBusiness = registerHotelByAdmin;

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

    booking.hotelId = hotel._id;
    booking.roomId = room._id;
    booking.tourHelpers = helpers.map((helper) => helper._id);
    booking.status = "confirmed";
    booking.isConnected = true;
    booking.isAcknowledgedByAdmin = true;
    booking.acknowledgedAt = booking.acknowledgedAt || new Date();
    booking.totalPrice = booking.totalPrice || room.price;
    booking.adminResponseMessage = `Assigned to ${hotel.name} in ${hotel.location}.${helpers.length > 0 ? ` Tour helpers: ${helpers.map((helper) => `${helper.name} - ${helper.phone || helper.email}`).join(", ")}.` : ""}`;

    room.status = "occupied";

    await Promise.all([booking.save(), room.save()]);

    return res.json({
      message: "Tourist request connected to room successfully.",
      booking,
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

    if (targetUser.role === "hotel" && targetUser.hotelId) {
      const hotel = await Hotel.findById(targetUser.hotelId);
      if (hotel) {
        await Promise.all([
          User.deleteMany({ role: "hotel", hotelId: hotel._id }),
          Room.deleteMany({ hotelId: hotel._id }),
          Booking.updateMany(
            { hotelId: hotel._id },
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
        await Hotel.deleteOne({ _id: hotel._id });
      } else {
        await User.deleteOne({ _id: targetUser._id });
      }

      return res.json({
        message: "Hotel user and linked hotel data deleted successfully.",
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
        Hotel.find({}).select("type services"),
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
