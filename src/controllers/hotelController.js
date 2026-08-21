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
const { sendManualBookingApprovedEmail, resolveLanguage } = require("../utils/notify");
const { hasCompletePayoutDetails, normalizePayoutDetails } = require("../utils/payoutDetails");
const { normalizeCancelPolicy, cancelCommissionPercentOf } = require("../utils/cancellation");
const { normalizeAvailabilityTable } = require("../services/automaticBookingService");
const {
  isCoordinateInsideRwanda,
  normalizeServiceLocation,
  serviceLocationHasCoordinates,
} = require("../utils/serviceLocation");
const { normalizeServiceImages, withPrimaryImage } = require("../utils/serviceImages");
const ServiceCategory = require("../models/ServiceCategory");
const ServiceOption = require("../models/ServiceOption");
const { ensureSeededCategories } = require("../utils/ensureCategories");
const {
  slugify,
  validateAttributesAgainstSchema,
  snapshotCategorySchemas,
} = require("../utils/fieldSchema");
const { normalizeContactDetails } = require("../utils/phoneE164");
const { normalizeCatalogLocation } = require("../utils/catalogLocation");
const {
  syncServiceOptionsToAvailabilityTable,
  migrateAvailabilityRowsToOptions,
  serializeSellerOption,
} = require("../utils/serviceOptionSync");
const { buildOptionEngineDefaults } = require("../utils/serviceOptionView");
const User = require("../models/User");

const DEPOSIT_PAID_STATUSES = ["deposit_paid", "deposit-paid", "paid"];
const DEPOSIT_PERCENT = 30;

const publicFrontendUrl = () =>
  String(process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || "https://safariscon.eserveconn.com").replace(/\/+$/, "");

const buildPaymentUrl = (bookingId) => `${publicFrontendUrl()}/bookings/${encodeURIComponent(bookingId)}/pay`;

