const Booking = require("../models/Booking");
const Hotel = require("../models/Hotel");
const Room = require("../models/Room");
const User = require("../models/User");
const Supplier = require("../models/Supplier");
const HotelService = require("../models/HotelService");
const Transaction = require("../models/Transaction");
const SiteSetting = require("../models/SiteSetting");
const AuditLog = require("../models/AuditLog");
const { normalizePriceOption, hasCompleteAutomaticRules, getAutomaticRuleDefaults } = require("../services/automaticBookingService");
const { registerBusinessByAdmin } = require("./authController");
const { prefixedCode, secureToken } = require("../utils/secureIds");
const { generateUniqueSellerId } = require("../utils/sellerIds");
const { sendProviderOnboardingEmail, sendBusinessApprovedEmail } = require("../utils/notify");
const { buildProviderInviteUrl, normalizeSellerId } = require("../utils/providerOnboarding");
const { buildAdminServiceFilter } = require("../utils/serviceFilters");
const mongoose = require("mongoose");
const {
  REALTIME_EVENTS,
  emitHotelRealtime,
  emitRealtime,
  emitUserRealtime,
} = require("../utils/realtime");
const { clearCache } = require("../utils/cache");

const registerBusiness = registerBusinessByAdmin;

const createSeller = async (req, res) => {
  try {
    const name = String(req.body.providerName || "").trim();
    const email = String(req.body.providerEmail || "").toLowerCase().trim();
    if (!name || !email) {
      return res.status(400).json({ message: "Service provider name and email are required." });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: "A user with this email already exists." });
    }

    const sellerId = await generateUniqueSellerId({
      exists: (candidate) => User.exists({ sellerId: candidate }),
    });

    const user = await User.create({
      name,
      email,
      password: "",
      role: "hotel",
      sellerId,
      mustSetPassword: true,
    });

    const registrationUrl = buildProviderInviteUrl({ sellerId });
    let credentialEmailSent = false;
    let credentialEmailWarning = "";
    try {
      await sendProviderOnboardingEmail({
        providerEmail: email,
        providerName: name,
        sellerId,
        registrationUrl,
      });
      credentialEmailSent = true;
    } catch (emailError) {
      credentialEmailWarning = "Service provider account was created, but seller ID email delivery failed.";
      console.warn("Service provider seller ID email delivery failed:", emailError.message);
    }

    return res.status(201).json({
      message: credentialEmailWarning || "Service provider account created successfully.",
      seller: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        sellerId,
      },
      credentials: {
        providerName: name,
        providerEmail: email,
        serviceProviderName: name,
        serviceProviderEmail: email,
        sellerId,
        registrationPath: "/provider-register",
        registrationUrl,
      },
      credentialEmail: {
        sent: credentialEmailSent,
        warning: credentialEmailWarning,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create seller.", error: error.message });
  }
};

const isObjectId = (value) =>
  mongoose.Types.ObjectId.isValid(value) && String(new mongoose.Types.ObjectId(value)) === String(value);

const resolveProviderOwnerId = async (query = {}) => {
  const rawProvider = String(query.providerId || query.ownerUserId || query.userId || query.provider || "").trim();
  const sellerId = normalizeSellerId(query.sellerId || query.providerSellerId || "");
  const providerEmail = String(query.providerEmail || "").trim().toLowerCase();
  const looksLikeSellerId = /^SP\d+$/i.test(rawProvider);

  if (isObjectId(rawProvider) && !looksLikeSellerId) {
    return { ownerUserId: rawProvider, applied: true };
  }

  const resolvedSellerId = sellerId || (looksLikeSellerId ? normalizeSellerId(rawProvider) : "");
  if (resolvedSellerId || providerEmail) {
    const owner = await User.findOne({
      role: { $in: ["hotel", "supplier"] },
      ...(resolvedSellerId ? { sellerId: resolvedSellerId } : {}),
      ...(providerEmail ? { email: providerEmail } : {}),
    }).select("_id name email sellerId");
    if (!owner) return { ownerUserId: null, applied: true, missing: true };
    return { ownerUserId: owner._id, applied: true };
  }

  return { ownerUserId: null, applied: false };
};

