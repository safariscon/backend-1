const Booking = require("../models/Booking");
const Business = require("../models/Business");
const BusinessService = require("../models/BusinessService");
const User = require("../models/User");
const { registerHotelByAdmin } = require("./authController");
const { REALTIME_EVENTS, emitRealtime, emitHotelRealtime, emitUserRealtime } = require("../utils/realtime");
const { decorateBusiness } = require("../utils/marketplaceTypes");
const { clearCache } = require("../utils/cache");

const registerHotel = registerHotelByAdmin;
const registerBusiness = registerHotelByAdmin;

const getHotelStatus = async (req, res) => {
  try {
    const { hotelId } = req.params;
    const [business, services, bookings] = await Promise.all([
      Business.findById(hotelId).lean(),
      BusinessService.find({ businessId: hotelId }).sort({ category: 1, title: 1 }).lean(),
      Booking.find({ businessId: hotelId })
        .populate("userId touristId", "name email phone")
        .populate("serviceId", "title category pricing availableQuantity status")
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    if (!business) {
      return res.status(404).json({ message: "Business not found." });
    }

    const activeServices = services.filter((service) => service.isActive !== false);
    const availableQuantity = activeServices.reduce(
      (sum, service) => sum + Number(service.availableQuantity || 0),
      0
    );

    return res.json({
      business: decorateBusiness(business),
      hotel: decorateBusiness(business),
      services,
      bookings,
      stats: {
        totalServices: services.length,
        activeServices: activeServices.length,
        totalBookings: bookings.length,
        availableQuantity,
        totalInventory: services.length,
        availableInventory: availableQuantity,
        inventoryLabel: "services",
        availableLabel: "available quantity",
        canAcceptBookings: availableQuantity > 0,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch business status.",
      error: error.message,
    });
  }
};

const assignBooking = async (req, res) => {
  try {
    const { bookingId, businessId, hotelId, serviceId, status = "confirmed" } = req.body;
    const resolvedBusinessId = businessId || hotelId;

    if (!bookingId || !resolvedBusinessId) {
      return res.status(400).json({ message: "bookingId and businessId are required." });
    }

    const [booking, business, service] = await Promise.all([
      Booking.findById(bookingId),
      Business.findById(resolvedBusinessId),
      serviceId ? BusinessService.findOne({ _id: serviceId, businessId: resolvedBusinessId }) : null,
    ]);

    if (!booking) return res.status(404).json({ message: "Booking not found." });
    if (!business) return res.status(404).json({ message: "Business not found." });
    if (serviceId && !service) return res.status(404).json({ message: "Service not found for this business." });

    booking.businessId = business._id;
    booking.hotelId = business._id;
    booking.preferredBusinessId = booking.preferredBusinessId || business._id;
    booking.preferredHotelId = booking.preferredHotelId || business._id;
    booking.serviceId = service?._id || booking.serviceId || null;
    booking.assignmentType = "service";
    booking.assignmentTargetId = service?._id || business._id;
    booking.assignmentLabel = service?.title || service?.name || business.businessName || business.name;
    booking.status = status;
    booking.bookingStatus = status;
    booking.isConnected = true;
    booking.isAcknowledgedByAdmin = true;
    booking.acknowledgedAt = booking.acknowledgedAt || new Date();
    booking.adminResponseMessage = `Booking assigned to ${business.businessName || business.name}.`;
    await booking.save();

    const payload = {
      action: "assigned",
      bookingId: booking._id,
      bookingCode: booking.bookingCode,
      businessId: business._id,
      serviceId: booking.serviceId,
      status: booking.status,
    };
    emitRealtime(REALTIME_EVENTS.BOOKING_CHANGED, payload);
    emitHotelRealtime(business._id, REALTIME_EVENTS.BOOKING_CHANGED, payload);
    emitUserRealtime(booking.userId || booking.touristId, REALTIME_EVENTS.BOOKING_CHANGED, payload);

    return res.json({ message: "Booking assigned successfully.", booking });
  } catch (error) {
    return res.status(500).json({ message: "Failed to assign booking.", error: error.message });
  }
};

const acknowledgeRequest = async (req, res) => {
  try {
    const { bookingId, message } = req.body;
    if (!bookingId) return res.status(400).json({ message: "bookingId is required." });

    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ message: "Booking not found." });

    booking.isAcknowledgedByAdmin = true;
    booking.acknowledgedAt = new Date();
    booking.adminResponseMessage =
      (message || "").trim() || "Admin has received this booking and is reviewing it.";
    await booking.save();

    emitUserRealtime(booking.userId || booking.touristId, REALTIME_EVENTS.NOTIFICATION, {
      action: "booking-acknowledged",
      bookingId: booking._id,
      message: booking.adminResponseMessage,
    });
    emitRealtime(REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "acknowledged",
      bookingId: booking._id,
      status: booking.status,
    });

    return res.json({ message: "Booking update sent successfully.", booking });
  } catch (error) {
    return res.status(500).json({ message: "Failed to acknowledge request.", error: error.message });
  }
};

const listUsers = async (_req, res) => {
  try {
    const users = await User.find({}).select("-password").sort({ createdAt: -1 });
    return res.json({ users });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch users.", error: error.message });
  }
};

