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
const { clearCache } = require("../utils/cache");
const { sendManualBookingApprovedEmail } = require("../utils/notify");
const { hasCompletePayoutDetails, normalizePayoutDetails } = require("../utils/payoutDetails");
const { normalizeCancelPolicy, cancelCommissionPercentOf } = require("../utils/cancellation");
const { normalizeAvailabilityTable } = require("../services/automaticBookingService");

const DEPOSIT_PAID_STATUSES = ["deposit_paid", "deposit-paid", "paid"];
const DEPOSIT_PERCENT = 30;

const publicFrontendUrl = () =>
  String(process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || "https://safariscon.vercel.app").replace(/\/+$/, "");

const buildPaymentUrl = (bookingId) => `${publicFrontendUrl()}/bookings/${encodeURIComponent(bookingId)}/pay`;

const withCommissionTerms = (business) => {
  if (!business) return business;
  const data = typeof business.toObject === "function" ? business.toObject() : { ...business };
  const percentage = Number(data.commissionPercentage ?? 5);
  const cancelPolicy = normalizeCancelPolicy(data);
  return {
    ...data,
    commissionPercentage: percentage,
    cancelWindowHours: cancelPolicy.windowHours,
    cancelPenaltyPercent: cancelPolicy.penaltyPercent,
    commissionTerms: {
      percentage,
      label: `${percentage}% platform commission`,
      description: "SafarisCon takes this commission from the full paid booking after the cancellation window closes. If the customer cancels in time, commission is half that rate on the cancellation fee only.",
    },
    cancellationTerms: {
      windowHours: cancelPolicy.windowHours,
      penaltyPercent: cancelPolicy.penaltyPercent,
      cancelCommissionPercent: cancelCommissionPercentOf(percentage),
      description: `Customers may cancel until ${cancelPolicy.windowHours} hours before the service. They lose ${cancelPolicy.penaltyPercent}% of what they paid. SafarisCon keeps ${cancelCommissionPercentOf(percentage)}% of that fee; the rest goes to you.`,
    },
  };
};

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

const getSellerBusinessIds = async (req) => Hotel.find(sellerBusinessFilter(req)).distinct("_id");

const normalizeBookingCode = (value) => String(value || "").trim().toUpperCase();

const RWANDA_COORDINATE_BOUNDS = {
  minLatitude: -2.9,
  maxLatitude: -1.0,
  minLongitude: 28.8,
  maxLongitude: 31.0,
};

const isCoordinateInsideRwanda = (latitude, longitude) =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  latitude >= RWANDA_COORDINATE_BOUNDS.minLatitude &&
  latitude <= RWANDA_COORDINATE_BOUNDS.maxLatitude &&
  longitude >= RWANDA_COORDINATE_BOUNDS.minLongitude &&
  longitude <= RWANDA_COORDINATE_BOUNDS.maxLongitude;

const normalizeServiceLocation = (input = {}) => {
  const latitude = input.latitude === "" || input.latitude === null || input.latitude === undefined ? null : Number(input.latitude);
  const longitude = input.longitude === "" || input.longitude === null || input.longitude === undefined ? null : Number(input.longitude);
  const locationSource = ["search", "map_click", "gps", "admin_manual"].includes(input.locationSource)
    ? input.locationSource
    : "map_click";

  return {
    country: "Rwanda",
    province: String(input.province || "").trim(),
    district: String(input.district || "").trim(),
    sector: String(input.sector || "").trim(),
    cell: String(input.cell || "").trim(),
    village: String(input.village || "").trim(),
    fullAddress: String(input.fullAddress || "").trim(),
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    locationSource,
    isExactLocationVerified: Boolean(input.isExactLocationVerified),
  };
};

const serviceLocationHasCoordinates = (serviceLocation) =>
  Number.isFinite(serviceLocation.latitude) && Number.isFinite(serviceLocation.longitude);