const listServices = async (req, res) => {
  try {
    const provider = await resolveProviderOwnerId(req.query);
    if (provider.missing) {
      const providers = await User.find({ role: { $in: ["hotel", "supplier"] } })
        .select("name email sellerId")
        .sort({ name: 1 })
        .lean();
      return res.json({
        services: [],
        providers,
        filters: {
          providerId: req.query.providerId || req.query.ownerUserId || req.query.provider || "",
          sellerId: req.query.sellerId || "",
        },
      });
    }

    const filter = buildAdminServiceFilter(req.query, provider.ownerUserId);
    const services = await Hotel.find(filter)
      .populate("ownerUserId", "name email sellerId")
      .sort({ createdAt: -1 })
      .lean();

    const providers = await User.find({ role: { $in: ["hotel", "supplier"] } })
      .select("name email sellerId")
      .sort({ name: 1 })
      .lean();

    return res.json({
      services: services.map((business) => ({
        ...business,
        title: business.name,
        category: business.type,
        businessId: business,
        availableQuantity: business.quantityRemaining ?? business.availableQuantity ?? 0,
        verificationStatus: business.approvalStatus,
        provider: business.ownerUserId
          ? {
              id: business.ownerUserId._id,
              name: business.ownerUserId.name,
              email: business.ownerUserId.email,
              sellerId: business.ownerUserId.sellerId,
            }
          : null,
      })),
      providers,
      filters: {
        providerId: provider.applied ? String(provider.ownerUserId || "") : "",
        sellerId: String(req.query.sellerId || "").trim(),
        category: String(req.query.category || req.query.type || "").trim(),
        location: String(req.query.location || "").trim(),
        search: String(req.query.search || req.query.q || "").trim(),
        approvalStatus: String(req.query.approvalStatus || "").trim(),
      },
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
    const commissionPercentage = Math.max(0, Math.min(100, Number(req.body.commissionPercentage ?? 5)));

    const business = await Hotel.findByIdAndUpdate(
      businessId,
      {
        $set: {
          approvalStatus,
          ...(approvalStatus === "approved" ? { status: "available", commissionPercentage } : {}),
        },
        ...(approvalStatus === "approved"
          ? { $max: { availableQuantity: 1, quantityRemaining: 1 } }
          : {}),
      },
      { returnDocument: "after", runValidators: true }
    );
    if (!business) return res.status(404).json({ message: "Business not found." });
    if (approvalStatus === "approved") {
      try {
        await business.populate("ownerUserId", "name email");
        const serviceProviderEmail =
          business.ownerUserId?.email || business.sellerContactEmail || business.ownerEmail;
        if (serviceProviderEmail && !/@business\.local$|@seller\.local$/i.test(serviceProviderEmail)) {
          await sendBusinessApprovedEmail({
            serviceProviderEmail,
            serviceProviderName: business.ownerUserId?.name || business.name,
            businessName: business.name,
            commissionPercentage: business.commissionPercentage,
          });
        }
      } catch (emailError) {
        console.warn("Business approval email failed:", emailError.message);
      }
    }

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
    const enabled = req.body.enabled !== false;
    const intervalSeconds = Math.max(1, Math.min(3600, Number(req.body.intervalSeconds) || 5));
    const submittedItems = Array.isArray(req.body.items)
      ? req.body.items
      : [{ text: req.body.text, linkUrl: req.body.linkUrl, linkLabel: req.body.linkLabel }];
    const items = submittedItems
      .slice(0, 5)
      .map((item) => ({
        text: String(item?.text || "").trim(),
        linkUrl: String(item?.linkUrl || "").trim(),
        linkLabel: String(item?.linkLabel || "").trim(),
      }))
      .filter((item) => item.text);

    if (enabled && !items.length) {
      return res.status(400).json({ message: "Add at least one announcement when the bar is enabled." });
    }

    const setting = await SiteSetting.findOneAndUpdate(
      { key: "announcement" },
      {
        $set: {
          value: {
            enabled,
            intervalSeconds,
            items,
          },
        },
      },
      { upsert: true, returnDocument: "after", runValidators: true }
    );

    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "announcement-updated" });
    return res.json({ message: `${items.length} announcement(s) updated.`, announcement: setting.value });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update announcement.", error: error.message });
  }
};

const approveBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const quotedTotal = Number(req.body.totalPrice);
    const paymentReason = String(req.body.paymentReason || "").trim();
    if (!Number.isFinite(quotedTotal) || quotedTotal <= 0) {
      return res.status(400).json({ message: "Enter the exact quoted service price in RWF before approval." });
    }
    if (!paymentReason) {
      return res.status(400).json({ message: "Enter the reason or purpose for the customer payment before approval." });
    }
    if (paymentReason.length > 500) {
      return res.status(400).json({ message: "Payment reason must be 500 characters or fewer." });
    }
    const existingForPolicy = await Booking.findById(bookingId).select("bookingMode preferredHotelId hotelId status");
    if (
      existingForPolicy?.bookingMode === "manual" &&
      (existingForPolicy.preferredHotelId || existingForPolicy.hotelId)
    ) {
      return res.status(409).json({
        message: "Manual service bookings must be approved by the assigned service provider.",
      });
    }
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

    const business = await Hotel.findOne({
      _id: businessId,
      approvalStatus: "approved",
      status: "available",
    });

    if (!business) {
      await Booking.updateOne(
        { _id: booking._id, status: "reviewing" },
        {
          $set: {
            status: "pending",
            isConnected: false,
            adminResponseMessage: "Service is not approved or is marked unavailable by the seller or admin.",
          },
        }
      );
      return res.status(409).json({
        message: "Service is not approved or is marked unavailable by the seller or admin.",
      });
    }

    booking.hotelId = business._id;
    booking.preferredHotelId = booking.preferredHotelId || business._id;
    booking.supplierId = business.supplierId || null;
    booking.quantity = quantity;
    const commissionPercentage = Math.max(0, Math.min(100, Number(req.body.commissionPercentage ?? business.commissionPercentage ?? 10)));
    const depositPercentage = 30;
    booking.totalPrice = Math.round(quotedTotal);
    booking.depositPercentage = depositPercentage;
    booking.depositPercent = depositPercentage;
    booking.depositAmount = Math.round((booking.totalPrice * depositPercentage) / 100);
    booking.remainingBalance = Math.max(0, booking.totalPrice - booking.depositAmount);
    booking.detailsUnlocked = false;
    booking.depositPaid = false;
    booking.locationUnlocked = false;
    booking.locationUnlockedAt = null;
    booking.commissionPercentage = commissionPercentage;
    booking.commissionAmount = Math.round((booking.totalPrice * commissionPercentage) / 100);
    booking.paymentReason = paymentReason;
    business.commissionPercentage = commissionPercentage;
    booking.status = "confirmed";
    booking.isConnected = true;
    booking.isAcknowledgedByAdmin = true;
    booking.acknowledgedAt = new Date();
    booking.adminResponseMessage = `Booking approved and assigned to ${business.name}. Payment purpose: ${paymentReason}`;
    if (!booking.bookingCode) booking.bookingCode = prefixedCode("SCN", 10);
    if (!booking.verificationCode) booking.verificationCode = prefixedCode("VERIFY", 10);
    if (!booking.verificationToken) {
      booking.verificationToken = secureToken([booking._id, booking.bookingCode, booking.touristId]);
    }
    await booking.save();

    await business.save();

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

const rejectBooking = async (req, res) => {
  try {
    const reason = String(req.body.reason || "The booking request could not be approved.").trim();
    const booking = await Booking.findOneAndUpdate(
      { _id: req.params.bookingId, status: { $in: ["pending", "reviewing"] } },
      {
        $set: {
          status: "rejected",
          isAcknowledgedByAdmin: true,
          acknowledgedAt: new Date(),
          adminResponseMessage: reason,
        },
      },
      { returnDocument: "after", runValidators: true }
    );
    if (!booking) return res.status(409).json({ message: "Only pending bookings can be rejected." });
    emitUserRealtime(booking.touristId, REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "rejected",
      bookingId: booking._id,
      status: booking.status,
    });
    return res.json({ message: "Booking request rejected.", booking });
  } catch (error) {
    return res.status(500).json({ message: "Failed to reject booking.", error: error.message });
  }
};