const listHotels = async (_req, res) => {
  try {
    const businessesRaw = await Business.find({}).sort({ createdAt: -1 }).lean();
    const servicesByBusiness = await BusinessService.aggregate([
      { $group: { _id: "$businessId", totalServices: { $sum: 1 }, availableQuantity: { $sum: "$availableQuantity" } } },
    ]);
    const serviceMap = new Map(servicesByBusiness.map((item) => [String(item._id), item]));

    const businesses = businessesRaw.map((business) => {
      const counts = serviceMap.get(String(business._id)) || {};
      return {
        ...decorateBusiness(business),
        totalServices: counts.totalServices || 0,
        servicesCount: counts.totalServices || 0,
        totalInventory: counts.totalServices || 0,
        availableInventory: counts.availableQuantity || 0,
        canAcceptBookings: Number(counts.availableQuantity || 0) > 0,
        inventoryLabel: "services",
      };
    });

    return res.json({ businesses, hotels: businesses });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch businesses.", error: error.message });
  }
};

const listServices = async (_req, res) => {
  try {
    const services = await BusinessService.find({})
      .populate("businessId", "businessName name businessType location verificationStatus")
      .sort({ createdAt: -1 });
    return res.json({ services });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch services.", error: error.message });
  }
};

const listBookings = async (_req, res) => {
  try {
    const bookings = await Booking.find({})
      .populate("userId touristId", "name email role phone")
      .populate("businessId preferredBusinessId hotelId preferredHotelId", "businessName name location ownerEmail")
      .populate("serviceId", "title name category pricing")
      .sort({ createdAt: -1 });
    return res.json({ bookings });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch bookings.", error: error.message });
  }
};

const updateBusinessVerification = async (req, res) => {
  try {
    const { hotelId } = req.params;
    const { status, message } = req.body;
    const allowedStatuses = new Set(["pending", "verified", "rejected"]);

    if (!allowedStatuses.has(status)) {
      return res.status(400).json({ message: "Status must be pending, verified, or rejected." });
    }

    const business = await Business.findById(hotelId);
    if (!business) return res.status(404).json({ message: "Business not found." });

    business.verificationStatus = status;
    if (message) business.adminReviewMessage = String(message).trim();
    await business.save();

    await BusinessService.updateMany(
      { businessId: business._id },
      { $set: { isActive: status === "verified" } }
    );

    clearCache("public:");
    emitRealtime(REALTIME_EVENTS.BUSINESS_CHANGED, {
      action: "verification-updated",
      businessId: business._id,
      status,
    });
    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "business-verification-updated" });

    return res.json({
      message: status === "verified" ? "Business approved and services activated." : "Business review status updated.",
      business,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update business review status.", error: error.message });
  }
};

const deleteHotel = async (req, res) => {
  try {
    const { hotelId } = req.params;
    const business = await Business.findById(hotelId);
    if (!business) return res.status(404).json({ message: "Business not found." });

    await Promise.all([
      User.updateMany({ hotelId: business._id }, { $set: { hotelId: null, supplierId: null } }),
      BusinessService.deleteMany({ businessId: business._id }),
      Booking.updateMany(
        { businessId: business._id },
        {
          $set: {
            businessId: null,
            hotelId: null,
            serviceId: null,
            isConnected: false,
            status: "pending",
            bookingStatus: "pending",
            adminResponseMessage: "The assigned business was removed. Admin will reassign this booking.",
          },
        }
      ),
    ]);

    await Business.deleteOne({ _id: business._id });
    emitRealtime(REALTIME_EVENTS.BUSINESS_CHANGED, { action: "deleted", businessId: business._id });
    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "business-deleted" });

    return res.json({ message: "Business deleted successfully.", deletedBusinessId: business._id });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete business.", error: error.message });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const targetUser = await User.findById(userId);
    if (!targetUser) return res.status(404).json({ message: "User not found." });
    if (String(targetUser._id) === String(req.user._id)) {
      return res.status(400).json({ message: "Admin cannot delete own account." });
    }

    if (["hotel", "supplier"].includes(targetUser.role) && targetUser.hotelId) {
      const business = await Business.findById(targetUser.hotelId);
      if (business) {
        await BusinessService.deleteMany({ businessId: business._id });
        await Business.deleteOne({ _id: business._id });
        emitRealtime(REALTIME_EVENTS.BUSINESS_CHANGED, { action: "deleted", businessId: business._id });
      }
    }

    await Booking.deleteMany({ $or: [{ userId: targetUser._id }, { touristId: targetUser._id }] });
    await User.deleteOne({ _id: targetUser._id });
    return res.json({ message: "User deleted successfully." });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete user.", error: error.message });
  }
};

const dashboardStats = async (_req, res) => {
  try {
    const [totalUsers, totalBusinesses, totalServices, totalBookings, revenueAgg, pendingApprovals] =
      await Promise.all([
        User.countDocuments(),
        Business.countDocuments(),
        BusinessService.countDocuments(),
        Booking.countDocuments(),
        Booking.aggregate([
          { $match: { status: { $in: ["confirmed", "active", "completed"] } } },
          { $group: { _id: null, revenue: { $sum: "$totalPrice" } } },
        ]),
        Business.countDocuments({ verificationStatus: "pending" }),
      ]);

    return res.json({
      totalUsers,
      totalBusinesses,
      totalServices,
      totalBookings,
      totalRevenue: revenueAgg[0]?.revenue || 0,
      marketplaceRevenue: revenueAgg[0]?.revenue || 0,
      revenue: revenueAgg[0]?.revenue || 0,
      pendingApprovals,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch dashboard stats.", error: error.message });
  }
};

module.exports = {
  registerHotel,
  registerBusiness,
  getHotelStatus,
  assignBooking,
  acknowledgeRequest,
  dashboardStats,
  listUsers,
  listHotels,
  listServices,
  listBookings,
  updateBusinessVerification,
  deleteHotel,
  deleteUser,
};