const getRemainingAmount = (booking) => {
  const finalPrice = Number(booking.priceSnapshot?.finalPrice || booking.totalPrice || 0);
  return Math.max(0, Math.round(finalPrice - Number(booking.amountPaid || booking.depositAmount || finalPrice)));
};

const buildCompletionSummary = (booking) => ({
  bookingId: booking._id,
  customerName: booking.touristId?.name || booking.bookingDetails?.fullName || "Customer",
  serviceName: booking.bookingDetails?.requestedService || booking.bookingDetails?.serviceName || booking.destinationPlace,
  businessName: booking.hotelId?.name || booking.preferredHotelId?.name || "Service",
  bookingDate: booking.bookingDetails?.bookingDate || booking.checkIn || booking.createdAt,
  depositAmount: Number(booking.depositAmount || booking.amountPaid || 0),
  remainingAmount: getRemainingAmount(booking),
  bookingStatus: booking.status,
  paymentStatus: booking.paymentStatus,
});

const sanitizeSellerBooking = (booking) => {
  const data = typeof booking?.toObject === "function" ? booking.toObject() : { ...(booking || {}) };
  delete data.bookingCode;
  delete data.verificationCode;
  delete data.verificationToken;
  delete data.qrPayload;
  delete data.commissionPercentage;
  delete data.commissionAmount;
  delete data.customerLocation;
  delete data.customerLocationDetails;
  if (data.touristId) {
    data.touristId = {
      _id: data.touristId._id || data.touristId,
      name: data.touristId.name || data.bookingDetails?.fullName || "Customer",
    };
  }
  if (data.bookingDetails && typeof data.bookingDetails === "object") {
    delete data.bookingDetails.phone;
    delete data.bookingDetails.email;
    delete data.bookingDetails.customerLocation;
    delete data.bookingDetails.customerLocationDetails;
  }
  return data;
};

