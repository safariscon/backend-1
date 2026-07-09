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

const DEPOSIT_PAID_STATUSES = ["deposit_paid", "deposit-paid", "paid"];

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
  const deposit = Number(booking.depositAmount || booking.amountPaid || Math.round(finalPrice * 0.3));
  return Math.max(0, Math.round(finalPrice - deposit));
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
  return data;
};

const normalizeAvailabilityTable = (table) => {
  const columns = [
    { id: "service", label: "Option name" },
    { id: "price", label: "Price (RWF)" },
    { id: "priceType", label: "Price type" },
    { id: "calculationField", label: "Calculation field" },
    { id: "durationUnit", label: "Duration unit" },
    { id: "maximumDuration", label: "Maximum duration" },
    { id: "availability", label: "Availability / capacity" },
    { id: "details", label: "Details / amenities" },
  ];
  const allowedPriceTypes = new Set(["fixed", "per-person", "per-room", "per-night", "per-day", "per-hour", "per-item", "per-ticket", "per-package", "per-session"]);
  const allowedCalculationFields = new Set(["people", "quantity", "duration", "package", "fixed"]);
  const allowedDurationUnits = new Set(["minutes", "hours", "days", "nights", "same-day", "none"]);
  const rows = (Array.isArray(table?.rows) ? table.rows : [])
    .map((row, rowIndex) => {
      const rawCells = row?.cells && typeof row.cells === "object" ? row.cells : {};
      const cells = {};
      cells.service = String(rawCells.service ?? "").trim();
      cells.price = String(rawCells.price ?? "").replace(/[^0-9]/g, "").trim();
      cells.priceType = allowedPriceTypes.has(rawCells.priceType) ? rawCells.priceType : "";
      cells.calculationField = allowedCalculationFields.has(rawCells.calculationField) ? rawCells.calculationField : "";
      cells.durationUnit = allowedDurationUnits.has(rawCells.durationUnit) ? rawCells.durationUnit : "";
      cells.maximumDuration = Math.max(0, Number(rawCells.maximumDuration || 0));
      cells.availability = Math.max(0, Math.floor(Number(rawCells.availability || 0)));
      cells.details = String(rawCells.details || "").replace(/<[^>]*>/g, "").trim().slice(0, 2000);
      return {
        id: String(row.id || `row_${rowIndex + 1}`).replace(/[^a-zA-Z0-9_-]/g, "_"),
        cells,
      };
    })
    .filter((row) => row.cells.service && row.cells.price)
    .slice(0, 50);

  return {
    columns,
    rows,
    updatedAt: new Date(),
  };
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
    const allowedStatuses = ["confirmed", "cancelled"];

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
      return res.status(409).json({ message: "This booking is not eligible. The 30% deposit must be paid first." });
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
          remainingPaymentStatus: "paid_to_seller",
          remainingAmount,
          remainingBalance: 0,
          bookingCodeUsed: true,
          bookingCodeUsedAt: now,
          completedAt: now,
          completedBySeller: req.user._id,
        },
        $push: {
          completionAuditLogs: {
            event: "booking_completed",
            message: "Seller verified Booking Code and confirmed remaining 70% paid.",
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
    const quantity = Math.max(0, Number(req.body.availableQuantity || req.body.quantityRemaining || 1));
    const locationDetails = {
      district: String(req.body.locationDetails?.district || "").trim(),
      sector: String(req.body.locationDetails?.sector || "").trim(),
      cell: String(req.body.locationDetails?.cell || "").trim(),
      village: String(req.body.locationDetails?.village || "").trim(),
    };
    if (Object.values(locationDetails).some((value) => !value)) {
      return res.status(400).json({ message: "District, sector, cell, and village are all required." });
    }
    const fullLocation = `${locationDetails.village}, ${locationDetails.cell}, ${locationDetails.sector}, ${locationDetails.district}`;
    const payoutDetails = {
      method: String(req.body.payoutDetails?.method || "mobile-money").trim(),
      accountName: String(req.body.payoutDetails?.accountName || "").trim(),
      accountNumber: String(req.body.payoutDetails?.accountNumber || "").trim(),
      instructions: String(req.body.payoutDetails?.instructions || "").trim(),
    };
    if (!payoutDetails.accountName || !payoutDetails.accountNumber) {
      return res.status(400).json({ message: "Payout account name and phone/account number are required." });
    }
    const normalizedStatus = req.body.status === "unavailable" ? "unavailable" : "available";
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
            description: String(description || "").trim(),
            basePrice: 0,
            priceText: "",
            images,
            promotion,
            rebookSettings,
            ...(req.body.contactDetails && typeof req.body.contactDetails === "object"
              ? {
                  "contactDetails.phone": String(req.body.contactDetails.phone || "").trim(),
                  "contactDetails.whatsapp": String(req.body.contactDetails.whatsapp || "").trim(),
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
            approvalStatus: existingBusiness.approvalStatus === "approved" ? "approved" : "pending",
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
      description: String(description || "").trim(),
      basePrice: 0,
      priceText: "",
      amenities: [],
      contactInfo: req.user.email,
      contactDetails: {
        ...(req.body.contactDetails && typeof req.body.contactDetails === "object" ? req.body.contactDetails : {}),
        email: req.body.contactDetails?.email || req.user.email,
        phone: req.body.contactDetails?.phone || req.user.phone || "",
      },
      payoutDetails,
      images,
      promotion,
      rebookSettings,
      promotionHistory: promotion.enabled ? [{ ...promotion, recordedAt: new Date() }] : [],
      services: [String(category).trim()],
      ownerEmail: `${req.user.sellerId || req.user._id}-${Date.now()}@seller.local`.toLowerCase(),
      sellerContactEmail: req.user.email,
      ownerUserId: req.user._id,
      supplierId: req.user.supplierId || null,
      approvalStatus: "pending",
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