const updateMarketplaceSettings = async (req, res) => {
  try {
    const bookingRules = (Array.isArray(req.body.bookingRules) ? req.body.bookingRules : [])
      .map((rule) => String(rule || "").trim())
      .filter(Boolean)
      .slice(0, 20);
    const defaultCommissionPercentage = Math.max(0, Math.min(100, Number(req.body.defaultCommissionPercentage) || 5));
    const bookingMode = ["manual", "automatic", "service-level"].includes(req.body.bookingMode)
      ? req.body.bookingMode
      : "manual";
    const setting = await SiteSetting.findOneAndUpdate(
      { key: "marketplace-settings" },
      { $set: { value: { depositPercentage: 30, defaultCommissionPercentage, bookingMode, bookingRules } } },
      { upsert: true, returnDocument: "after", runValidators: true }
    );
    clearCache("public:");
    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "marketplace-settings-updated" });
    if (AuditLog.db.readyState === 1) await AuditLog.create({ action: "admin-changed-global-booking-mode", actorId: req.user._id, actorRole: req.user.role, metadata: { bookingMode } });
    return res.json({ message: "Marketplace booking settings updated.", settings: setting.value });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update marketplace settings.", error: error.message });
  }
};

const updateServiceBookingMode = async (req, res) => {
  try {
    const bookingMode = req.body.bookingMode === "automatic" ? "automatic" : "manual";
    let automaticTable = null;
    if (bookingMode === "automatic") {
      const current = await Hotel.findById(req.params.businessId);
      if (!current) return res.status(404).json({ message: "Service not found." });
      const rows = current.availabilityTable?.rows || [];
      const defaults = getAutomaticRuleDefaults(current.type);
      const fallbackAvailability = Math.max(1, Number(current.quantityRemaining ?? current.availableQuantity ?? 1));
      const completedRows = rows.map((row) => ({
        id: row.id,
        cells: {
          ...(row.cells || {}),
          priceType: row.cells?.priceType || defaults.priceType,
          calculationField: row.cells?.calculationField || defaults.calculationField,
          durationUnit: row.cells?.durationUnit || defaults.durationUnit,
          maximumDuration: Number(row.cells?.maximumDuration || defaults.maximumDuration),
          availability: Math.max(1, Number(row.cells?.availability || fallbackAvailability)),
          details: String(row.cells?.details || current.description || "").trim().slice(0, 2000),
        },
      }));
      const options = completedRows.map(normalizePriceOption);
      if (!options.length || options.some((option) => !hasCompleteAutomaticRules(option))) {
        return res.status(400).json({ message: "Automatic booking needs at least one option with an option name and an RWF price. Add those two values in the seller price options first." });
      }
      automaticTable = {
        columns: [
          { id: "service", label: "Option name" }, { id: "price", label: "Price (RWF)" },
          { id: "priceType", label: "Price type" }, { id: "calculationField", label: "Calculation field" },
          { id: "durationUnit", label: "Duration unit" }, { id: "maximumDuration", label: "Maximum duration" },
          { id: "availability", label: "Availability / capacity" },
          { id: "availableFrom", label: "Available from" }, { id: "availableTo", label: "Available until" },
          { id: "availableDays", label: "Weekdays" },
          { id: "availableStartTime", label: "Opens" }, { id: "availableEndTime", label: "Closes" },
          { id: "requiresTime", label: "Times required" },
          { id: "details", label: "Details / amenities" },
        ],
        rows: completedRows,
        updatedAt: new Date(),
      };
    }
    const business = await Hotel.findByIdAndUpdate(
      req.params.businessId,
      { $set: { bookingMode, ...(automaticTable ? { availabilityTable: automaticTable } : {}) } },
      { returnDocument: "after", runValidators: true }
    );
    if (!business) return res.status(404).json({ message: "Service not found." });
    await SiteSetting.findOneAndUpdate(
      { key: "marketplace-settings" },
      { $set: { "value.bookingMode": "service-level" }, $setOnInsert: { "value.depositPercentage": 30, "value.defaultCommissionPercentage": 5, "value.bookingRules": [] } },
      { upsert: true, returnDocument: "after" }
    );
    if (AuditLog.db.readyState === 1) await AuditLog.create({ action: "admin-changed-service-booking-mode", actorId: req.user._id, actorRole: req.user.role, businessId: business._id, metadata: { bookingMode, legacyRulesCompleted: Boolean(automaticTable) } });
    clearCache("public:");
    return res.json({ message: `${business.name} now uses ${bookingMode} booking. Global mode changed to service-level control.`, service: business, globalBookingMode: "service-level" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update service booking mode.", error: error.message });
  }
};

const listTransactions = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 25)));
    const skip = (page - 1) * limit;
    const filter = {};
    const createdAt = {};
    if (req.query.from) createdAt.$gte = new Date(req.query.from);
    if (req.query.to) createdAt.$lte = new Date(req.query.to);
    if (Object.keys(createdAt).length) filter.createdAt = createdAt;
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.businessId) filter.businessId = req.query.businessId;

    const [transactions, total, summaryRows, dailyRows, hourlyRows] = await Promise.all([
      Transaction.find(filter)
      .populate("bookingId", "_id status paymentStatus totalPrice commissionPercentage commissionAmount createdAt")
      .populate("userId", "name email")
      .populate("sellerId", "name email sellerId")
      .populate("businessId", "name type payoutDetails commissionPercentage")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
      Transaction.countDocuments(filter),
      Transaction.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalReceived: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$amount", 0] } },
            commissionCollected: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "paid"] }, { $eq: ["$commissionStatus", "collected"] }] }, "$commissionAmount", 0] } },
            commissionDue: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "paid"] }, { $eq: ["$commissionStatus", "pending"] }] }, "$commissionAmount", 0] } },
            pendingPayments: { $sum: { $cond: [{ $ne: ["$status", "paid"] }, "$amount", 0] } },
            count: { $sum: 1 },
          },
        },
      ]),
      Transaction.aggregate([
        { $match: filter },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            totalReceived: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$amount", 0] } },
            commissionAmount: { $sum: "$commissionAmount" },
            bookings: { $sum: 1 },
          },
        },
        { $sort: { _id: -1 } },
      ]),
      Transaction.aggregate([
        { $match: filter },
        {
          $group: {
            _id: {
              day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
              hour: { $hour: "$createdAt" },
            },
            totalReceived: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$amount", 0] } },
            commissionAmount: { $sum: "$commissionAmount" },
            bookings: { $sum: 1 },
          },
        },
        { $sort: { "_id.day": -1, "_id.hour": -1 } },
      ]),
    ]);

    const summary = summaryRows[0] || {
      totalReceived: 0,
      commissionCollected: 0,
      commissionDue: 0,
      pendingPayments: 0,
      count: 0,
    };

    return res.json({
      transactions,
      summary,
      daily: dailyRows.map((row) => ({ date: row._id, totalReceived: row.totalReceived, commissionAmount: row.commissionAmount, bookings: row.bookings })),
      hourly: hourlyRows.map((row) => ({ date: row._id.day, hour: row._id.hour, totalReceived: row.totalReceived, commissionAmount: row.commissionAmount, bookings: row.bookings })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch transactions.", error: error.message });
  }
};

const updateCommissionStatus = async (req, res) => {
  try {
    const commissionStatus = String(req.body.commissionStatus || "").trim();
    if (!["pending", "collected", "waived"].includes(commissionStatus)) {
      return res.status(400).json({ message: "Commission status must be pending, collected, or waived." });
    }
    const transaction = await Transaction.findByIdAndUpdate(
      req.params.transactionId,
      { $set: { commissionStatus } },
      { returnDocument: "after", runValidators: true }
    );
    if (!transaction) return res.status(404).json({ message: "Transaction not found." });
    return res.json({ message: `Commission marked ${commissionStatus}.`, transaction });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update commission status.", error: error.message });
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
      .populate("completedBySeller", "name email sellerId")
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
  registerBusiness,
  createSeller,
  updateAnnouncement,
  listServices,
  updateBusinessVerification,
  approveBooking,
  rejectBooking,
  updateMarketplaceSettings,
  updateServiceBookingMode,
  verifyBookingByLookup,
  listTransactions,
  updateCommissionStatus,
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
