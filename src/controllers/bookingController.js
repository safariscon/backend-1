const Booking = require("../models/Booking");
const Hotel = require("../models/Hotel");
const Transaction = require("../models/Transaction");
const SiteSetting = require("../models/SiteSetting");
const AuditLog = require("../models/AuditLog");
const { REALTIME_EVENTS, emitHotelRealtime, emitRealtime, emitUserRealtime } = require("../utils/realtime");
const { prefixedCode, secureToken } = require("../utils/secureIds");
const { createPdfReceipt } = require("../utils/pdfReceipt");
const { createGuestName } = require("../utils/anonymousBusiness");
const { getPublicLocation, getUnlockedServiceLocation } = require("../utils/serviceLocation");
const { storeBookingPdf, getBookingPdfDownloadUrl } = require("../services/bookingPdfStorage");
const { buildEventData, recordAnalyticsEvent } = require("./analyticsController");
const { claimRebookId, finalizeRebookIdUse, releaseRebookIdClaim } = require("./rebookController");
const { sendServiceProviderBookingRequestEmail, sendCustomerBookingReceivedEmail, sendBookingPaidEmail, sendBookingCodeEmail, sendBookingCancelledEmail, isDeliverableEmail, resolveLanguage } = require("../utils/notify");
const { buildSellerBookingsUrl, buildCustomerBookingsUrl } = require("../utils/frontendUrls");
const { normalizeCustomerPaymentDetails } = require("../utils/payoutDetails");
const { resolveCommissionPercentage } = require("../utils/commission");
const { getXentripayConfig, toClientPaymentError } = require("../services/xentripayService");
const { validateAttributesAgainstSchema } = require("../utils/fieldSchema");
const ServiceCategory = require("../models/ServiceCategory");
const ServiceOption = require("../models/ServiceOption");
const {
  startCollection,
  refreshCollection,
  startProviderPayout,
  startCustomerRefundPayout,
  findLatestTransaction,
  hasAcceptedGatewayCollection,
  isReusablePendingCollection,
  abandonStaleCollection,
  syncPendingCollections,
} = require("../services/paymentSettlementService");
const {
  policyFromBusiness,
  resolveRefundableUntil,
  canCustomerCancel,
  splitCancelAmounts,
  cancelCommissionPercentOf,
} = require("../utils/cancellation");
const {
  cleanText,
  normalizePriceOption,
  isAutomaticReady,
  resolveBookingMode,
  calculateQuote,
  applyPromotionToQuote,
  getActivePromotion,
  validateBookingSchedule,
  normalizeAvailableDays,
} = require("../services/automaticBookingService");

const publicFrontendUrl = () =>
  String(process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || "https://safariscon.eserveconn.com").replace(/\/+$/, "");

const buildVerifyUrl = (token) => `${publicFrontendUrl()}/verify/${encodeURIComponent(token)}`;
const buildPaymentUrl = (bookingId) => `${publicFrontendUrl()}/bookings/${encodeURIComponent(bookingId)}/pay`;

