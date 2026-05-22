const Booking = require("../models/Booking");
const Business = require("../models/Business");
const Room = require("../models/Room");
const User = require("../models/User");
const { registerHotelByAdmin } = require("./authController");
const {
  REALTIME_EVENTS,
  emitHotelRealtime,
  emitRealtime,
  emitUserRealtime,
} = require("../utils/realtime");
const { decorateBusiness, getMarketplaceTypeConfig } = require("../utils/marketplaceTypes");

const registerHotel = registerHotelByAdmin;
const registerBusiness = registerHotelByAdmin;

const normalizeBusinessType = (value) =>
  String(value || "hotel")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[ /]+/g, "-");

const getBusinessInventoryMeta = (type) => {
  const config = getMarketplaceTypeConfig(type);

  if (config.supportsRooms) {
    return {
      supportsRooms: true,
      inventoryLabel: "rooms",
      availableLabel: "available rooms",
      assignmentType: "room",
    };
  }

  return {
    supportsRooms: false,
    inventoryLabel: config.inventoryType || "services",
    availableLabel: `available ${config.inventoryType || "services"}`,
    assignmentType: config.assignmentType || "service",
  };
};

const getHotelStatus = async (req, res) => {
  try {
    const { hotelId } = req.params;

    const [hotel, rooms, bookings] = await Promise.all([
      Business.findById(hotelId),
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
      return res.status(404).json({ message: "Business not found." });
    }

    const decoratedHotel = decorateBusiness(hotel);
    const inventoryMeta = getBusinessInventoryMeta(decoratedHotel.businessType || decoratedHotel.type);
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
      hotel: decoratedHotel,
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

    if (!bookingId || !hotelId) {
      return res
        .status(400)
        .json({ message: "bookingId and businessId are required." });
    }

    const [booking, hotel, room] = await Promise.all([
      Booking.findById(bookingId),
      Business.findById(hotelId),
      roomId ? Room.findById(roomId) : null,
    ]);

    if (!booking) {
      return res.status(404).json({ message: "Booking not found." });
    }
    if (booking.isConnected || booking.status === "confirmed") {
      return res.status(400).json({ message: "Booking is already connected." });
    }
    if (!hotel) {
      return res.status(404).json({ message: "Business not found." });
    }
    const business = decorateBusiness(hotel);
    const marketplaceConfig = getMarketplaceTypeConfig(business.businessType || business.type);

    if (marketplaceConfig.supportsRooms && !room) {
      return res.status(404).json({ message: "Room not found." });
    }
    if (room && String(room.hotelId) !== String(hotel._id)) {
      return res
        .status(400)
        .json({ message: "Room does not belong to this business." });
    }
    if (room && room.status !== "available") {
      return res.status(400).json({ message: "Room is not available." });
    }

    const uniqueHelperIds = Array.isArray(helperIds)
      ? [...new Set(helperIds.filter(Boolean))]
      : [];
    if (marketplaceConfig.assignmentType === "guide" && uniqueHelperIds.length === 0) {
      return res.status(400).json({
        message: "Select at least one guide for this activity booking.",
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

    let claimedRoom = null;
    if (marketplaceConfig.supportsRooms) {
      claimedRoom = await Room.findOneAndUpdate(
        { _id: roomId, hotelId: hotel._id, status: "available" },
        { $set: { status: "occupied" } },
        { new: true, runValidators: true }
      );

      if (!claimedRoom) {
        return res.status(409).json({
          message: "Room was just booked by another request. Please select another available room.",
        });
      }
    }

    const assignmentLabel = marketplaceConfig.supportsRooms
      ? `Room ${claimedRoom.roomNumber}`
      : `Assigned ${marketplaceConfig.assignmentType || "service"}`;
    const helperLabel = marketplaceConfig.assignmentType === "guide" ? "Guides" : "Helpers";
    const adminResponseMessage = `Assigned to ${hotel.name} in ${hotel.location}.${assignmentLabel ? ` ${assignmentLabel}.` : ""}${helpers.length > 0 ? ` ${helperLabel}: ${helpers.map((helper) => `${helper.name} - ${helper.phone || helper.email}`).join(", ")}.` : ""}`;
    const connectedBooking = await Booking.findOneAndUpdate(
      {
        _id: bookingId,
        isConnected: { $ne: true },
        status: { $ne: "confirmed" },
      },
      {
        $set: {
          hotelId: hotel._id,
          roomId: claimedRoom?._id || null,
          assignmentType: marketplaceConfig.assignmentType,
          assignmentTargetId: claimedRoom?._id || hotel._id,
          assignmentLabel,
          businessType: marketplaceConfig.businessType,
          serviceCategory: marketplaceConfig.serviceCategory,
          bookingModel: marketplaceConfig.bookingModel,
          pricingModel: marketplaceConfig.pricingModel,
          pricingUnit: marketplaceConfig.pricingUnit,
          tourHelpers: helpers.map((helper) => helper._id),
          status: "confirmed",
          isConnected: true,
          isAcknowledgedByAdmin: true,
          acknowledgedAt: booking.acknowledgedAt || new Date(),
          totalPrice: booking.totalPrice || claimedRoom?.price || hotel.basePrice || 0,
          adminResponseMessage,
        },
      },
      { new: true, runValidators: true }
    );

    if (!connectedBooking) {
      if (claimedRoom) {
        await Room.updateOne(
          { _id: claimedRoom._id, status: "occupied" },
          { $set: { status: "available" } }
        );
      }
      return res.status(409).json({
        message: "Booking was already connected. Room was released.",
      });
    }

    if (claimedRoom) {
      emitHotelRealtime(hotel._id, REALTIME_EVENTS.ROOM_CHANGED, {
        action: "claimed",
        roomId: claimedRoom._id,
        hotelId: hotel._id,
        businessId: hotel._id,
        status: claimedRoom.status,
      });
    }
    emitHotelRealtime(hotel._id, REALTIME_EVENTS.SERVICE_CHANGED, {
      action: "booking-assigned",
      businessId: hotel._id,
      bookingId: connectedBooking._id,
      bookingModel: marketplaceConfig.bookingModel,
      assignmentType: marketplaceConfig.assignmentType,
    });
    emitUserRealtime(connectedBooking.touristId, REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "confirmed",
      bookingId: connectedBooking._id,
      hotelId: hotel._id,
      businessId: hotel._id,
      roomId: claimedRoom?._id || null,
      assignmentType: marketplaceConfig.assignmentType,
      status: connectedBooking.status,
    });
    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "booking-confirmed", hotelId: hotel._id, businessId: hotel._id });

    return res.json({
      message: `Booking assigned to ${marketplaceConfig.assignmentType || "service"} successfully.`,
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
      "Admin has received your request and is reviewing the best marketplace provider for you.";

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
    const hotelsRaw = await Business.aggregate([
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
      const decorated = decorateBusiness(hotel);
      const inventoryMeta = getBusinessInventoryMeta(decorated.businessType || decorated.type);
      const servicesCount = Number(hotel.servicesCount || 0);

      return {
        ...decorated,
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
    const hotel = await Business.findById(hotelId);
    if (!hotel) {
      return res.status(404).json({ message: "Business not found." });
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
              "Your assigned business was removed. Admin will reassign your request.",
          },
        }
      ),
    ]);

    await Business.deleteOne({ _id: hotel._id });

    emitRealtime(REALTIME_EVENTS.HOTEL_CHANGED, {
      action: "deleted",
      hotelId: hotel._id,
    });
    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "hotel-deleted" });

    return res.json({
      message: "Business deleted successfully.",
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
      const hotel = await Business.findById(targetUser.hotelId);
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
                  "Your assigned business owner account was removed. Admin will reassign your request.",
              },
            }
          ),
        ]);
        await Business.deleteOne({ _id: hotel._id });
        emitRealtime(REALTIME_EVENTS.HOTEL_CHANGED, {
          action: "deleted",
          hotelId: hotel._id,
        });
        emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "hotel-user-deleted" });
      } else {
        await User.deleteOne({ _id: targetUser._id });
      }

      return res.json({
        message: "Business owner and linked business data deleted successfully.",
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
        Business.find({}).select("type businessType services"),
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