const normalizeBookingForm = (form) => {
  const allowedTypes = new Set([
    "text",
    "textarea",
    "number",
    "email",
    "tel",
    "date",
    "time",
    "datetime-local",
    "select",
    "radio",
    "checkbox",
    "file",
    "url",
  ]);
  const fields = (Array.isArray(form?.fields) ? form.fields : [])
    .map((field, index) => {
      const type = allowedTypes.has(field?.type) ? field.type : "text";
      return {
        id: String(field?.id || `field_${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "_"),
        type,
        label: String(field?.label || `Field ${index + 1}`).trim(),
        placeholder: String(field?.placeholder || "").trim(),
        helpText: String(field?.helpText || "").trim(),
        defaultValue: field?.defaultValue ?? "",
        required: Boolean(field?.required),
        enabled: field?.enabled !== false,
        validation: {
          min: Number.isFinite(Number(field?.validation?.min)) ? Number(field.validation.min) : null,
          max: Number.isFinite(Number(field?.validation?.max)) ? Number(field.validation.max) : null,
          pattern: String(field?.validation?.pattern || "").trim(),
          maxFileSizeMb: Math.min(25, Math.max(1, Number(field?.validation?.maxFileSizeMb || 5))),
          acceptedFileTypes: String(field?.validation?.acceptedFileTypes || "").trim(),
        },
        options: Array.isArray(field?.options)
          ? field.options.map((option) => String(option || "").trim()).filter(Boolean).slice(0, 50)
          : [],
      };
    })
    .filter((field) => field.label)
    .slice(0, 80);

  return {
    title: String(form?.title || "").trim(),
    description: String(form?.description || "").trim(),
    isPublished: Boolean(form?.isPublished),
    fields,
    updatedAt: new Date(),
  };
};

const resolveInventoryStatus = ({ status, quantity, requestedStatus }) => {
  if (status === "unavailable") return "temporarily-unavailable";
  if (requestedStatus) return requestedStatus;
  if (quantity <= 0) return "out-of-stock";
  if (quantity <= 3) return "limited";
  return "available";
};

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

    const paid = transactions.filter((tx) => tx.status === "paid");
    const paidEarnings = paid.reduce((sum, tx) => sum + Number(tx.sellerEarnings || tx.providerAmount || 0), 0);
    const commission = paid.reduce((sum, tx) => sum + Number(tx.platformAmount || tx.commissionAmount || 0), 0);
    const paidOut = paid
      .filter((tx) => tx.payoutStatus === "successful")
      .reduce((sum, tx) => sum + Number(tx.providerAmount || tx.sellerEarnings || 0), 0);
    const pendingPayout = paid
      .filter((tx) => ["none", "pending", "held"].includes(tx.payoutStatus))
      .reduce((sum, tx) => sum + Number(tx.providerAmount || tx.sellerEarnings || 0), 0);

    return res.json({
      hotel: withCommissionTerms(primaryBusiness),
      business: withCommissionTerms(primaryBusiness),
      businesses: businesses.map(withCommissionTerms),
      stats: {
        totalRooms,
        availableRooms,
        occupiedRooms,
        bookings,
        services: totalServices + businesses.length,
        earnings: paidEarnings,
        commission,
        pendingPayout,
        paidOut,
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

    const bookings = await Booking.find({
      $or: [{ hotelId: { $in: businessIds } }, { preferredHotelId: { $in: businessIds } }],
    })
      .populate("touristId", "name email")
      .populate("hotelId", "name location type ownerEmail")
      .populate("roomId", "roomNumber type price status")
      .populate("tourHelpers", "name phone email")
      .populate("completedBySeller", "name email sellerId")
      .sort({ createdAt: -1 });

    return res.json({ bookings: bookings.map(sanitizeSellerBooking) });
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
    const commissionByBusiness = new Map(
      businesses.map((business) => [String(business._id), Number(business.commissionPercentage ?? 5)])
    );
    const businessListings = businesses.map((business) => ({
      ...withCommissionTerms(business),
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
    const serviceListings = services.map((service) => {
      const data = typeof service.toObject === "function" ? service.toObject() : { ...service };
      const percentage = commissionByBusiness.get(String(data.hotelId)) ?? 5;
      return {
        ...data,
        commissionPercentage: percentage,
        commissionTerms: {
          percentage,
          label: `${percentage}% platform commission`,
          description: "SafarisCon takes this commission from paid bookings for this service.",
        },
      };
    });
    return res.json({ services: businessListings.concat(serviceListings) });
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
    const allowedStatuses = ["confirmed", "cancelled"];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        message: `status must be one of: ${allowedStatuses.join(", ")}.`,
      });
    }

    const businesses = await Hotel.find(sellerBusinessFilter(req)).select("_id");
    const businessIds = businesses.map((business) => business._id);
    const booking = await Booking.findOne({
      _id: bookingId,
      $or: [{ hotelId: { $in: businessIds } }, { preferredHotelId: { $in: businessIds } }],
    }).populate("touristId", "name email");
    if (!booking) {
      return res.status(404).json({ message: "Booking not found." });
    }

    if (["deposit_paid", "deposit-paid", "paid", "completed"].includes(booking.paymentStatus)) {
      return res.status(409).json({ message: "Paid bookings cannot be approved or cancelled from this action." });
    }

    if (status === "confirmed") {
      const businessId = booking.hotelId || booking.preferredHotelId;
      const business = businessIds.some((id) => String(id) === String(businessId))
        ? await Hotel.findById(businessId)
        : null;
      if (!business) return res.status(404).json({ message: "Service not found for this booking." });

      const quotedTotal = Number(req.body.totalPrice ?? req.body.quotedTotal);
      const deadlineHours = Math.max(1, Math.min(2160, Number(req.body.paymentDeadlineHours || 24)));
      const paymentReason = String(req.body.paymentReason || `Payment for ${business.name}`).trim().slice(0, 500);
      if (!Number.isFinite(quotedTotal) || quotedTotal <= 0) {
        return res.status(400).json({ message: "Set the final service price in RWF before approving this booking." });
      }

      const total = Math.round(quotedTotal);
      const depositAmount = Math.round((total * DEPOSIT_PERCENT) / 100);
      const commissionPercentage = Math.max(0, Math.min(100, Number(business.commissionPercentage ?? 5)));
      const deadlineAt = new Date(Date.now() + deadlineHours * 3600000);

      booking.hotelId = business._id;
      booking.preferredHotelId = booking.preferredHotelId || business._id;
      booking.supplierId = business.supplierId || null;
      booking.status = "confirmed";
      booking.totalPrice = total;
      booking.depositPercentage = DEPOSIT_PERCENT;
      booking.depositPercent = DEPOSIT_PERCENT;
      booking.depositAmount = depositAmount;
      booking.remainingBalance = Math.max(0, total - depositAmount);
      booking.commissionPercentage = commissionPercentage;
      booking.commissionAmount = Math.round((total * commissionPercentage) / 100);
      booking.paymentDeadlineAt = deadlineAt;
      booking.paymentReason = paymentReason;
      booking.isConnected = true;
      booking.sellerApproval = {
        ...(booking.sellerApproval || {}),
        status: "approved",
        reviewedAt: new Date(),
        reviewedBy: req.user._id,
        deadlineHours,
        note: String(req.body.note || "").trim().slice(0, 1000),
      };
      booking.adminResponseMessage = `Booking approved by service provider. Payment purpose: ${paymentReason}`;

      try {
        await sendManualBookingApprovedEmail({
          customerEmail: booking.touristId?.email || booking.bookingDetails?.email,
          customerName: booking.touristId?.name || booking.bookingDetails?.fullName,
          businessName: business.name,
          bookingId: booking._id,
          amount: total,
          depositAmount,
          deadlineAt,
          paymentUrl: buildPaymentUrl(booking._id),
        });
      } catch (emailError) {
        console.warn("Manual booking approval email failed:", emailError.message);
      }
    } else {
      booking.status = "cancelled";
      booking.sellerApproval = {
        ...(booking.sellerApproval || {}),
        status: "rejected",
        reviewedAt: new Date(),
        reviewedBy: req.user._id,
        rejectionReason: String(req.body.reason || "Service provider rejected this booking.").trim().slice(0, 1000),
      };
      booking.adminResponseMessage = booking.sellerApproval.rejectionReason;
    }

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
      message: status === "confirmed"
        ? "Booking approved. Customer was notified to pay in the system."
        : "Booking cancelled.",
      booking: sanitizeSellerBooking(booking),
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to update booking status.",
      error: error.message,
    });
  }
};

const verifyBookingCodeForCompletion = async (req, res) => {
  try {
    if (ensureHotelUser(req, res) === null && !["hotel", "supplier"].includes(req.user?.role)) return;
    const code = normalizeBookingCode(req.body.code);
    if (!code) return res.status(400).json({ message: "Booking Code is required." });

    const businessIds = await getSellerBusinessIds(req);
    const booking = await Booking.findOne({
      bookingCode: code,
      $or: [{ hotelId: { $in: businessIds } }, { preferredHotelId: { $in: businessIds } }],
    })
      .populate("touristId", "name email")
      .populate("hotelId", "name")
      .populate("preferredHotelId", "name");

    if (!booking) return res.status(404).json({ message: "Booking Code is invalid for your business." });
    if (!DEPOSIT_PAID_STATUSES.includes(booking.paymentStatus) || booking.detailsUnlocked !== true) {
      return res.status(409).json({ message: "This booking is not eligible. The full amount must be paid first." });
    }
    if (["cancelled", "rejected", "completed"].includes(booking.status) || booking.completionStatus === "completed") {
      return res.status(409).json({ message: "This booking cannot be completed in its current status." });
    }
    if (booking.bookingCodeUsed === true) {
      return res.status(409).json({ message: "This Booking Code has already been used." });
    }

    return res.json({ valid: true, booking: buildCompletionSummary(booking) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to verify Booking Code.", error: error.message });
  }
};

const completeVerifiedBooking = async (req, res) => {
  try {
    if (ensureHotelUser(req, res) === null && !["hotel", "supplier"].includes(req.user?.role)) return;
    const code = normalizeBookingCode(req.body.code);
    const bookingId = String(req.body.bookingId || "").trim();
    if (!bookingId || !code) return res.status(400).json({ message: "Booking ID and Booking Code are required." });
    if (req.body.confirmRemainingPaid !== true) {
      return res.status(400).json({ message: "Confirm that the remaining 70% was paid to the seller." });
    }

    const businessIds = await getSellerBusinessIds(req);
    const current = await Booking.findOne({
      _id: bookingId,
      bookingCode: code,
      $or: [{ hotelId: { $in: businessIds } }, { preferredHotelId: { $in: businessIds } }],
      bookingCodeUsed: { $ne: true },
      status: { $nin: ["cancelled", "rejected", "completed"] },
      completionStatus: { $ne: "completed" },
      paymentStatus: { $in: DEPOSIT_PAID_STATUSES },
      detailsUnlocked: true,
    }).select("totalPrice priceSnapshot depositAmount amountPaid remainingBalance");

    if (!current) {
      return res.status(409).json({ message: "Booking cannot be completed. Verify the Booking Code again or check its status." });
    }

    const now = new Date();
    const remainingAmount = getRemainingAmount(current);
    const completed = await Booking.findOneAndUpdate(
      {
        _id: current._id,
        bookingCode: code,
        $or: [{ hotelId: { $in: businessIds } }, { preferredHotelId: { $in: businessIds } }],
        bookingCodeUsed: { $ne: true },
        status: { $nin: ["cancelled", "rejected", "completed"] },
        completionStatus: { $ne: "completed" },
        paymentStatus: { $in: DEPOSIT_PAID_STATUSES },
        detailsUnlocked: true,
      },
      {
        $set: {
          status: "completed",
          paymentStatus: "completed",
          completionStatus: "completed",
          remainingPaymentStatus: "not_required",
          remainingAmount: 0,
          remainingBalance: 0,
          bookingCodeUsed: true,
          bookingCodeUsedAt: now,
          completedAt: now,
          completedBySeller: req.user._id,
        },
        $push: {
          completionAuditLogs: {
            event: "booking_completed",
            message: "Seller verified Booking Code. Full amount was already paid in the app.",
            actorId: req.user._id,
            actorRole: req.user.role,
            at: now,
          },
        },
      },
      { new: true, runValidators: true }
    )
      .populate("touristId", "name email")
      .populate("hotelId", "name")
      .populate("preferredHotelId", "name")
      .populate("completedBySeller", "name email sellerId");

    if (!completed) {
      return res.status(409).json({ message: "This Booking Code was already used." });
    }

    emitUserRealtime(completed.touristId?._id || completed.touristId, REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "completed",
      bookingId: completed._id,
      status: completed.status,
    });
    emitHotelRealtime(completed.hotelId?._id || completed.hotelId || completed.preferredHotelId?._id || completed.preferredHotelId, REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "completed",
      bookingId: completed._id,
      status: completed.status,
    });

    return res.json({
      message: "Booking completed. Booking Code is now used and cannot be reused.",
      booking: buildCompletionSummary(completed),
      completedBooking: completed,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to complete booking.", error: error.message });
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
    const earlyPromotionInput = req.body.promotion && typeof req.body.promotion === "object"
      ? req.body.promotion
      : {};
    const earlyPromotionEnabled = req.body.promotionEnabled === true || earlyPromotionInput.enabled === true;
    const earlyPromotionPercent = Number(
      req.body.promotionPercent ??
      req.body.promotionPercentOfPrice ??
      earlyPromotionInput.percent ??
      earlyPromotionInput.promotionPercent ??
      0
    );
    if (
      earlyPromotionEnabled &&
      (!Number.isFinite(earlyPromotionPercent) || earlyPromotionPercent <= 0 || earlyPromotionPercent > 100)
    ) {
      return res.status(400).json({ message: "Promotion percent must be greater than 0 and less than or equal to 100." });
    }
    const quantity = Math.max(0, Number(req.body.availableQuantity || req.body.quantityRemaining || 1));
    const serviceLocation = normalizeServiceLocation(req.body.serviceLocation || req.body.locationDetails || {});
    if (!serviceLocation.province || !serviceLocation.district || !serviceLocation.sector) {
      return res.status(400).json({ message: "Province, district, and sector are required." });
    }
    const hasExactCoordinates = serviceLocationHasCoordinates(serviceLocation);
    if (hasExactCoordinates && !isCoordinateInsideRwanda(serviceLocation.latitude, serviceLocation.longitude)) {
      return res.status(400).json({ message: "Selected service location must be inside Rwanda." });
    }
    const locationDetails = {
      province: serviceLocation.province,
      district: serviceLocation.district,
      sector: serviceLocation.sector,
      cell: serviceLocation.cell,
      village: serviceLocation.village,
    };
    const fullLocation = serviceLocation.fullAddress || [
      serviceLocation.village,
      serviceLocation.cell,
      serviceLocation.sector,
      serviceLocation.district,
      serviceLocation.province,
      "Rwanda",
    ].filter(Boolean).join(", ");
    const registeredPayout = hasCompletePayoutDetails(req.user.payoutDetails)
      ? normalizePayoutDetails(req.user.payoutDetails)
      : { ok: false };
    if (!registeredPayout.ok) {
      return res.status(409).json({
        code: "PAYOUT_DETAILS_REQUIRED",
        message:
          "Payout details are taken from provider registration and are not collected on the service form. Complete registration with Mobile Money or bank details first.",
      });
    }
    const payoutDetails = registeredPayout.value;
    const normalizedStatus = hasExactCoordinates && req.body.status !== "unavailable" ? "available" : "unavailable";
    const availabilityTable = normalizeAvailabilityTable(req.body.availabilityTable);
    if (!availabilityTable.rows.length) {
      return res.status(400).json({ message: "Add at least one service and its RWF price." });
    }
    const bookingForm = normalizeBookingForm(req.body.bookingForm);
    const promotionInput = req.body.promotion && typeof req.body.promotion === "object"
      ? req.body.promotion
      : {};
    const promotionPercent = Number(
      req.body.promotionPercent ??
      req.body.promotionPercentOfPrice ??
      promotionInput.percent ??
      promotionInput.promotionPercent ??
      0
    );
    const promotion = {
      enabled: req.body.promotionEnabled === true || promotionInput.enabled === true,
      title: String(req.body.promotionTitle || promotionInput.title || "").trim(),
      description: String(req.body.promotionNote || promotionInput.note || promotionInput.description || "").trim(),
      percent: Number.isFinite(promotionPercent) ? promotionPercent : 0,
      note: String(req.body.promotionNote || promotionInput.note || promotionInput.description || "").trim(),
      startAt: (req.body.promotionStartAt || promotionInput.startAt) ? new Date(req.body.promotionStartAt || promotionInput.startAt) : null,
      endAt: (req.body.promotionEndAt || promotionInput.endAt) ? new Date(req.body.promotionEndAt || promotionInput.endAt) : null,
    };
    if (promotion.enabled) {
      if (!promotion.title || !promotion.startAt || !promotion.endAt) {
        return res.status(400).json({ message: "Promotion title, start time, and end time are required." });
      }
      if (!Number.isFinite(promotion.percent) || promotion.percent <= 0 || promotion.percent > 100) {
        return res.status(400).json({ message: "Promotion percent must be greater than 0 and less than or equal to 100." });
      }
      if (Number.isNaN(promotion.startAt.getTime()) || Number.isNaN(promotion.endAt.getTime())) {
        return res.status(400).json({ message: "Promotion start and end times must be valid." });
      }
      if (promotion.endAt <= promotion.startAt) {
        return res.status(400).json({ message: "Promotion end time must be after its start time." });
      }
    }
    const requestDeadlineHours = Math.max(0, Math.min(2160, Number(req.body.rebookSettings?.requestDeadlineHours ?? 24)));
    const rebookIdValidityHours = Math.max(1, Math.min(2160, Number(req.body.rebookSettings?.rebookIdValidityHours ?? 72)));
    if (!Number.isFinite(requestDeadlineHours) || !Number.isFinite(rebookIdValidityHours)) {
      return res.status(400).json({ message: "Enter valid Re-book deadline hours." });
    }
    const rebookSettings = { requestDeadlineHours, rebookIdValidityHours };
    const cancelPolicy = normalizeCancelPolicy(req.body.cancellationPolicy || req.body);
    const inventoryStatus = resolveInventoryStatus({
      status: normalizedStatus,
      quantity,
      requestedStatus: req.body.inventoryStatus,
    });
    const images = Array.isArray(req.body.images)
      ? req.body.images
          .filter((image) => /^https?:\/\//.test(String(image || "")))
          .slice(0, 3)
      : [];

    if (serviceId) {
      const existingBusiness = await Hotel.findOne({ _id: serviceId, ...sellerBusinessFilter(req) }).select(
        "approvalStatus promotion"
      );
      if (!existingBusiness) {
        return res.status(404).json({ message: "Business not found." });
      }

      const existingPromotion = existingBusiness.promotion || {};
      const promotionChanged = promotion.enabled && (
        existingPromotion.enabled !== true ||
        existingPromotion.title !== promotion.title ||
        existingPromotion.description !== promotion.description ||
        Number(existingPromotion.percent || 0) !== promotion.percent ||
        new Date(existingPromotion.startAt || 0).getTime() !== promotion.startAt.getTime() ||
        new Date(existingPromotion.endAt || 0).getTime() !== promotion.endAt.getTime()
      );
      const business = await Hotel.findOneAndUpdate(
        { _id: serviceId, ...sellerBusinessFilter(req) },
        {
          $set: {
            name: title,
            type: String(category).trim(),
            location: fullLocation,
            locationDetails,
            serviceLocation,
            description: String(description || "").trim(),
            basePrice: 0,
            priceText: "",
            images,
            promotion,
            rebookSettings,
            cancelWindowHours: cancelPolicy.windowHours,
            cancelPenaltyPercent: cancelPolicy.penaltyPercent,
            "bookingRules.cancellationPolicy.windowHours": cancelPolicy.windowHours,
            "bookingRules.cancellationPolicy.penaltyPercent": cancelPolicy.penaltyPercent,
            ...(req.body.contactDetails && typeof req.body.contactDetails === "object"
              ? {
                  "contactDetails.phone": String(req.body.contactDetails.phone || "").trim(),
                  "contactDetails.whatsapp": String(req.body.contactDetails.whatsapp || "").trim(),
                  "contactDetails.exactAddress": serviceLocation.fullAddress,
                  "contactDetails.latitude": serviceLocation.latitude,
                  "contactDetails.longitude": serviceLocation.longitude,
                }
              : {}),
            payoutDetails,
            services: [String(category).trim()],
            status: normalizedStatus,
            availableQuantity: quantity,
            quantityRemaining: quantity,
            availabilityTable,
            bookingForm,
            inventoryStatus,
            approvalStatus: hasExactCoordinates ? (existingBusiness.approvalStatus === "approved" ? "approved" : "pending") : "draft",
          },
          ...(promotionChanged ? {
            $push: {
              promotionHistory: {
                $each: [{ ...promotion, recordedAt: new Date() }],
                $slice: -20,
              },
            },
          } : {}),
        },
        { returnDocument: "after", runValidators: true }
      );
      if (business) {
        clearCache("public:");
        emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "seller-business-updated", hotelId: business._id });
        return res.json({
          message:
            business.approvalStatus === "approved"
              ? "Business updated and published automatically."
              : "Business updated and sent for admin approval.",
          service: business,
        });
      }
    }

    const business = await Hotel.create({
      name: title,
      type: String(category).trim(),
      location: fullLocation,
      locationDetails,
      serviceLocation,
      description: String(description || "").trim(),
      basePrice: 0,
      priceText: "",
      amenities: [],
      contactInfo: req.user.email,
      contactDetails: {
        ...(req.body.contactDetails && typeof req.body.contactDetails === "object" ? req.body.contactDetails : {}),
        email: req.body.contactDetails?.email || req.user.email,
        phone: req.body.contactDetails?.phone || req.user.phone || "",
        exactAddress: serviceLocation.fullAddress,
        latitude: serviceLocation.latitude,
        longitude: serviceLocation.longitude,
      },
      payoutDetails,
      images,
      promotion,
      rebookSettings,
      cancelWindowHours: cancelPolicy.windowHours,
      cancelPenaltyPercent: cancelPolicy.penaltyPercent,
      bookingRules: {
        cancellationPolicy: {
          type: "moderate",
          windowHours: cancelPolicy.windowHours,
          penaltyPercent: cancelPolicy.penaltyPercent,
        },
      },
      promotionHistory: promotion.enabled ? [{ ...promotion, recordedAt: new Date() }] : [],
      services: [String(category).trim()],
      ownerEmail: `${req.user.sellerId || req.user._id}-${Date.now()}@seller.local`.toLowerCase(),
      sellerContactEmail: req.user.email,
      ownerUserId: req.user._id,
      supplierId: req.user.supplierId || null,
      approvalStatus: hasExactCoordinates ? "pending" : "draft",
      status: normalizedStatus,
      availableQuantity: quantity,
      quantityRemaining: quantity,
      availabilityTable,
      bookingForm,
      bookingMode: "manual",
      inventoryStatus,
    });

    if (!req.user.hotelId) {
      req.user.hotelId = business._id;
      await req.user.save();
    }

    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "seller-business-created", hotelId: business._id });
    clearCache("public:");
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
          returnDocument: "after",
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
      clearCache("public:");
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

const verifyMyBooking = async (req, res) => {
  try {
    if (ensureHotelUser(req, res) === null && !["hotel", "supplier"].includes(req.user?.role)) return;
    const businesses = await Hotel.find(sellerBusinessFilter(req)).select("_id");
    const businessIds = businesses.map((business) => business._id);
    const lookup = String(req.params.lookup || "").trim();
    const lookupConditions = [
      /^[a-f\d]{24}$/i.test(lookup) ? { _id: lookup } : null,
      { bookingCode: lookup },
      { verificationCode: lookup },
      { verificationToken: lookup },
      { paymentReference: lookup },
    ].filter(Boolean);

    const booking = await Booking.findOne({
      hotelId: { $in: businessIds },
      $or: lookupConditions,
    })
      .populate("touristId", "name email phone role")
      .populate("preferredHotelId", "name location type")
      .populate("hotelId", "name location type")
      .populate("roomId", "roomNumber type price status");

    if (!booking) return res.status(404).json({ message: "Booking not found for your business." });
    return res.json({ booking: sanitizeSellerBooking(booking) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to verify booking.", error: error.message });
  }
};

const getMyHotelOverviewExport = getMyHotelOverview;

module.exports = {
  getMyHotelOverview: getMyHotelOverviewExport,
  listMyBookings,
  listMyRooms,
  listMyServices,
  updateBookingStatus,
  verifyBookingCodeForCompletion,
  completeVerifiedBooking,
  createRoom,
  updateRoom,
  upsertMyService,
  deleteService,
  deleteRoom,
  verifyMyBooking,
};