const buildQrImageUrl = (token) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=12&data=${encodeURIComponent(
    buildVerifyUrl(token)
  )}`;

const DEPOSIT_PERCENT = 100;
const DEPOSIT_PAID_STATUSES = ["deposit_paid", "deposit-paid", "paid"];

const hasDepositPaid = (booking) => Boolean(booking?.detailsUnlocked) || DEPOSIT_PAID_STATUSES.includes(booking?.paymentStatus);

const locationIsUnlockedForCustomer = (booking, customerId) =>
  String(booking?.touristId?._id || booking?.touristId || "") === String(customerId || "") &&
  booking?.depositPaid === true &&
  booking?.locationUnlocked === true;

const sanitizeBusinessLocationForCustomer = (business, booking, customerId) => {
  if (!business) return business;
  const exactUnlocked = locationIsUnlockedForCustomer(booking, customerId);
  const sanitized = { ...business };
  delete sanitized.commissionPercentage;
  delete sanitized.payoutDetails;
  sanitized.publicLocation = getPublicLocation(business);
  sanitized.serviceLocation = exactUnlocked ? getUnlockedServiceLocation(business) : sanitized.publicLocation;
  sanitized.locationDetails = exactUnlocked
    ? {
        province: sanitized.serviceLocation.province,
        district: sanitized.serviceLocation.district,
        sector: sanitized.serviceLocation.sector,
        cell: sanitized.serviceLocation.cell,
        village: sanitized.serviceLocation.village,
      }
    : {
        province: sanitized.publicLocation.province,
        district: sanitized.publicLocation.district,
        sector: sanitized.publicLocation.sector,
      };
  if (!exactUnlocked) {
    delete sanitized.contactInfo;
    delete sanitized.contactDetails;
    delete sanitized.ownerEmail;
    delete sanitized.sellerContactEmail;
  }
  return sanitized;
};

const calculateDepositAmount = (totalPrice, depositPercent = DEPOSIT_PERCENT) =>
  Math.round((Math.max(0, Number(totalPrice || 0)) * Math.max(0, Number(depositPercent || 0))) / 100);

const getPaidDepositAmount = (booking) => {
  const configuredDeposit = Number(booking?.depositAmount || 0);
  const calculatedDeposit = calculateDepositAmount(booking?.totalPrice, booking?.depositPercent || booking?.depositPercentage || DEPOSIT_PERCENT);
  const paidAmount = Number(booking?.amountPaid || 0);
  const deposit = configuredDeposit || calculatedDeposit;
  return Math.max(0, paidAmount > 0 ? Math.min(paidAmount, deposit) : deposit);
};

const calculateRefundAmount = (booking, refundPercentOfDeposit) =>
  Math.round((getPaidDepositAmount(booking) * Math.max(0, Number(refundPercentOfDeposit || 0))) / 100);

const normalizeCustomerLocationDetails = (value = {}) => {
  const latitudeRaw =
    value.latitudeRaw != null && String(value.latitudeRaw).trim()
      ? String(value.latitudeRaw).trim()
      : value.latitude != null
        ? String(value.latitude).trim()
        : "";
  const longitudeRaw =
    value.longitudeRaw != null && String(value.longitudeRaw).trim()
      ? String(value.longitudeRaw).trim()
      : value.longitude != null
        ? String(value.longitude).trim()
        : "";
  const latitude = Number(latitudeRaw);
  const longitude = Number(longitudeRaw);
  const state = cleanText(value.state || value.province, 120);
  const city = cleanText(value.city || value.district, 120);
  const area = cleanText(value.area || value.sector, 120);
  const country = cleanText(value.country, 120) || "Rwanda";
  const countryCode = cleanText(value.countryCode, 8).toUpperCase() || "RW";
  const formattedAddress = cleanText(value.formattedAddress || value.fullAddress || value.address, 500);

  return {
    country,
    countryCode,
    state,
    city,
    province: cleanText(value.province, 120) || state,
    district: cleanText(value.district, 120) || city,
    sector: cleanText(value.sector, 120) || area,
    area,
    cell: cleanText(value.cell, 120),
    village: cleanText(value.village, 120),
    placeName: cleanText(value.placeName || value.name, 200),
    formattedAddress,
    fullAddress: cleanText(value.fullAddress, 500) || formattedAddress,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    latitudeRaw,
    longitudeRaw,
    placeId: cleanText(value.placeId, 200),
    locationSource: cleanText(value.locationSource, 40) || "map_click",
  };
};

const formatCustomerLocation = (details = {}) => {
  if (details.formattedAddress) return details.formattedAddress;
  if (details.fullAddress) return details.fullAddress;
  const named = [
    details.placeName,
    details.area || details.sector,
    details.city || details.district,
    details.state || details.province,
    details.country || "Rwanda",
  ]
    .filter(Boolean)
    .join(", ");
  if (named) return named;
  if (Number.isFinite(details.latitude) && Number.isFinite(details.longitude)) {
    return `${details.latitude}, ${details.longitude}`;
  }
  return "";
};

const assertCustomerMapPin = (details = {}) => {
  if (!Number.isFinite(details.latitude) || !Number.isFinite(details.longitude)) {
    return {
      ok: false,
      message: "Customer map location (latitude/longitude) is required.",
    };
  }
  return { ok: true };
};

const formatBookingDateLabel = (value) => {
  if (!value) return "";
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
};

const resolveSellerEmail = (business) => {
  const candidates = [
    business?.ownerUserId?.email,
    business?.sellerContactEmail,
    business?.ownerEmail,
  ];
  return candidates.find((email) => isDeliverableEmail(email)) || "";
};

const notifyBookingCreated = async ({
  booking,
  customer,
  business,
  selectedOption,
  automaticQuote,
  language,
}) => {
  const bookingId = booking?._id;
  const mode = booking?.bookingMode || (automaticQuote ? "automatic" : "manual");
  const details = booking?.bookingDetails || {};
  const optionName =
    selectedOption?.name ||
    details.requestedService ||
    details.optionName ||
    details.serviceName ||
    "";
  const customerName =
    details.fullName || customer?.name || "Customer";
  const customerEmail = details.email || customer?.email || "";
  const shared = {
    bookingId,
    bookingCode: booking?.bookingCode,
    bookingMode: mode,
    businessName: business?.name || booking?.destinationPlace || "SafarisCon service",
    optionName,
    bookingDate: formatBookingDateLabel(details.bookingDate || details.startDate || booking?.bookingDate),
    endBookingDate: formatBookingDateLabel(details.endBookingDate || details.endDate || booking?.endBookingDate),
    startTime: details.startTime || booking?.startTime || "",
    endTime: details.endTime || booking?.endTime || "",
    guests: booking?.guests,
    numberOfPeople: booking?.numberOfPeople,
    quantity: booking?.quantity,
    totalPrice: automaticQuote?.finalPrice || automaticQuote?.total || booking?.totalPrice || 0,
  };

  const sellerEmail = resolveSellerEmail(business);
  if (sellerEmail) {
    await sendServiceProviderBookingRequestEmail({
      ...shared,
      serviceProviderEmail: sellerEmail,
      serviceProviderName: business?.ownerUserId?.name || business?.name,
      serviceCategory: business?.type || "",
      customerName,
      customerLocation: booking?.customerLocation || details.customerLocation || "",
      specialRequests: details.specialRequests || "",
      dashboardUrl: buildSellerBookingsUrl({ bookingId }),
      language,
    });
  }

  if (isDeliverableEmail(customerEmail)) {
    await sendCustomerBookingReceivedEmail({
      ...shared,
      customerEmail,
      customerName,
      dashboardUrl: buildCustomerBookingsUrl({ bookingId }),
      paymentUrl: automaticQuote ? buildPaymentUrl(bookingId) : "",
      language,
    });
  }
};

const findSelectedServiceOption = (business, body = {}, details = {}) => {
  const rows = (business?.availabilityTable?.rows || []).map(normalizePriceOption);
  const optionId = String(
    details.selectedOptionId || body.selectedOptionId || details.optionId || body.optionId || ""
  ).trim();
  const optionName = String(
    details.requestedService || details.optionName || body.requestedService || body.optionName || ""
  ).trim();
  if (optionId) return rows.find((option) => option.id === optionId) || null;
  if (optionName) return rows.find((option) => option.name === optionName) || null;
  return null;
};

const buildPriceSnapshot = ({
  selectedOption,
  automaticQuote,
  bookingPeople,
  bookingQuantity,
  totalConsumptionUnits,
}) => {
  if (!selectedOption) return null;
  if (automaticQuote) {
    return {
      ...selectedOption,
      availabilityAtBooking: selectedOption.availability,
      bookingDuration: 1,
      numberOfPeople: automaticQuote.people,
      quantity: automaticQuote.quantity,
      totalConsumptionUnits: automaticQuote.totalConsumptionUnits,
      totalPrice: automaticQuote.total,
      originalPrice: automaticQuote.originalPrice,
      promotionApplied: automaticQuote.promotionApplied,
      promotionTitle: automaticQuote.promotionTitle,
      promotionPercent: automaticQuote.promotionPercent,
      discountAmount: automaticQuote.discountAmount,
      finalPrice: automaticQuote.finalPrice,
      depositPercent: automaticQuote.depositPercent,
      depositAmount: automaticQuote.deposit,
      remainingBalance: automaticQuote.remaining,
      paymentReason: automaticQuote.reason,
    };
  }
  return {
    ...selectedOption,
    availabilityAtBooking: selectedOption.availability,
    numberOfPeople: bookingPeople,
    quantity: bookingQuantity,
    totalConsumptionUnits,
    totalPrice: 0,
  };
};

const resolveBookingActionDeadline = (booking) => {
  const details = booking?.bookingDetails || {};
  const value = details.bookingDate || details.startDate || details.pickupDate || booking?.checkIn;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const buildLockedBusiness = (sourceBusiness, booking) => {
  if (!sourceBusiness) return null;
  const publicLocation = getPublicLocation(sourceBusiness);
  const locationDetails = {
    province: publicLocation.province,
    district: publicLocation.district || sourceBusiness.district || "",
    sector: publicLocation.sector || sourceBusiness.sector || "",
  };
  return {
    _id: sourceBusiness._id,
    name: booking.anonymousBusinessName || createGuestName(sourceBusiness.type, 1),
    type: sourceBusiness.type,
    description: sourceBusiness.description || "",
    services: sourceBusiness.services || [],
    images: sourceBusiness.images || [],
    primaryImage: sourceBusiness.primaryImage || (sourceBusiness.images || [])[0] || "",
    location: locationDetails.district || sourceBusiness.location || "District available after seller updates location",
    publicLocation,
    serviceLocation: publicLocation,
    locationDetails,
    district: locationDetails.district,
    sector: locationDetails.sector,
    basePrice: Number(sourceBusiness.basePrice || booking.totalPrice || 0),
    priceText: sourceBusiness.priceText || "",
    isAnonymous: true,
  };
};

const applyCustomerCancellation = async ({ booking, reason, now = new Date() }) => {
  const paidAmount = Number(booking.amountPaid || booking.totalPrice || 0);
  const penaltyPercent = Number(booking.cancellation?.penaltyPercent || 20);
  const split = splitCancelAmounts({
    paidAmount,
    penaltyPercent,
    bookingCommissionPercent: booking.commissionPercentage,
  });

  booking.status = "cancelled";
  booking.paymentStatus = "refunded";
  booking.refundStatus = "approved";
  booking.refundAmount = split.refundAmount;
  booking.refundReason = "Customer cancelled inside the allowed window. A cancellation fee was kept.";
  booking.refundPercentOfDeposit = split.refundPercent;
  booking.cancelledAt = now;
  booking.cancellationReason = reason;
  booking.cancellation = {
    ...(booking.cancellation || {}),
    cancelledAt: now,
    refundAmount: split.refundAmount,
    penaltyAmount: split.penaltyAmount,
    penaltyPercent: split.penaltyPercent,
    cancelCommissionPercent: split.cancelCommissionPercent,
    platformCancelAmount: split.platformAmount,
    providerCancelAmount: split.providerAmount,
  };
  const saved = await booking.save();

  const transaction = await findLatestTransaction(booking._id);
  if (transaction && transaction.status === "paid") {
    transaction.platformAmount = split.platformAmount;
    transaction.commissionAmount = split.platformAmount;
    transaction.providerAmount = split.providerAmount;
    transaction.sellerEarnings = split.providerAmount;
    transaction.commissionPercentage = split.cancelCommissionPercent;
    transaction.status = "refunded";
    await transaction.save();

    const businessId = booking.hotelId || booking.preferredHotelId;
    const business = businessId ? await Hotel.findById(businessId) : null;
    if (split.providerAmount > 0 && business) {
      try {
        await startProviderPayout(transaction, business);
      } catch (error) {
        console.warn("Cancel provider payout failed:", error.message);
      }
    }
    if (split.refundAmount > 0) {
      try {
        await startCustomerRefundPayout(transaction, split.refundAmount);
      } catch (error) {
        console.warn("Customer refund payout failed:", error.message);
      }
    }
  }

  return { booking: saved, split, transaction };
};

const createBookingRequest = async (req, res) => {
  let reservedBusiness = null;
  let reservedOptionId = "";
  let reservedQuantity = 0;
  let rebookClaim = null;
  let rebookFinalized = false;
  let createdBooking = null;
  let rebookOriginalBooking = null;
  try {
    const {
      hotelId,
      checkIn,
      checkOut,
      bookingDate,
      endBookingDate,
      startTime,
      endTime,
      guests,
      numberOfPeople,
      quantity,
      totalPrice,
      destinationPlace,
      destinationLocation,
      customerLocation,
      customerLocationDetails,
      bookingDetails,
      rebookId,
    } = req.body;

    const rawDetails = bookingDetails && typeof bookingDetails === "object" ? bookingDetails : {};
    const normalizedCustomerLocationDetails = normalizeCustomerLocationDetails(
      customerLocationDetails && typeof customerLocationDetails === "object"
        ? customerLocationDetails
        : rawDetails.customerLocationDetails
    );
    const normalizedCustomerLocation = cleanText(
      customerLocation || rawDetails.customerLocation || formatCustomerLocation(normalizedCustomerLocationDetails),
      500
    );
    const details = {
      ...rawDetails,
      fullName: cleanText(rawDetails.fullName || req.user?.name, 120),
      phone: cleanText(rawDetails.phone || req.user?.phone, 40),
      email: cleanText(rawDetails.email || req.user?.email, 160).toLowerCase(),
      customerLocation: normalizedCustomerLocation,
      customerLocationDetails: normalizedCustomerLocationDetails,
      specialRequests: cleanText(rawDetails.specialRequests, 1000),
      customResponses: Array.isArray(rawDetails.customResponses)
        ? rawDetails.customResponses.slice(0, 80).map((item) => ({
            fieldId: cleanText(item?.fieldId, 100),
            label: cleanText(item?.label, 150),
            type: cleanText(item?.type, 30),
            value: typeof item?.value === "string" ? cleanText(item.value, 1000) : item?.value,
          }))
        : [],
    };

    const pinCheck = assertCustomerMapPin(normalizedCustomerLocationDetails);
    if (!pinCheck.ok) {
      return res.status(400).json({ message: pinCheck.message });
    }
    if (!details.customerLocation) {
      details.customerLocation = formatCustomerLocation(normalizedCustomerLocationDetails);
    }

    if (!details.fullName) {
      return res.status(400).json({ message: "Full name is required." });
    }
    if (!/^\+[1-9]\d{7,14}$/.test(String(details.phone || "").replace(/[\s-]/g, "")) &&
        !/^\+?[0-9][0-9\s-]{7,18}$/.test(details.phone)) {
      return res.status(400).json({ message: "A valid phone number is required." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email)) {
      return res.status(400).json({ message: "A valid email is required." });
    }

    const resolvedDestinationPlace = String(
      destinationPlace || details.vehicleType || details.serviceName || "Car rental booking"
    ).trim();
    const resolvedDestinationLocation = String(
      destinationLocation ||
        details.returnLocation ||
        details.pickupLocation ||
        normalizedCustomerLocationDetails.formattedAddress ||
        formatCustomerLocation(normalizedCustomerLocationDetails) ||
        "Rwanda"
    ).trim();

    if (!resolvedDestinationPlace) {
      return res.status(400).json({
        message: "Booking destination/service title is required.",
      });
    }

    const bookingPeople = Math.max(1, Math.floor(Number(numberOfPeople || rawDetails.numberOfPeople || guests || 1)));
    const bookingQuantity = Math.max(1, Math.floor(Number(quantity || rawDetails.quantity || 1)));
    const totalConsumptionUnits = bookingPeople * bookingQuantity;
    details.numberOfPeople = bookingPeople;
    details.quantity = bookingQuantity;
    details.totalConsumptionUnits = totalConsumptionUnits;
    let preferredHotelId = null;
    let selectedBusiness = null;
    let anonymousBusinessName = "";
    let promotionSnapshot = null;
    if (hotelId) {
      const hotel = await Hotel.findOne({
        _id: hotelId,
        approvalStatus: "approved",
        status: "available",
      });
      if (!hotel) {
        return res.status(404).json({
          message: "This service is currently marked unavailable by the seller or admin.",
        });
      }
      preferredHotelId = hotel._id;
      selectedBusiness = hotel;

      // Admin-defined booking fields drive required/optional validation per category.
      let bookingSchema = Array.isArray(hotel.schemaSnapshot?.bookingFieldSchema)
        ? hotel.schemaSnapshot.bookingFieldSchema
        : [];
      if (!bookingSchema.length && hotel.categoryId) {
        const liveCategory = await ServiceCategory.findById(hotel.categoryId)
          .select("bookingFieldSchema")
          .lean();
        bookingSchema = liveCategory?.bookingFieldSchema || [];
      }
      const bookingAttrs = validateAttributesAgainstSchema(
        req.body.bookingAttributes || rawDetails.bookingAttributes || {},
        bookingSchema,
        { label: "bookingAttributes" }
      );
      if (!bookingAttrs.ok) {
        return res.status(400).json({
          message: bookingAttrs.message,
          errors: bookingAttrs.errors,
          code: "BOOKING_ATTRIBUTES_INVALID",
        });
      }
      details.bookingAttributes = bookingAttrs.attributes;

      const now = new Date();
      const promotion = getActivePromotion(hotel.promotion, now);
      if (promotion) {
        promotionSnapshot = {
          title: promotion.title,
          description: promotion.note,
          note: promotion.note,
          percent: promotion.percent,
          startAt: promotion.startAt,
          endAt: promotion.endAt,
          appliedAt: now,
        };
      }
      const categoryPosition = await Hotel.countDocuments({
        type: hotel.type,
        approvalStatus: "approved",
        _id: { $lte: hotel._id },
      });
      anonymousBusinessName = createGuestName(hotel.type, categoryPosition || 1);
    }

    const normalizedBookingDateValue =
      bookingDate ||
      req.body.startDate ||
      rawDetails.bookingDate ||
      rawDetails.startDate ||
      checkIn;
    const normalizedEndBookingDateValue =
      endBookingDate ||
      req.body.endDate ||
      rawDetails.endBookingDate ||
      rawDetails.endDate ||
      checkOut;
    const normalizedStartTime = cleanText(startTime || rawDetails.startTime, 20);
    const normalizedEndTime = cleanText(endTime || rawDetails.endTime, 20);
    const setting = SiteSetting.db.readyState === 1
      ? await SiteSetting.findOne({ key: "marketplace-settings" }).lean()
      : null;
    const globalMode = ["manual", "automatic", "service-level"].includes(setting?.value?.bookingMode)
      ? setting.value.bookingMode
      : "manual";
    const effectiveMode = resolveBookingMode(globalMode, selectedBusiness?.bookingMode);

    let automaticQuote = null;
    let selectedOption = null;
    let bookingStatus = "pending";
    let paymentStatus = "unpaid";
    if (selectedBusiness) {
      selectedOption = findSelectedServiceOption(selectedBusiness, req.body, rawDetails);

      // Prefer ServiceOption collection id when frontend sends optionId.
      const requestedOptionId = String(
        req.body.optionId || rawDetails.selectedOptionId || rawDetails.optionId || ""
      ).trim();
      if (requestedOptionId && /^[a-f0-9]{24}$/i.test(requestedOptionId)) {
        const dbOption = await ServiceOption.findOne({
          _id: requestedOptionId,
          serviceId: selectedBusiness._id,
          isActive: true,
        }).lean();
        if (dbOption) {
          // Normalize weekdays (Mon → mon). Full Mon–Sun / empty = no day restriction
          // (sellers no longer configure availability days on options).
          const days = normalizeAvailableDays(dbOption.availableDays);
          const unrestrictedDays = days.length === 0 || days.length === 7;
          selectedOption = {
            id: String(dbOption._id),
            name: dbOption.name,
            price: Number(dbOption.price || 0),
            priceType: dbOption.priceType || "fixed",
            calculationField: dbOption.calculationField || "quantity",
            durationUnit: dbOption.durationUnit || "",
            maximumDuration: dbOption.maximumDuration,
            availability: Math.max(1, Number(dbOption.capacity || 1)),
            availableFrom: dbOption.availableFrom || "",
            availableTo: dbOption.availableTo || "",
            availableDays: unrestrictedDays ? "" : days.join(","),
            availableDaysList: unrestrictedDays ? [] : days,
            availableStartTime: dbOption.availableStartTime || "",
            availableEndTime: dbOption.availableEndTime || "",
            requiresTime: Boolean(dbOption.requiresTime),
            details: dbOption.details || "",
          };
        }
      }

      if (selectedBusiness.supportsOptions !== false) {
        if (!selectedOption) {
          return res.status(400).json({
            message: "Select a package/option for this service.",
            code: "OPTION_REQUIRED",
          });
        }
      } else if (!selectedOption) {
        // Option-less category: use service basePrice as the single priced offer.
        selectedOption = {
          id: "default",
          name: selectedBusiness.name || details.requestedService || "Service",
          price: Math.max(0, Number(selectedBusiness.basePrice || rawDetails.listedPriceRwf || 0)),
          priceType: "fixed",
          calculationField: "quantity",
          durationUnit: "",
          maximumDuration: 0,
          availability: Math.max(1, Number(selectedBusiness.quantityRemaining || selectedBusiness.availableQuantity || 1)),
          availableFrom: "",
          availableTo: "",
          availableDays: "",
          availableDaysList: [],
          availableStartTime: "",
          availableEndTime: "",
          requiresTime: false,
          details: "",
        };
      }
    }

    const schedule = validateBookingSchedule({
      option: selectedOption || {},
      startDate: normalizedBookingDateValue,
      endDate: normalizedEndBookingDateValue,
      startTime: normalizedStartTime,
      endTime: normalizedEndTime,
    });
    if (!schedule.ok) {
      return res.status(schedule.status).json({ message: schedule.message });
    }
    details.bookingDate = schedule.startDate;
    details.endBookingDate = schedule.endDate;
    details.startDate = schedule.startDate;
    details.endDate = schedule.endDate;
    details.startTime = schedule.startTime;
    details.endTime = schedule.endTime;
    if (selectedOption?.id) {
      details.selectedOptionId = selectedOption.id;
      details.requestedService = selectedOption.name || details.requestedService;
      details.listedPriceRwf = Number(selectedOption.price || details.listedPriceRwf || 0);
    }
    const normalizedBookingDate = new Date(`${schedule.startDate}T12:00:00Z`);
    const normalizedEndBookingDate = new Date(`${schedule.endDate}T12:00:00Z`);

    if (effectiveMode === "automatic") {
      if (!selectedBusiness) return res.status(400).json({ message: "Select a service before using automatic booking." });
      if (!isAutomaticReady(selectedBusiness, selectedOption) && selectedOption?.id !== "default") {
        return res.status(409).json({
          message: "Automatic booking is not ready for this option. The seller must add a clear price type, calculation field, duration unit, and availability.",
        });
      }
      if (!details.fullName || !/^\+?[0-9][0-9\s-]{7,18}$/.test(details.phone) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email)) {
        return res.status(400).json({ message: "Full name, a valid phone number, and a valid email are required." });
      }
      const people = bookingPeople;
      const units = bookingQuantity;
      const capacityNeeded = totalConsumptionUnits;
      const optionCapacity = Math.max(1, Number(selectedOption?.availability || 1));
      if (capacityNeeded > optionCapacity) {
        return res.status(409).json({ message: "This service is not available for the selected date, time, or quantity. Please choose another option." });
      }

      const hasAvailabilityRow = (selectedBusiness.availabilityTable?.rows || []).some(
        (row) => String(row.id) === String(selectedOption.id)
      );
      if (hasAvailabilityRow) {
        const reserved = await Hotel.findOneAndUpdate(
          {
            _id: selectedBusiness._id,
            approvalStatus: "approved",
            status: "available",
            "availabilityTable.rows": {
              $elemMatch: { id: selectedOption.id, "cells.availability": { $gte: capacityNeeded } },
            },
          },
          { $inc: { "availabilityTable.rows.$[option].cells.availability": -capacityNeeded } },
          { returnDocument: "after", arrayFilters: [{ "option.id": selectedOption.id }] }
        );
        if (!reserved) {
          return res.status(409).json({
            message:
              "This service is not available for the selected date, time, or quantity. Please choose another option.",
          });
        }
        reservedBusiness = selectedBusiness._id;
        reservedOptionId = selectedOption.id;
        reservedQuantity = capacityNeeded;
      } else {
        // Option-less / no engine row: reserve against service-level remaining quantity when present.
        const reserved = await Hotel.findOneAndUpdate(
          {
            _id: selectedBusiness._id,
            approvalStatus: "approved",
            status: "available",
            quantityRemaining: { $gte: capacityNeeded },
          },
          { $inc: { quantityRemaining: -capacityNeeded } },
          { returnDocument: "after" }
        );
        if (!reserved && Number(selectedBusiness.quantityRemaining || 0) > 0) {
          return res.status(409).json({
            message:
              "This service is not available for the selected date, time, or quantity. Please choose another option.",
          });
        }
        reservedBusiness = selectedBusiness._id;
        reservedOptionId = selectedOption.id || "default";
        reservedQuantity = capacityNeeded;
      }

      automaticQuote = {
        ...applyPromotionToQuote({
          quote: calculateQuote({ option: selectedOption, people, quantity: units }),
          promotion: selectedBusiness.promotion,
        }),
        people,
        quantity: units,
        totalConsumptionUnits,
      };
      bookingStatus = "waiting-for-payment";
      paymentStatus = "pending";
    }
    if (rebookId) {
      if (!preferredHotelId) {
        const error = new Error("Select the original service before using a Re-book ID.");
        error.status = 400;
        throw error;
      }
      rebookClaim = await claimRebookId({
        rebookId,
        customerId: req.user._id,
        serviceId: preferredHotelId,
      });
      rebookOriginalBooking = await Booking.findOne({
        _id: rebookClaim.originalBookingId,
        touristId: req.user._id,
      });
    }
    const bookingCode = prefixedCode("SCN", 10);
    const verificationCode = prefixedCode("VERIFY", 10);
    const verificationToken = secureToken([req.user._id, preferredHotelId, bookingCode]);

    const booking = await Booking.create({
      touristId: req.user._id,
      destinationPlace: resolvedDestinationPlace,
      destinationLocation: resolvedDestinationLocation,
      preferredHotelId,
      hotelId: effectiveMode === "automatic" ? preferredHotelId : null,
      checkIn: checkIn || normalizedBookingDate,
      checkOut: checkOut || normalizedEndBookingDate,
      bookingDate: normalizedBookingDate,
      endBookingDate: normalizedEndBookingDate,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      guests: Number(guests) || bookingQuantity,
      numberOfPeople: bookingPeople,
      quantity: bookingQuantity,
      totalConsumptionUnits,
      totalPrice: automaticQuote?.total || 0,
      depositPercentage: DEPOSIT_PERCENT,
      depositPercent: DEPOSIT_PERCENT,
      depositAmount: rebookOriginalBooking ? Number(automaticQuote?.total || getPaidDepositAmount(rebookOriginalBooking)) : automaticQuote?.total || 0,
      remainingBalance: 0,
      remainingAmount: 0,
      bookingCode,
      anonymousBusinessName,
      verificationCode,
      verificationToken,
      amountPaid: rebookOriginalBooking ? getPaidDepositAmount(rebookOriginalBooking) : 0,
      paymentStatus: rebookOriginalBooking ? "deposit_paid" : paymentStatus,
      detailsUnlocked: Boolean(rebookOriginalBooking),
      depositPaid: Boolean(rebookOriginalBooking),
      locationUnlocked: Boolean(rebookOriginalBooking),
      locationUnlockedAt: rebookOriginalBooking ? new Date() : null,
      refundStatus: rebookOriginalBooking ? "not_applicable" : "none",
      refundAmount: 0,
      refundReason: rebookOriginalBooking ? "Deposit transferred to successful re-booking." : "",
      refundPercentOfDeposit: 0,
      status: rebookOriginalBooking ? "provider-details-unlocked" : bookingStatus,
      bookingDetails: details,
      customerLocation: normalizedCustomerLocation,
      customerLocationDetails: normalizedCustomerLocationDetails,
      bookingMode: effectiveMode,
      sellerApproval: automaticQuote ? {
        status: "not_required",
        requestedAt: null,
      } : {
        status: selectedBusiness ? "pending" : "not_required",
        requestedAt: selectedBusiness ? new Date() : null,
      },
      serviceOptionId: selectedOption?.id || "",
      priceSnapshot: buildPriceSnapshot({
        selectedOption,
        automaticQuote,
        bookingPeople,
        bookingQuantity,
        totalConsumptionUnits,
      }),
      availabilityReservation: automaticQuote && selectedOption
        ? {
            status: "reserved",
            quantity: reservedQuantity,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          }
        : undefined,
      commissionPercentage: selectedBusiness ? resolveCommissionPercentage(selectedBusiness) : 0,
      commissionAmount: automaticQuote
        ? Math.round((Number(automaticQuote.total || 0) * resolveCommissionPercentage(selectedBusiness)) / 100)
        : 0,
      cancellation: selectedBusiness
        ? {
            policyType: "moderate",
            ...policyFromBusiness(selectedBusiness),
            cancelCommissionPercent: cancelCommissionPercentOf(resolveCommissionPercentage(selectedBusiness)),
            refundableUntil: resolveRefundableUntil(
              { bookingDate: normalizedBookingDate, checkIn: checkIn || normalizedBookingDate, bookingDetails: details },
              policyFromBusiness(selectedBusiness)
            ),
          }
        : undefined,
      paymentReason: automaticQuote?.reason || "",
      promotionSnapshot,
      isConnected: false,
      originalBookingId: rebookClaim?.originalBookingId || null,
      rebookRequestId: rebookClaim?.requestId || null,
      adminResponseMessage: automaticQuote
        ? "Your automatic quote is ready. Pay the full amount to confirm and unlock provider details."
        : selectedBusiness
          ? "Your request has been submitted successfully. Please wait for service provider approval."
          : "Your request has been submitted successfully. Please wait for admin response.",
    });
    createdBooking = booking;

    if (rebookClaim) {
      try {
        await finalizeRebookIdUse({
          ...rebookClaim,
          newBookingId: booking._id,
          actor: req.user,
        });
        rebookFinalized = true;
        await Booking.updateOne(
          { _id: rebookClaim.originalBookingId, touristId: req.user._id },
          {
            $set: {
              refundStatus: "not_applicable",
              refundAmount: 0,
              refundReason: "Deposit transferred to successful re-booking.",
              refundPercentOfDeposit: 0,
            },
          }
        );
      } catch (claimError) {
        await Booking.deleteOne({ _id: booking._id }).catch(() => {});
        createdBooking = null;
        throw claimError;
      }
    }

    if (AuditLog.db.readyState === 1) {
      await AuditLog.insertMany([
        { action: effectiveMode === "automatic" ? "automatic-booking-created" : "manual-booking-created", actorId: req.user._id, actorRole: req.user.role, bookingId: booking._id, businessId: preferredHotelId },
        ...(automaticQuote ? [
          { action: "automatic-quote-generated", actorId: req.user._id, actorRole: req.user.role, bookingId: booking._id, businessId: preferredHotelId, metadata: { total: automaticQuote.total, deposit: automaticQuote.deposit } },
          { action: "availability-reserved", actorId: req.user._id, actorRole: req.user.role, bookingId: booking._id, businessId: preferredHotelId, metadata: { optionId: selectedOption.id, quantity: reservedQuantity } },
        ] : []),
      ]);
    }

    emitUserRealtime(req.user._id, REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "created",
      bookingId: booking._id,
      touristId: req.user._id,
      hotelId: preferredHotelId,
      status: booking.status,
    });
    if (preferredHotelId) {
      emitHotelRealtime(preferredHotelId, REALTIME_EVENTS.BOOKING_CHANGED, {
        action: "booking-requested",
        bookingId: booking._id,
        businessId: preferredHotelId,
        status: booking.status,
      });
    }
    try {
      if (selectedBusiness && typeof selectedBusiness.populate === "function" && !selectedBusiness.ownerUserId?.email) {
        await selectedBusiness.populate("ownerUserId", "name email");
      }
      await notifyBookingCreated({
        booking,
        customer: req.user,
        business: selectedBusiness,
        selectedOption,
        automaticQuote,
        language: resolveLanguage(req),
      });
    } catch (emailError) {
      console.warn("Booking notification email failed:", emailError.message);
    }
    emitRealtime(REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "created",
      bookingId: booking._id,
      businessId: preferredHotelId,
      status: booking.status,
    });

    return res.status(201).json({
      message: automaticQuote ? "Automatic quote created. Your availability is reserved for 15 minutes." : "Booking request created. The service provider will review it.",
      booking,
      quote: automaticQuote,
    });
  } catch (error) {
    if (rebookClaim && !rebookFinalized) await releaseRebookIdClaim(rebookClaim).catch(() => {});
    if (createdBooking && rebookFinalized) {
      return res.status(201).json({ message: "Re-booking created successfully.", booking: createdBooking });
    }
    if (reservedBusiness && reservedOptionId && reservedQuantity) {
      await Hotel.updateOne(
        { _id: reservedBusiness },
        { $inc: { "availabilityTable.rows.$[option].cells.availability": reservedQuantity } },
        { arrayFilters: [{ "option.id": reservedOptionId }] }
      ).catch(() => {});
    }
    return res.status(error.status || 500).json({
      message: error.status ? error.message : "Failed to create booking request.",
      error: error.message,
    });
  }
};

const buildQrPayload = (booking, business, user) =>
  JSON.stringify({
    bookingId: booking._id,
    bookingCode: booking.bookingCode,
    user: { id: user?._id || booking.touristId, name: user?.name, email: user?.email },
    business: business
      ? { id: business._id, name: business.name, sellerEmail: business.sellerContactEmail || business.ownerEmail, type: business.type }
      : null,
    amount: booking.amountPaid || booking.totalPrice,
    paymentStatus: booking.paymentStatus,
    bookingStatus: booking.status,
    quantity: booking.quantity,
    verificationToken: booking.verificationToken,
    verifyUrl: buildVerifyUrl(booking.verificationToken),
  });

const paymentQr = (booking) => ({
  payload: booking.qrPayload,
  verificationCode: booking.verificationCode,
  verificationToken: booking.verificationToken,
  verifyUrl: buildVerifyUrl(booking.verificationToken),
  qrImageUrl: buildQrImageUrl(booking.verificationToken),
});

const alreadyPaidResponse = async (res, booking, message = "Payment was already recorded.") => {
  if (booking.depositPaid !== true || booking.locationUnlocked !== true || !booking.locationUnlockedAt) {
    booking.depositPaid = true;
    booking.detailsUnlocked = true;
    booking.locationUnlocked = true;
    booking.locationUnlockedAt = booking.locationUnlockedAt || new Date();
    await booking.save();
  }
  const transaction = await Transaction.findOne({ bookingId: booking._id, status: "paid" }).sort({ createdAt: -1 });
  return res.json({
    message,
    code: "PAYMENT_ALREADY_RECORDED",
    booking,
    transaction,
    qr: paymentQr(booking),
  });
};

const finalizePaidBooking = async ({ booking, business, user, amount, method, paymentReference, transaction, language = "en" }) => {
  const exactTotal = Number(booking.totalPrice || 0);
  if (!booking.bookingCode) booking.bookingCode = prefixedCode("SCN", 10);
  if (!booking.verificationCode) booking.verificationCode = prefixedCode("VERIFY", 10);
  if (!booking.verificationToken) {
    booking.verificationToken = secureToken([booking._id, booking.bookingCode, booking.touristId]);
  }

  const qrPayload = buildQrPayload(
    {
      ...booking.toObject(),
      paymentStatus: "paid",
      paymentMethod: method,
      paymentReference,
      amountPaid: amount,
      status: booking.bookingMode === "automatic" ? "provider-details-unlocked" : booking.status,
    },
    business,
    booking.touristId
  );

  const cancelPolicy = policyFromBusiness(business);
  const refundableUntil = resolveRefundableUntil(booking, cancelPolicy);

  const paidBooking = await Booking.findOneAndUpdate(
    {
      _id: booking._id,
      touristId: user._id,
      paymentStatus: { $nin: DEPOSIT_PAID_STATUSES },
    },
    {
      $set: {
        paymentStatus: "paid",
        paymentMethod: method,
        paymentReference,
        amountPaid: amount,
        depositPercent: 100,
        depositPercentage: 100,
        depositAmount: amount,
        remainingBalance: 0,
        remainingAmount: 0,
        detailsUnlocked: true,
        depositPaid: true,
        locationUnlocked: true,
        locationUnlockedAt: new Date(),
        status: booking.bookingMode === "automatic" ? "provider-details-unlocked" : booking.status,
        "availabilityReservation.status": booking.bookingMode === "automatic" ? "paid" : booking.availabilityReservation?.status,
        "cancellation.windowHours": cancelPolicy.windowHours,
        "cancellation.penaltyPercent": cancelPolicy.penaltyPercent,
        "cancellation.cancelCommissionPercent": cancelCommissionPercentOf(transaction.commissionPercentage),
        "cancellation.refundableUntil": refundableUntil,
        qrPayload,
      },
    },
    { returnDocument: "after", runValidators: true }
  ).populate("touristId", "name email");

  if (!paidBooking) return { paidBooking: null, transaction };

  transaction.status = "paid";
  transaction.collectionStatus = "success";
  transaction.commissionStatus = "collected";
  transaction.payoutStatus = "held";
  transaction.payoutMessage =
    "Full payment is held in the SafarisCon wallet until the cancellation window closes. Then the provider share is paid out automatically.";
  if (typeof transaction.save === "function") await transaction.save();

  try {
    await recordAnalyticsEvent(buildEventData({ headers: {}, user }, {
      eventType: "PAYMENT_SUCCESS",
      serviceId: business?._id,
      bookingId: paidBooking._id,
      paymentId: transaction._id,
      pageUrl: "/api/bookings/" + paidBooking._id + "/pay",
    }));
  } catch (_analyticsError) {}

  paidBooking.receipt = {
    receiptNumber: paidBooking.receipt?.receiptNumber || prefixedCode("RCT", 12),
    generatedAt: new Date(),
    contentType: "application/pdf",
    storageStatus: "pending",
  };
  await paidBooking.save();

  try {
    await storeBookingPdf({
      booking: paidBooking,
      business,
      transaction,
      createPdfReceipt,
      verifyUrl: buildVerifyUrl(paidBooking.verificationToken),
    });
  } catch (_storageError) {
    paidBooking.receipt.storageStatus = "failed";
    await paidBooking.save();
  }

  try {
    if (AuditLog.db?.readyState === 1) {
      await AuditLog.insertMany([
        { action: "payment-started", actorId: user._id, actorRole: user.role, bookingId: paidBooking._id, businessId: business?._id || null, metadata: { amount } },
        { action: "payment-successful", actorId: user._id, actorRole: user.role, bookingId: paidBooking._id, businessId: business?._id || null, metadata: { amount, paymentReference } },
        { action: "provider-details-unlocked", actorId: user._id, actorRole: user.role, bookingId: paidBooking._id, businessId: business?._id || null },
      ]);
    }
  } catch (_auditError) {}

  emitUserRealtime(user._id, REALTIME_EVENTS.BOOKING_CHANGED, {
    action: "paid",
    bookingId: paidBooking._id,
    paymentStatus: paidBooking.paymentStatus,
  });
  if (business?._id) {
    emitHotelRealtime(business._id, REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "paid",
      bookingId: paidBooking._id,
      businessId: business._id,
      paymentStatus: paidBooking.paymentStatus,
      amountPaid: paidBooking.amountPaid,
    });
  }
  emitRealtime(REALTIME_EVENTS.BOOKING_CHANGED, {
    action: "paid",
    bookingId: paidBooking._id,
    businessId: business?._id || null,
    paymentStatus: paidBooking.paymentStatus,
  });

  try {
    const customerEmail = paidBooking.touristId?.email || paidBooking.bookingDetails?.email || user?.email || "";
    if (isDeliverableEmail(customerEmail)) {
      const customerName = paidBooking.touristId?.name || paidBooking.bookingDetails?.fullName || user?.name;
      const businessName = business?.name || paidBooking.destinationPlace || "";
      await sendBookingPaidEmail({
        customerEmail,
        customerName,
        businessName,
        bookingId: paidBooking._id,
        bookingCode: paidBooking.bookingCode,
        amount: paidBooking.amountPaid || amount,
        language,
      });
      if (paidBooking.bookingCode) {
        await sendBookingCodeEmail({
          customerEmail,
          customerName,
          businessName,
          bookingCode: paidBooking.bookingCode,
          language,
        });
      }
    }
  } catch (emailError) {
    console.warn("Booking paid email failed:", emailError.message);
  }

  return { paidBooking, transaction };
};

const loadPayableBooking = async (req) => {
  const booking = await Booking.findOne({ _id: req.params.bookingId, touristId: req.user._id }).populate("touristId", "name email phone");
  if (!booking) {
    const error = new Error("Booking not found.");
    error.status = 404;
    throw error;
  }
  if (!["confirmed", "waiting-for-payment"].includes(booking.status) && !hasDepositPaid(booking)) {
    if (booking.paymentStatus === "pending") return booking;
    const error = new Error("This booking is not ready for payment.");
    error.status = 400;
    throw error;
  }
  if (
    booking.status === "confirmed" &&
    booking.paymentDeadlineAt &&
    new Date(booking.paymentDeadlineAt) <= new Date()
  ) {
    booking.status = "cancelled";
    booking.paymentStatus = "failed";
    booking.sellerApproval = {
      ...(booking.sellerApproval || {}),
      status: "expired",
    };
    await booking.save();
    const error = new Error("The payment deadline for this approved booking has expired.");
    error.status = 409;
    throw error;
  }
  if (
    booking.bookingMode === "automatic" &&
    booking.availabilityReservation?.status === "reserved" &&
    booking.availabilityReservation?.expiresAt &&
    new Date(booking.availabilityReservation.expiresAt) <= new Date()
  ) {
    await Hotel.updateOne(
      { _id: booking.hotelId || booking.preferredHotelId },
      { $inc: { "availabilityTable.rows.$[option].cells.availability": Number(booking.availabilityReservation.quantity || 0) } },
      { arrayFilters: [{ "option.id": booking.serviceOptionId }] }
    );
    booking.availabilityReservation.status = "expired";
    booking.status = "cancelled";
    booking.paymentStatus = "failed";
    await booking.save();
    const error = new Error("This automatic quote expired and its availability was released. Please make a new booking.");
    error.status = 409;
    throw error;
  }
  return booking;
};

const momoApprovalHint = (transaction = {}) => {
  const phone = transaction.customerPayment?.phone || transaction.senderAccount || "";
  const digits = String(phone || "").replace(/\D/g, "");
  const local =
    digits.length === 12 && digits.startsWith("250")
      ? `0${digits.slice(3)}`
      : digits.length === 9 && digits.startsWith("7")
        ? `0${digits}`
        : digits;
  return {
    phone,
    msisdn: transaction.customerPayment?.msisdn || "",
    ussd: /^07[23]/.test(local) ? "*182#" : "*182*7*1#",
    waitSeconds: 120,
  };
};

const pendingPaymentResponse = ({ booking, transaction, collection, split, amount, exactTotal }) => {
  const simulated = Boolean(collection?.simulated || transaction?.gatewayRaw?.simulated);
  const checkoutUrl = String(collection?.url || transaction?.checkoutUrl || "").trim() || null;
  const method = transaction.customerPayment?.method || collection?.pmethod || "momo";
  const isCard = method === "cc" && Boolean(checkoutUrl);
  const momo = simulated || isCard ? null : momoApprovalHint(transaction);
  return {
    code: simulated ? "PAYMENT_SIMULATED" : "PAYMENT_PENDING",
    message: simulated
      ? "This payment was simulated on the server. No Mobile Money prompt was sent. Put XENTRIPAY_API_KEY in the backend .env, restart the API, and tap Pay again."
      : isCard
        ? "Card payment started. Redirect the customer to checkoutUrl, then poll payment status every few seconds."
        : `Mobile Money started for ${momo.phone}. Approve the prompt on that phone. If no popup appears, dial ${momo.ussd} immediately, open Pending transactions, and confirm. Keep this screen open for about 2 minutes.`,
    simulated,
    retryAfterSeconds: simulated ? 0 : 5,
    pollForSeconds: simulated ? 0 : 120,
    momo,
    booking,
    transaction,
    collection: {
      refid: collection?.refid || transaction.collectionRef,
      tid: collection?.tid || transaction.collectionTid,
      url: isCard ? checkoutUrl : null,
      pmethod: method,
    },
    split,
    amount,
    remainingBalance: Math.max(0, exactTotal - amount),
  };
};

const payBooking = async (req, res) => {
  try {
    const booking = await loadPayableBooking(req);
    if (hasDepositPaid(booking)) {
      return alreadyPaidResponse(res, booking);
    }

    const businessId = booking.hotelId || booking.preferredHotelId;
    const business = businessId ? await Hotel.findById(businessId) : null;
    const exactTotal = Number(booking.totalPrice || 0);
    if (exactTotal <= 0) {
      return res.status(400).json({ message: "Admin must set the exact RWF quote before payment can start." });
    }

    const existing = await findLatestTransaction(booking._id);
    if (existing?.status === "paid") {
      return alreadyPaidResponse(res, booking);
    }

    const amount = exactTotal;
    const paymentDetailsResult = normalizeCustomerPaymentDetails(req.body, {
      ...req.user.toObject?.() || req.user,
      name: booking.touristId?.name || req.user.name,
      email: booking.touristId?.email || req.user.email,
      phone:
        req.body.phone ||
        req.body.cnumber ||
        req.body.senderAccount ||
        booking.bookingDetails?.phone ||
        req.user.phone,
    });
    if (!paymentDetailsResult.ok) {
      return res.status(paymentDetailsResult.status).json({ message: paymentDetailsResult.message });
    }

    let transaction = null;
    let collection = null;
    let split = null;

    if (hasAcceptedGatewayCollection(existing)) {
      try {
        const refreshed = await refreshCollection(existing);
        if (refreshed.status === "SUCCESS") {
          const settled = await finalizePaidBooking({
            booking,
            business,
            user: req.user,
            amount,
            method: paymentDetailsResult.value.paymentMethod,
            paymentReference: existing.paymentReference,
            transaction: existing,
            language: resolveLanguage(req),
          });
          if (!settled.paidBooking) return alreadyPaidResponse(res, booking);
          return res.json({
            code: "PAYMENT_SUCCESS",
            message: `Full payment collected into the SafarisCon wallet. Commission ${existing.platformAmount} RWF and provider share ${existing.providerAmount} RWF stay in the wallet until the cancellation window closes.`,
            booking: settled.paidBooking,
            transaction: settled.transaction,
            split: {
              collectedAmount: existing.amount,
              commissionPercentage: existing.commissionPercentage,
              platformAmount: existing.platformAmount,
              providerAmount: existing.providerAmount,
            },
            qr: paymentQr(settled.paidBooking),
          });
        }
        if (refreshed.status === "PENDING" && isReusablePendingCollection(existing)) {
          transaction = existing;
        } else if (refreshed.status === "PENDING") {
          await abandonStaleCollection(
            existing,
            "Replaced with a new Mobile Money request so a fresh prompt can be sent."
          );
        }
      } catch (_error) {
        if (isReusablePendingCollection(existing)) transaction = existing;
      }
    }

    if (transaction) {
      collection = {
        refid: transaction.collectionRef,
        tid: transaction.collectionTid,
        url: transaction.checkoutUrl,
      };
      split = {
        collectedAmount: transaction.amount,
        commissionPercentage: transaction.commissionPercentage,
        platformAmount: transaction.platformAmount,
        providerAmount: transaction.providerAmount,
      };
    }

    if (!transaction) {
      const started = await startCollection({
        booking,
        business,
        user: req.user,
        amount,
        paymentDetails: paymentDetailsResult.value,
        redirecturl: req.body.redirecturl || req.body.gatewayRedirectUrl,
        returl: req.body.returl || req.body.customerFinalUrl,
      });
      transaction = started.transaction;
      collection = started.collection;
      split = started.split;
    }

    booking.paymentStatus = "pending";
    booking.paymentMethod = paymentDetailsResult.value.paymentMethod;
    booking.paymentReference = transaction.paymentReference;
    await booking.save();

    const config = getXentripayConfig();
    if (config.simulateSuccess) {
      const settled = await finalizePaidBooking({
        booking,
        business,
        user: req.user,
        amount,
        method: paymentDetailsResult.value.paymentMethod,
        paymentReference: transaction.paymentReference,
        transaction,
        language: resolveLanguage(req),
      });
      if (!settled.paidBooking) return alreadyPaidResponse(res, booking);
      return res.json({
        code: "PAYMENT_SUCCESS",
        message: `Full payment collected into the SafarisCon wallet. Commission ${split.platformAmount} RWF and provider share ${split.providerAmount} RWF stay in the wallet until the cancellation window closes.`,
        booking: settled.paidBooking,
        transaction: settled.transaction,
        split,
        qr: paymentQr(settled.paidBooking),
      });
    }

    return res.json(pendingPaymentResponse({ booking, transaction, collection, split, amount, exactTotal }));
  } catch (error) {
    const mapped = toClientPaymentError(error);
    return res.status(mapped.status).json({
      code: mapped.code,
      message: mapped.message,
      error: mapped.message,
    });
  }
};

const syncBookingPayment = async (req, res) => {
  try {
    const booking = await Booking.findOne({ _id: req.params.bookingId, touristId: req.user._id }).populate("touristId", "name email");
    if (!booking) return res.status(404).json({ message: "Booking not found." });
    if (hasDepositPaid(booking)) return alreadyPaidResponse(res, booking);

    const transaction = await findLatestTransaction(booking._id);
    if (!transaction) {
      return res.status(404).json({ message: "No payment has been started for this booking." });
    }
    if (transaction.status === "paid") return alreadyPaidResponse(res, booking);
    if (transaction.status === "failed") {
      const momo = momoApprovalHint(transaction);
      return res.status(402).json({
        code: "PAYMENT_FAILED",
        message: `This Mobile Money request ended without confirmation on ${momo.phone || "the paying phone"}. Tap Pay again to send a new prompt, then dial ${momo.ussd} if no popup appears.`,
        momo,
        booking,
        transaction,
      });
    }

    if (transaction.gatewayRaw?.simulated && !getXentripayConfig().simulateSuccess) {
      return res.status(409).json({
        code: "PAYMENT_SIMULATED",
        message:
          "This payment never reached MTN/Airtel. It was created in simulation mode, so the phone will not get an approve message. Confirm XENTRIPAY_API_KEY is in the backend .env, restart the API, and tap Pay again on a new attempt.",
        simulated: true,
        retryAfterSeconds: 0,
        booking,
        transaction,
      });
    }
    if (!hasAcceptedGatewayCollection(transaction)) {
      return res.status(409).json({
        code: "PAYMENT_NOT_STARTED",
        message:
          "This booking has no live Mobile Money prompt yet. Tap Pay again after the XentriPay API key is accepted.",
        retryAfterSeconds: 0,
        booking,
        transaction,
      });
    }

    const { status } = await refreshCollection(transaction);
    const momo = momoApprovalHint(transaction);
    if (status === "FAILED") {
      booking.paymentStatus = "failed";
      await booking.save();
      return res.status(402).json({
        code: "PAYMENT_FAILED",
        message: `No confirmation was received on ${momo.phone || "the Mobile Money phone"}. If no popup appeared, dial ${momo.ussd} and check Pending, then tap Pay again to send a new request.`,
        momo,
        booking,
        transaction,
      });
    }
    if (status !== "SUCCESS") {
      return res.json({
        code: "PAYMENT_PENDING",
        message: `Waiting for confirmation on ${momo.phone}. If there is no popup, dial ${momo.ussd} now and approve the pending payment. Keep polling for about 2 minutes.`,
        simulated: Boolean(transaction.gatewayRaw?.simulated),
        retryAfterSeconds: 5,
        pollForSeconds: 120,
        momo,
        booking,
        transaction,
      });
    }

    const businessId = booking.hotelId || booking.preferredHotelId;
    const business = businessId ? await Hotel.findById(businessId) : null;
    const amount = Number(transaction.amount || booking.depositAmount || 0);
    const settled = await finalizePaidBooking({
      booking,
      business,
      user: req.user,
      amount,
      method: transaction.paymentMethod || "mobile-money",
      paymentReference: transaction.paymentReference,
      transaction,
      language: resolveLanguage(req),
    });
    if (!settled.paidBooking) return alreadyPaidResponse(res, booking);

    return res.json({
      code: "PAYMENT_SUCCESS",
      message: `Full payment collected into the SafarisCon wallet. Commission ${transaction.platformAmount} RWF and provider share ${transaction.providerAmount} RWF stay in the wallet until the cancellation window closes.`,
      booking: settled.paidBooking,
      transaction: settled.transaction,
      split: {
        collectedAmount: transaction.amount,
        commissionPercentage: transaction.commissionPercentage,
        platformAmount: transaction.platformAmount,
        providerAmount: transaction.providerAmount,
      },
      qr: paymentQr(settled.paidBooking),
    });
  } catch (error) {
    const mapped = toClientPaymentError(error);
    return res.status(mapped.status).json({
      code: mapped.code,
      message: mapped.message || "Failed to check payment status.",
    });
  }
};

const runPendingPaymentSync = async () => {
  const summary = await syncPendingCollections();
  return summary;
};

const downloadReceipt = async (req, res) => {
  try {
    const booking = await Booking.findOne({ _id: req.params.bookingId, touristId: req.user._id })
      .populate("touristId", "name email")
      .populate("hotelId", "name ownerEmail sellerContactEmail contactInfo contactDetails location type images primaryImage description");
    if (!booking) return res.status(404).json({ message: "Booking not found." });
    if (!hasDepositPaid(booking)) {
      return res.status(400).json({ message: "Receipt is available after payment is confirmed." });
    }
    if (!booking.receipt?.receiptNumber) {
      booking.receipt = {
        receiptNumber: prefixedCode("RCT", 12),
        generatedAt: new Date(),
        contentType: "application/pdf",
      };
      await booking.save();
    }
    if (booking.receipt?.cloudinaryPublicId || booking.receipt?.cloudinaryUrl) {
      return res.redirect(getBookingPdfDownloadUrl(booking.receipt));
    }
    const transaction = await Transaction.findOne({ bookingId: booking._id, status: "paid" }).sort({ createdAt: -1 });
    const pdf = await createPdfReceipt({
      booking,
      business: booking.hotelId,
      transaction,
      verifyUrl: buildVerifyUrl(booking.verificationToken),
    });
    try {
      await storeBookingPdf({
        booking,
        business: booking.hotelId,
        transaction,
        pdfBuffer: pdf,
        createPdfReceipt,
        verifyUrl: buildVerifyUrl(booking.verificationToken),
      });
    } catch (_storageError) {
      booking.receipt.storageStatus = "failed";
      await booking.save();
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${booking.receipt.receiptNumber || booking.bookingCode || "receipt"}.pdf"`
    );
    return res.send(pdf);
  } catch (error) {
    return res.status(500).json({ message: "Failed to generate receipt.", error: error.message });
  }
};