const withCommissionTerms = (business) => {
  if (!business) return business;
  const data = typeof business.toObject === "function" ? business.toObject() : { ...business };
  const percentage =
    data.commissionPercentage == null || data.commissionPercentage === ""
      ? null
      : Number(data.commissionPercentage);
  const cancelPolicy = normalizeCancelPolicy(data);
  return {
    ...data,
    commissionPercentage: percentage,
    platformCommissionPercent: percentage,
    cancelWindowHours: cancelPolicy.windowHours,
    cancelPenaltyPercent:
      data.cancelPenaltyPercent == null ? null : cancelPolicy.penaltyPercent,
    commissionTerms: percentage == null
      ? {
          percentage: null,
          label: "Set by admin on approval",
          description: "Platform commission is agreed and set by admin when the service is approved.",
        }
      : {
          percentage,
          label: `${percentage}% platform commission`,
          description: "SafarisCon takes this commission from the full paid booking after the cancellation window closes. If the customer cancels in time, commission is half that rate on the cancellation fee only.",
        },
    cancellationTerms: {
      windowHours: cancelPolicy.windowHours,
      penaltyPercent: data.cancelPenaltyPercent == null ? null : cancelPolicy.penaltyPercent,
      cancelCommissionPercent: percentage == null ? null : cancelCommissionPercentOf(percentage),
      description:
        data.cancelPenaltyPercent == null
          ? "Cancel penalty % is set by admin on approval."
          : `Customers may cancel until ${cancelPolicy.windowHours} hours before the service. They lose ${cancelPolicy.penaltyPercent}% of what they paid. SafarisCon keeps ${cancelCommissionPercentOf(percentage)}% of that fee; the rest goes to you.`,
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
    const filter = { ...sellerBusinessFilter(req) };
    const categoryIdQuery = String(req.query.categoryId || "").trim();
    const categorySlugQuery = String(req.query.categorySlug || req.query.category || "").trim();
    if (categoryIdQuery) {
      if (!/^[a-f0-9]{24}$/i.test(categoryIdQuery)) {
        return res.status(400).json({ message: "categoryId must be a valid id." });
      }
      filter.categoryId = categoryIdQuery;
    } else if (categorySlugQuery) {
      // Resolve slug → id so renamed categories still match linked services.
      const category = await ServiceCategory.findOne({ slug: slugify(categorySlugQuery) }).select("_id").lean();
      if (!category) return res.json({ services: [] });
      filter.categoryId = category._id;
    }
    const businesses = await Hotel.find(filter).sort({ createdAt: -1 }).lean();
    const businessIds = businesses.map((business) => business._id);
    const categoryIds = [...new Set(businesses.map((b) => String(b.categoryId || "")).filter(Boolean))];
    const categories = categoryIds.length
      ? await ServiceCategory.find({ _id: { $in: categoryIds } }).lean()
      : [];
    const categoryById = new Map(categories.map((c) => [String(c._id), c]));

    const services = await HotelService.find({ hotelId: { $in: businessIds } }).sort({
      category: 1,
      name: 1,
    });
    const commissionByBusiness = new Map(
      businesses.map((business) => [String(business._id), Number(business.commissionPercentage ?? 5)])
    );
    const businessListings = businesses.map((business) => {
      const liveCategory = categoryById.get(String(business.categoryId || ""));
      const categorySlug = liveCategory?.slug || business.categorySlug || business.type;
      const categoryName = liveCategory?.name || categorySlug;
      return {
      ...withCommissionTerms(withPrimaryImage(business)),
      title: business.name,
      name: business.name,
      category: categorySlug,
      categoryId: business.categoryId || null,
      categorySlug,
      categoryName,
      serviceType: categorySlug,
      status: business.status,
      approvalStatus: business.approvalStatus,
      verificationStatus: business.approvalStatus,
      availableQuantity: business.quantityRemaining ?? business.availableQuantity ?? 0,
      availabilityText: `${business.quantityRemaining ?? business.availableQuantity ?? 0} remaining`,
      platformCommissionPercent: business.commissionPercentage,
      cancelPenaltyPercent: business.cancelPenaltyPercent,
    };
    });
    const serviceListings = services.map((service) => {
      const data = typeof service.toObject === "function" ? service.toObject() : { ...service };
      const percentage = commissionByBusiness.get(String(data.hotelId)) ?? 5;
      return {
        ...withPrimaryImage(data),
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
          language: resolveLanguage(req),
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

const buildServiceProviderPayload = async (business, fallbackUser = null) => {
  let owner = null;
  if (business?.ownerUserId) {
    owner = await User.findById(business.ownerUserId).select("name email phone sellerId role").lean();
  }
  if (!owner && fallbackUser?._id) {
    owner = {
      _id: fallbackUser._id,
      name: fallbackUser.name,
      email: fallbackUser.email,
      phone: fallbackUser.phone,
      sellerId: fallbackUser.sellerId,
      role: fallbackUser.role,
    };
  }

  const contact = business?.contactDetails || {};
  return {
    id: owner?._id || business?.ownerUserId || null,
    name: owner?.name || "",
    email: owner?.email || business?.sellerContactEmail || contact.email || "",
    phone:
      owner?.phone ||
      contact.phoneE164 ||
      contact.phone ||
      contact.whatsappE164 ||
      contact.whatsapp ||
      "",
    sellerId: owner?.sellerId || "",
    role: owner?.role || "",
  };
};

const upsertMyService = async (req, res) => {
  try {
    if (ensureHotelUser(req, res) === null && !["hotel", "supplier"].includes(req.user?.role)) return;

    // Seller cannot set agreement commercial terms or booking mode.
    if (
      req.body.cancelPenaltyPercent != null ||
      req.body.platformCommissionPercent != null ||
      req.body.commissionPercentage != null ||
      req.body.bookingMode != null
    ) {
      return res.status(403).json({
        code: "SELLER_FORBIDDEN_FIELDS",
        message:
          "Sellers cannot set cancelPenaltyPercent, platformCommissionPercent/commissionPercentage, or bookingMode. Admin sets these on approval / marketplace settings.",
      });
    }

    const { serviceId } = req.params;
    await ensureSeededCategories();

    const title = String(req.body.title || req.body.name || "").trim();
    // Prefer categoryId (stable). Frontend should send categoryId from the selected category name.
    const categoryId = String(req.body.categoryId || "").trim();
    const categoryFallback = String(req.body.categorySlug || req.body.category || "").trim();
    if (!title || (!categoryId && !categoryFallback)) {
      return res.status(400).json({ message: "categoryId and title are required." });
    }

    let category = null;
    if (categoryId) {
      if (!/^[a-f0-9]{24}$/i.test(categoryId)) {
        return res.status(400).json({ message: "categoryId must be a valid category id." });
      }
      category = await ServiceCategory.findOne({ _id: categoryId, isActive: true }).lean();
    } else {
      // Backward-compatible fallback only.
      category = await ServiceCategory.findOne({ slug: slugify(categoryFallback), isActive: true }).lean();
    }
    if (!category) {
      return res.status(400).json({ message: "Active service category not found." });
    }

    const listingValidation = validateAttributesAgainstSchema(
      req.body.listingAttributes || {},
      category.listingFieldSchema || [],
      { label: "listingAttributes", appliesTo: "listing" }
    );
    if (!listingValidation.ok) {
      return res.status(400).json({ message: listingValidation.message, errors: listingValidation.errors });
    }

    const catalogInput = req.body.location || req.body.catalogLocation || req.body.serviceLocation || {};
    const catalogLocationResult = normalizeCatalogLocation(catalogInput);
    // Backward-compatible Rwanda admin divisions when only serviceLocation is sent.
    const serviceLocation = normalizeServiceLocation({
      ...(req.body.serviceLocation || {}),
      ...(catalogLocationResult.ok
        ? {
            latitude: catalogLocationResult.value.latitude,
            longitude: catalogLocationResult.value.longitude,
            formattedAddress: catalogLocationResult.value.formattedAddress,
            fullAddress: catalogLocationResult.value.formattedAddress,
            province: catalogLocationResult.value.state || req.body.serviceLocation?.province,
            district: catalogLocationResult.value.city || req.body.serviceLocation?.district,
            sector: catalogLocationResult.value.area || req.body.serviceLocation?.sector,
            name: catalogLocationResult.value.placeName,
            placeId: catalogLocationResult.value.placeId,
            locationSource: catalogLocationResult.value.locationSource,
            country: catalogLocationResult.value.country,
          }
        : {}),
    });

    if (!catalogLocationResult.ok && !serviceLocationHasCoordinates(serviceLocation)) {
      return res.status(400).json({
        message: catalogLocationResult.message || "Map/search location with latitude and longitude is required.",
      });
    }

    const catalogLocation = catalogLocationResult.ok
      ? catalogLocationResult.value
      : {
          latitude: serviceLocation.latitude,
          longitude: serviceLocation.longitude,
          latitudeRaw: String(serviceLocation.latitude),
          longitudeRaw: String(serviceLocation.longitude),
          formattedAddress: serviceLocation.formattedAddress || serviceLocation.fullAddress,
          country: serviceLocation.country || "Rwanda",
          countryCode: "RW",
          state: serviceLocation.province || "",
          city: serviceLocation.district || "",
          area: serviceLocation.sector || "",
          placeName: serviceLocation.name || "",
          placeId: serviceLocation.placeId || "",
          locationSource: serviceLocation.locationSource || "map_click",
        };

    if (!isCoordinateInsideRwanda(catalogLocation.latitude, catalogLocation.longitude)) {
      return res.status(400).json({ message: "Selected service location must be inside Rwanda." });
    }

    const locationDetails = {
      province: serviceLocation.province || catalogLocation.state,
      district: serviceLocation.district || catalogLocation.city,
      sector: serviceLocation.sector || catalogLocation.area,
      cell: serviceLocation.cell || "",
      village: serviceLocation.village || "",
    };
    if (!locationDetails.province || !locationDetails.district || !locationDetails.sector) {
      return res.status(400).json({
        message: "Province/state, district/city, and sector/area are required (auto-filled from geocode when possible).",
      });
    }

    const fullLocation =
      catalogLocation.formattedAddress ||
      serviceLocation.formattedAddress ||
      [locationDetails.village, locationDetails.cell, locationDetails.sector, locationDetails.district, locationDetails.province, "Rwanda"]
        .filter(Boolean)
        .join(", ");

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

    const contactResult = normalizeContactDetails({
      ...(req.body.contactDetails && typeof req.body.contactDetails === "object" ? req.body.contactDetails : {}),
      email: req.body.contactDetails?.email || req.user.email,
      exactAddress: fullLocation,
      latitude: catalogLocation.latitude,
      longitude: catalogLocation.longitude,
    });
    if (!contactResult.ok) {
      return res.status(400).json({ message: contactResult.message });
    }

    const imageFields = normalizeServiceImages({
      images: req.body.images,
      primaryImage: req.body.primaryImage,
      requireCover: false,
    });
    if (imageFields.error) {
      return res.status(400).json({ message: imageFields.error });
    }
    const { images, primaryImage } = imageFields;

    const quantity = Math.max(0, Number(req.body.availableQuantity || req.body.quantityRemaining || 1));
    const hasExactCoordinates = true;
    const normalizedStatus =
      req.body.status === "unavailable" ? "unavailable" : hasExactCoordinates ? "available" : "unavailable";
    const inventoryStatus = resolveInventoryStatus({
      status: normalizedStatus,
      quantity,
      requestedStatus: req.body.inventoryStatus,
    });

    const availabilityTable = normalizeAvailabilityTable(req.body.availabilityTable);
    const supportsOptions = Boolean(category.supportsOptions);
    if (!supportsOptions && !availabilityTable.rows.length) {
      const basePrice = Number(req.body.basePrice ?? req.body.price ?? 0);
      if (!Number.isFinite(basePrice) || basePrice < 0) {
        return res.status(400).json({ message: "basePrice is required when the category does not support options." });
      }
      availabilityTable.rows = [
        {
          id: "default",
          cells: {
            service: title,
            price: basePrice,
            priceType: "fixed",
            calculationField: "quantity",
            availability: Math.max(1, quantity || 1),
            details: String(req.body.description || "").trim().slice(0, 2000),
          },
        },
      ];
      availabilityTable.updatedAt = new Date();
    }

    const earlyPromotionInput = req.body.promotion && typeof req.body.promotion === "object" ? req.body.promotion : {};
    const promotionPercent = Number(
      req.body.promotionPercent ??
        req.body.promotionPercentOfPrice ??
        earlyPromotionInput.percent ??
        earlyPromotionInput.promotionPercent ??
        0
    );
    const promotion = {
      enabled: req.body.promotionEnabled === true || earlyPromotionInput.enabled === true,
      title: String(req.body.promotionTitle || earlyPromotionInput.title || "").trim(),
      description: String(
        req.body.promotionNote || earlyPromotionInput.note || earlyPromotionInput.description || ""
      ).trim(),
      percent: Number.isFinite(promotionPercent) ? promotionPercent : 0,
      note: String(req.body.promotionNote || earlyPromotionInput.note || earlyPromotionInput.description || "").trim(),
      startAt:
        req.body.promotionStartAt || earlyPromotionInput.startAt
          ? new Date(req.body.promotionStartAt || earlyPromotionInput.startAt)
          : null,
      endAt:
        req.body.promotionEndAt || earlyPromotionInput.endAt
          ? new Date(req.body.promotionEndAt || earlyPromotionInput.endAt)
          : null,
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

    const requestDeadlineHours = Math.max(
      0,
      Math.min(2160, Number(req.body.rebookSettings?.requestDeadlineHours ?? 24))
    );
    const rebookIdValidityHours = Math.max(
      1,
      Math.min(2160, Number(req.body.rebookSettings?.rebookIdValidityHours ?? 72))
    );
    const rebookSettings = { requestDeadlineHours, rebookIdValidityHours };
    const suggestedCancelWindow = Number(category.defaults?.suggestedCancelWindowHours ?? 6);
    const schemaSnapshot = snapshotCategorySchemas(category);
    const description = String(req.body.description || "").trim();

    const sharedFields = {
      name: title,
      type: category.slug,
      categoryId: category._id,
      categorySlug: category.slug,
      supportsOptions,
      listingAttributes: listingValidation.attributes,
      schemaSnapshot,
      catalogLocation,
      location: fullLocation,
      locationDetails,
      serviceLocation: {
        ...serviceLocation,
        latitude: catalogLocation.latitude,
        longitude: catalogLocation.longitude,
        formattedAddress: fullLocation,
        fullAddress: fullLocation,
        province: locationDetails.province,
        district: locationDetails.district,
        sector: locationDetails.sector,
      },
      description,
      basePrice: Number(req.body.basePrice || 0) || 0,
      priceText: "",
      images,
      primaryImage,
      promotion,
      rebookSettings,
      contactDetails: contactResult.value,
      contactInfo: req.user.email,
      payoutDetails: registeredPayout.value,
      services: [category.slug],
      status: normalizedStatus,
      availableQuantity: quantity,
      quantityRemaining: quantity,
      inventoryStatus,
    };

    if (serviceId) {
      const existingBusiness = await Hotel.findOne({ _id: serviceId, ...sellerBusinessFilter(req) });
      if (!existingBusiness) {
        return res.status(404).json({ message: "Business not found." });
      }

      const criticalChanged =
        existingBusiness.name !== title ||
        String(existingBusiness.categoryId || "") !== String(category._id) ||
        JSON.stringify(existingBusiness.listingAttributes || {}) !== JSON.stringify(listingValidation.attributes) ||
        Number(existingBusiness.catalogLocation?.latitude) !== Number(catalogLocation.latitude) ||
        Number(existingBusiness.catalogLocation?.longitude) !== Number(catalogLocation.longitude) ||
        JSON.stringify(existingBusiness.images || []) !== JSON.stringify(images) ||
        String(existingBusiness.primaryImage || "") !== String(primaryImage || "");

      const nextApproval =
        existingBusiness.approvalStatus === "approved" && !criticalChanged
          ? "approved"
          : "pending";

      const existingPromotion = existingBusiness.promotion || {};
      const promotionChanged =
        promotion.enabled &&
        (existingPromotion.enabled !== true ||
          existingPromotion.title !== promotion.title ||
          Number(existingPromotion.percent || 0) !== promotion.percent);

      const business = await Hotel.findOneAndUpdate(
        { _id: serviceId, ...sellerBusinessFilter(req) },
        {
          $set: {
            ...sharedFields,
            // Preserve admin-set commercial terms; sellers never overwrite them.
            cancelWindowHours: existingBusiness.cancelWindowHours ?? suggestedCancelWindow,
            cancelPenaltyPercent: existingBusiness.cancelPenaltyPercent,
            commissionPercentage: existingBusiness.commissionPercentage,
            ...(availabilityTable.rows.length ? { availabilityTable } : {}),
            approvalStatus: nextApproval,
          },
          ...(promotionChanged
            ? {
                $push: {
                  promotionHistory: {
                    $each: [{ ...promotion, recordedAt: new Date() }],
                    $slice: -20,
                  },
                },
              }
            : {}),
        },
        { returnDocument: "after", runValidators: true }
      );

      if (availabilityTable.rows.length) {
        await migrateAvailabilityRowsToOptions(business);
        await syncServiceOptionsToAvailabilityTable(business._id);
      }

      clearCache("public:");
      emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "seller-business-updated", hotelId: business._id });
      const [options, provider] = await Promise.all([
        ServiceOption.find({ serviceId: business._id }).sort({ sortOrder: 1 }).lean(),
        buildServiceProviderPayload(business.toObject ? business.toObject() : business, req.user),
      ]);
      return res.json({
        message:
          business.approvalStatus === "approved"
            ? "Service updated."
            : "Service updated and sent for admin approval.",
        service: {
          ...withPrimaryImage(business.toObject ? business.toObject() : business),
          options: options.map(serializeSellerOption),
          provider,
          providerName: provider.name,
          providerEmail: provider.email,
          providerPhone: provider.phone,
          sellerId: provider.sellerId,
        },
      });
    }

    const business = await Hotel.create({
      ...sharedFields,
      cancelWindowHours: suggestedCancelWindow,
      cancelPenaltyPercent: null,
      commissionPercentage: null,
      bookingRules: {
        cancellationPolicy: {
          type: "moderate",
          windowHours: suggestedCancelWindow,
          penaltyPercent: null,
        },
      },
      promotionHistory: promotion.enabled ? [{ ...promotion, recordedAt: new Date() }] : [],
      ownerEmail: `${req.user.sellerId || req.user._id}-${Date.now()}@seller.local`.toLowerCase(),
      sellerContactEmail: req.user.email,
      ownerUserId: req.user._id,
      supplierId: req.user.supplierId || null,
      approvalStatus: "pending",
      availabilityTable: availabilityTable.rows.length
        ? availabilityTable
        : { columns: [], rows: [], updatedAt: null },
      bookingForm: { title: "", description: "", fields: [] },
      bookingMode: "manual",
      agreementTerms: {
        setAtApproval: false,
        approvedBy: null,
        approvedAt: null,
        notes: "",
        rejectReason: "",
      },
    });

    if (availabilityTable.rows.length) {
      await migrateAvailabilityRowsToOptions(business);
      await syncServiceOptionsToAvailabilityTable(business._id);
    }

    if (!req.user.hotelId) {
      req.user.hotelId = business._id;
      await req.user.save();
    }

    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "seller-business-created", hotelId: business._id });
    clearCache("public:");
    const [options, provider] = await Promise.all([
      ServiceOption.find({ serviceId: business._id }).sort({ sortOrder: 1 }).lean(),
      buildServiceProviderPayload(business.toObject ? business.toObject() : business, req.user),
    ]);
    return res.status(201).json({
      message: "Service created and sent for admin approval.",
      service: {
        ...withPrimaryImage(business.toObject ? business.toObject() : business),
        options: options.map(serializeSellerOption),
        provider,
        providerName: provider.name,
        providerEmail: provider.email,
        providerPhone: provider.phone,
        sellerId: provider.sellerId,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to save service.",
      error: error.message,
    });
  }
};

const getMyService = async (req, res) => {
  try {
    if (ensureHotelUser(req, res) === null && !["hotel", "supplier"].includes(req.user?.role)) return;
    const business = await Hotel.findOne({ _id: req.params.serviceId, ...sellerBusinessFilter(req) }).lean();
    if (!business) return res.status(404).json({ message: "Service not found." });
    const [options, liveCategory, provider] = await Promise.all([
      ServiceOption.find({ serviceId: business._id }).sort({ sortOrder: 1, createdAt: 1 }).lean(),
      business.categoryId ? ServiceCategory.findById(business.categoryId).lean() : null,
      buildServiceProviderPayload(business, req.user),
    ]);
    const categorySlug = liveCategory?.slug || business.categorySlug || business.type;
    const optionSchema = liveCategory?.optionFieldSchema || business.schemaSnapshot?.optionFieldSchema || [];
    const servicePayload = {
      ...withCommissionTerms(withPrimaryImage(business)),
      // Seller UI should render options from this array (name/price/attributes only).
      options: options.map(serializeSellerOption),
      optionFieldSchema: optionSchema,
      provider,
      providerName: provider.name,
      providerEmail: provider.email,
      providerPhone: provider.phone,
      sellerId: provider.sellerId,
      categoryId: business.categoryId || liveCategory?._id || null,
      categorySlug,
      categoryName: liveCategory?.name || categorySlug,
      category: categorySlug,
    };
    // Hide booking-engine availabilityTable from seller detail UI (it contains internal defaults).
    delete servicePayload.availabilityTable;
    return res.json({ service: servicePayload });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch service.", error: error.message });
  }
};

const listMyServiceOptions = async (req, res) => {
  try {
    if (ensureHotelUser(req, res) === null && !["hotel", "supplier"].includes(req.user?.role)) return;
    const business = await Hotel.findOne({ _id: req.params.serviceId, ...sellerBusinessFilter(req) }).lean();
    if (!business) return res.status(404).json({ message: "Service not found." });
    if (business.supportsOptions === false) {
      return res.status(400).json({ message: "This service category does not support options." });
    }
    const options = await ServiceOption.find({ serviceId: business._id }).sort({ sortOrder: 1, createdAt: 1 }).lean();
    return res.json({
      options: options.map(serializeSellerOption),
      optionFieldSchema: business.schemaSnapshot?.optionFieldSchema || [],
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to list options.", error: error.message });
  }
};

const upsertMyServiceOption = async (req, res) => {
  try {
    if (ensureHotelUser(req, res) === null && !["hotel", "supplier"].includes(req.user?.role)) return;
    const business = await Hotel.findOne({ _id: req.params.serviceId, ...sellerBusinessFilter(req) });
    if (!business) return res.status(404).json({ message: "Service not found." });
    if (business.supportsOptions === false) {
      return res.status(400).json({ message: "This service category does not support options." });
    }

    const name = String(req.body.name || "").trim();
    const price = Number(req.body.price);
    if (!name || !Number.isFinite(price) || price < 0) {
      return res.status(400).json({ message: "name and a valid price are required." });
    }

    // Prefer live category option fields so admin changes apply immediately.
    let optionSchema = [];
    if (business.categoryId) {
      const liveCategory = await ServiceCategory.findById(business.categoryId)
        .select("optionFieldSchema")
        .lean();
      optionSchema = liveCategory?.optionFieldSchema || [];
    }
    if (!optionSchema.length) {
      optionSchema = business.schemaSnapshot?.optionFieldSchema || [];
    }
    const attrs = validateAttributesAgainstSchema(req.body.attributes || {}, optionSchema, {
      label: "option attributes",
      appliesTo: "option",
    });
    if (!attrs.ok) return res.status(400).json({ message: attrs.message, errors: attrs.errors });

    const engineDefaults = buildOptionEngineDefaults();
    const payload = {
      serviceId: business._id,
      name,
      price,
      currency: String(req.body.currency || "RWF").trim().toUpperCase() || "RWF",
      ...engineDefaults,
      attributes: attrs.attributes,
      sortOrder: Number(req.body.sortOrder || 0),
      isActive: req.body.isActive !== false,
    };

    let option;
    if (req.params.optionId) {
      option = await ServiceOption.findOneAndUpdate(
        { _id: req.params.optionId, serviceId: business._id },
        { $set: payload },
        { returnDocument: "after", runValidators: true }
      );
      if (!option) return res.status(404).json({ message: "Option not found." });
    } else {
      option = await ServiceOption.create(payload);
    }

    await syncServiceOptionsToAvailabilityTable(business._id);
    if (business.approvalStatus === "approved") {
      business.approvalStatus = "pending";
      await business.save();
    }
    clearCache("public:");
    return res.status(req.params.optionId ? 200 : 201).json({
      message: req.params.optionId ? "Option updated." : "Option created.",
      option: serializeSellerOption(option),
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to save option.", error: error.message });
  }
};

const deleteMyServiceOption = async (req, res) => {
  try {
    if (ensureHotelUser(req, res) === null && !["hotel", "supplier"].includes(req.user?.role)) return;
    const business = await Hotel.findOne({ _id: req.params.serviceId, ...sellerBusinessFilter(req) });
    if (!business) return res.status(404).json({ message: "Service not found." });
    const deleted = await ServiceOption.findOneAndDelete({
      _id: req.params.optionId,
      serviceId: business._id,
    });
    if (!deleted) return res.status(404).json({ message: "Option not found." });
    await syncServiceOptionsToAvailabilityTable(business._id);
    clearCache("public:");
    return res.json({ message: "Option deleted." });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete option.", error: error.message });
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
  getMyService,
  listMyServiceOptions,
  upsertMyServiceOption,
  deleteMyServiceOption,
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