const listMyBookings = async (req, res) => {
  try {
    const missingSecureFields = await Booking.find({
      touristId: req.user._id,
      paymentStatus: { $in: DEPOSIT_PAID_STATUSES },
      $or: [
        { bookingCode: "" },
        { verificationCode: "" },
        { verificationToken: "" },
        { verificationToken: { $exists: false } },
      ],
    });

    for (const booking of missingSecureFields) {
      if (!booking.bookingCode) booking.bookingCode = prefixedCode("SCN", 10);
      if (!booking.verificationCode) booking.verificationCode = prefixedCode("VERIFY", 10);
      if (!booking.verificationToken) {
        booking.verificationToken = secureToken([booking._id, booking.bookingCode, booking.touristId]);
      }
      await booking.save();
    }

    const bookings = await Booking.find({ touristId: req.user._id })
      .populate("touristId", "name email")
      .populate("preferredHotelId", "name type location locationDetails serviceLocation contactInfo contactDetails ownerEmail sellerContactEmail images primaryImage description availabilityTable bookingRules services")
      .populate("hotelId", "name type location locationDetails serviceLocation contactInfo contactDetails ownerEmail sellerContactEmail images primaryImage description availabilityTable bookingRules services")
      .populate("roomId", "roomNumber type price status")
      .populate("tourHelpers", "name phone email")
      .sort({ createdAt: -1 });

    const customerBookings = bookings.map((bookingDocument) => {
      const booking = bookingDocument.toObject();
      const exactLocationUnlocked = locationIsUnlockedForCustomer(booking, req.user._id);
      if (hasDepositPaid(booking)) {
        const sanitizedHotel = sanitizeBusinessLocationForCustomer(booking.hotelId, booking, req.user._id);
        const sanitizedPreferred = sanitizeBusinessLocationForCustomer(booking.preferredHotelId, booking, req.user._id);
        const publicLocation = (sanitizedHotel || sanitizedPreferred)?.publicLocation || {};
        return {
          ...booking,
          depositPaid: booking.depositPaid === true,
          locationUnlocked: exactLocationUnlocked,
          detailsUnlocked: true,
          providerDetailsUnlocked: true,
          destinationLocation: exactLocationUnlocked ? booking.destinationLocation : [publicLocation.province, publicLocation.district, publicLocation.sector].filter(Boolean).join(", "),
          preferredHotelId: sanitizedPreferred,
          hotelId: sanitizedHotel,
          canCancel: canCustomerCancel(booking),
          cancellationPreview: canCustomerCancel(booking)
            ? splitCancelAmounts({
                paidAmount: booking.amountPaid || booking.totalPrice,
                penaltyPercent: booking.cancellation?.penaltyPercent,
                bookingCommissionPercent: booking.commissionPercentage,
              })
            : null,
        };
      }

      const sourceBusiness = booking.hotelId || booking.preferredHotelId;
      const anonymousName = booking.anonymousBusinessName || createGuestName(sourceBusiness?.type, 1);
      const hiddenBusiness = sourceBusiness ? buildLockedBusiness(sourceBusiness, { ...booking, anonymousBusinessName: anonymousName }) : null;

      return {
        ...booking,
        anonymousBusinessName: anonymousName,
        destinationLocation: [hiddenBusiness?.publicLocation?.province, hiddenBusiness?.district, hiddenBusiness?.sector].filter(Boolean).join(", "),
        preferredHotelId: hiddenBusiness,
        hotelId: hiddenBusiness,
        tourHelpers: [],
        detailsUnlocked: false,
        providerDetailsUnlocked: false,
        lockedDetails: {
          visible: {
            publicServiceDetails: hiddenBusiness?.description || booking.destinationPlace,
            province: hiddenBusiness?.publicLocation?.province || "",
            district: hiddenBusiness?.district || "",
            sector: hiddenBusiness?.sector || "",
            message: "Pay the full booking amount to unlock exact location and directions.",
            price: Number(booking.totalPrice || hiddenBusiness?.basePrice || 0),
            depositAmountRequired: Number(booking.depositAmount || calculateDepositAmount(booking.totalPrice, booking.depositPercent || booking.depositPercentage || DEPOSIT_PERCENT)),
          },
          hiddenUntilDeposit: ["seller phone", "exact address", "map coordinates", "direction button", "private check-in instructions"],
        },
        adminResponseMessage: booking.adminResponseMessage || (booking.status === "confirmed"
          ? "Your booking is approved. Complete payment to unlock the provider details."
          : booking.isAcknowledgedByAdmin
            ? "Admin has received your request and is reviewing it."
            : "Your request has been submitted successfully."),
      };
    });

    return res.json({ bookings: customerBookings });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch your bookings.",
      error: error.message,
    });
  }
};

const cancelBooking = async (req, res) => {
  try {
    const reason = String(req.body.cancellationReason || req.body.reason || "Customer cancelled booking.").trim().slice(0, 500);
    const booking = await Booking.findOne({
      _id: req.params.bookingId,
      touristId: req.user._id,
      status: { $nin: ["cancelled", "completed", "rejected"] },
    });
    if (!booking) return res.status(404).json({ message: "Booking not found or cannot be cancelled." });
    if (!hasDepositPaid(booking)) return res.status(409).json({ message: "This booking has not been paid yet, so there is nothing to refund." });
    if (booking.refundStatus && booking.refundStatus !== "none") {
      return res.status(409).json({ message: "This booking already has a refund decision." });
    }
    if (!canCustomerCancel(booking)) {
      return res.status(409).json({
        message: "The cancellation window has closed. The booking stays paid and the provider will receive their share.",
        refundableUntil: booking.cancellation?.refundableUntil || null,
      });
    }

    const transaction = await findLatestTransaction(booking._id);
    if (transaction && ["pending", "successful"].includes(transaction.payoutStatus) && transaction.payoutReference) {
      return res.status(409).json({ message: "The provider payout has already started, so this booking can no longer be cancelled." });
    }

    const result = await applyCustomerCancellation({ booking, reason });

    try {
      const customerEmail = result.booking.bookingDetails?.email || req.user?.email || "";
      if (isDeliverableEmail(customerEmail)) {
        await sendBookingCancelledEmail({
          customerEmail,
          customerName: result.booking.bookingDetails?.fullName || req.user?.name,
          businessName: result.booking.destinationPlace || "",
          bookingId: result.booking._id,
          refundAmount: result.split?.refundAmount,
          penaltyAmount: result.split?.penaltyAmount,
          language: resolveLanguage(req),
        });
      }
    } catch (emailError) {
      console.warn("Booking cancelled email failed:", emailError.message);
    }

    if (AuditLog.db.readyState === 1) {
      await AuditLog.create({
        action: "booking-cancel-refund-approved",
        actorId: req.user._id,
        actorRole: req.user.role,
        bookingId: result.booking._id,
        businessId: result.booking.hotelId || result.booking.preferredHotelId || null,
        metadata: result.split,
      });
    }

    emitUserRealtime(req.user._id, REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "cancelled",
      bookingId: result.booking._id,
      refundAmount: result.booking.refundAmount,
    });
    if (result.booking.hotelId || result.booking.preferredHotelId) {
      emitHotelRealtime(result.booking.hotelId || result.booking.preferredHotelId, REALTIME_EVENTS.BOOKING_CHANGED, {
        action: "cancelled",
        bookingId: result.booking._id,
        refundAmount: result.booking.refundAmount,
      });
    }

    return res.json({
      message: `Booking cancelled. ${result.split.refundAmount.toLocaleString()} RWF will be returned to you. ${result.split.penaltyAmount.toLocaleString()} RWF stays as the cancellation fee (${result.split.cancelCommissionPercent}% of that fee is SafarisCon commission, the rest goes to the provider).`,
      booking: result.booking,
      split: result.split,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to cancel booking.", error: error.message });
  }
};

const runReleasedProviderPayouts = async ({ now = new Date() } = {}) => {
  const summary = { checked: 0, paidOut: 0, skipped: 0, failed: 0 };
  const bookings = await Booking.find({
    paymentStatus: { $in: DEPOSIT_PAID_STATUSES },
    status: { $nin: ["cancelled", "completed", "rejected"] },
    "cancellation.refundableUntil": { $lte: now },
  }).limit(50);

  for (const booking of bookings) {
    summary.checked += 1;
    const transaction = await findLatestTransaction(booking._id);
    if (!transaction || transaction.status !== "paid") {
      summary.skipped += 1;
      continue;
    }
    if (!["held", "none", "failed"].includes(transaction.payoutStatus)) {
      summary.skipped += 1;
      continue;
    }
    const businessId = booking.hotelId || booking.preferredHotelId;
    const business = businessId ? await Hotel.findById(businessId) : null;
    try {
      await startProviderPayout(transaction, business);
      summary.paidOut += 1;
    } catch (_error) {
      summary.failed += 1;
    }
  }
  return summary;
};

const runBookingNoActionRefundCleanup = async () => ({ noActionRefunded: 0 });

module.exports = {
  createBookingRequest,
  listMyBookings,
  payBooking,
  syncBookingPayment,
  cancelBooking,
  downloadReceipt,
  runBookingNoActionRefundCleanup,
  runReleasedProviderPayouts,
  runPendingPaymentSync,
  calculateDepositAmount,
  calculateRefundAmount,
  hasDepositPaid,
};
