const Booking = require("../models/Booking");
const Hotel = require("../models/Hotel");
const Transaction = require("../models/Transaction");
const SiteSetting = require("../models/SiteSetting");
const AuditLog = require("../models/AuditLog");
const { REALTIME_EVENTS, emitHotelRealtime, emitRealtime, emitUserRealtime } = require("../utils/realtime");
const { prefixedCode, secureToken } = require("../utils/secureIds");
const { createPdfReceipt } = require("../utils/pdfReceipt");
const { createGuestName } = require("../utils/anonymousBusiness");
const { storeBookingPdf, getBookingPdfDownloadUrl } = require("../services/bookingPdfStorage");
const { buildEventData, recordAnalyticsEvent } = require("./analyticsController");
const { claimRebookId, finalizeRebookIdUse, releaseRebookIdClaim } = require("./rebookController");
const { sendServiceProviderBookingRequestEmail } = require("../utils/notify");
const {
  cleanText,
  normalizePriceOption,
  isAutomaticReady,
  resolveBookingMode,
  calculateQuote,
  applyPromotionToQuote,
  getActivePromotion,
} = require("../services/automaticBookingService");

const publicFrontendUrl = () =>
  String(process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || "https://safariscon.vercel.app").replace(/\/+$/, "");

const buildVerifyUrl = (token) => `${publicFrontendUrl()}/verify/${encodeURIComponent(token)}`;
const buildPaymentUrl = (bookingId) => `${publicFrontendUrl()}/bookings/${encodeURIComponent(bookingId)}/pay`;

const buildQrImageUrl = (token) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=12&data=${encodeURIComponent(
    buildVerifyUrl(token)
  )}`;

const DEPOSIT_PERCENT = 30;
const DEPOSIT_PAID_STATUSES = ["deposit_paid", "deposit-paid", "paid"];
const REFUND_PERCENT = Object.freeze({ cancel: 20, noAction: 15 });

const hasDepositPaid = (booking) => Boolean(booking?.detailsUnlocked) || DEPOSIT_PAID_STATUSES.includes(booking?.paymentStatus);

const locationIsUnlockedForCustomer = (booking, customerId) =>
  String(booking?.touristId?._id || booking?.touristId || "") === String(customerId || "") &&
  booking?.depositPaid === true &&
  booking?.locationUnlocked === true;

const getPublicLocation = (business = {}) => {
  const source = business.serviceLocation || business.locationDetails || {};
  return {
    country: "Rwanda",
    province: source.province || business.locationDetails?.province || "",
    district: source.district || business.locationDetails?.district || "",
    sector: source.sector || business.locationDetails?.sector || "",
    message: "Pay 30% deposit to unlock exact location and directions.",
  };
};

const getUnlockedServiceLocation = (business = {}) => {
  const source = business.serviceLocation || {};
  const contactDetails = business.contactDetails || {};
  return {
    country: "Rwanda",
    province: source.province || business.locationDetails?.province || "",
    district: source.district || business.locationDetails?.district || "",
    sector: source.sector || business.locationDetails?.sector || "",
    cell: source.cell || business.locationDetails?.cell || "",
    village: source.village || business.locationDetails?.village || "",
    fullAddress: source.fullAddress || contactDetails.exactAddress || business.location || "",
    latitude: source.latitude ?? contactDetails.latitude ?? null,
    longitude: source.longitude ?? contactDetails.longitude ?? null,
    locationSource: source.locationSource || "admin_manual",
    isExactLocationVerified: Boolean(source.isExactLocationVerified),
  };
};

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

const normalizeCustomerLocationDetails = (value = {}) => ({
  province: cleanText(value.province, 120),
  district: cleanText(value.district, 120),
  sector: cleanText(value.sector, 120),
  cell: cleanText(value.cell, 120),
  village: cleanText(value.village, 120),
});

const formatCustomerLocation = (details) =>
  [
    details.village,
    details.cell,
    details.sector,
    details.district,
    details.province,
    "Rwanda",
  ].filter(Boolean).join(", ");

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

const applyBookingRefund = async ({ booking, refundPercentOfDeposit, refundReason, cancellationReason = "", status = "cancelled", now = new Date() }) => {
  const refundAmount = calculateRefundAmount(booking, refundPercentOfDeposit);
  booking.status = status;
  booking.paymentStatus = "refunded";
  booking.refundStatus = "approved";
  booking.refundAmount = refundAmount;
  booking.refundReason = refundReason;
  booking.refundPercentOfDeposit = refundPercentOfDeposit;
  booking.cancelledAt = now;
  booking.cancellationReason = cancellationReason || refundReason;
  booking.cancellation = {
    ...(booking.cancellation || {}),
    cancelledAt: now,
    refundAmount,
  };
  return booking.save();
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
      fullName: cleanText(rawDetails.fullName, 120),
      phone: cleanText(rawDetails.phone, 40),
      email: cleanText(rawDetails.email, 160).toLowerCase(),
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
    const resolvedDestinationPlace = String(
      destinationPlace || details.vehicleType || details.serviceName || "Car rental booking"
    ).trim();
    const resolvedDestinationLocation = String(
      destinationLocation || details.returnLocation || details.pickupLocation || "Rwanda"
    ).trim();

    if (!resolvedDestinationPlace || !resolvedDestinationLocation) {
      return res.status(400).json({
        message: "Booking location details are required.",
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
    const hasCompleteCustomerLocation = [
      "province",
      "district",
      "sector",
      "cell",
      "village",
    ].every((field) => normalizedCustomerLocationDetails[field]);
    if (!hasCompleteCustomerLocation) {
      return res.status(400).json({
        message: "Customer province, district, sector, cell, and village are required.",
      });
    }
    const normalizedBookingDateValue = bookingDate || rawDetails.bookingDate || checkIn;
    const normalizedEndBookingDateValue = endBookingDate || rawDetails.endBookingDate || checkOut;
    const normalizedStartTime = cleanText(startTime || rawDetails.startTime, 20);
    const normalizedEndTime = cleanText(endTime || rawDetails.endTime, 20);
    if (!normalizedBookingDateValue || !normalizedEndBookingDateValue || !normalizedStartTime || !normalizedEndTime) {
      return res.status(400).json({
        message: "Booking date, end booking date, start time, and end time are required.",
      });
    }
    const normalizedBookingDate = new Date(normalizedBookingDateValue);
    const normalizedEndBookingDate = new Date(normalizedEndBookingDateValue);
    if (Number.isNaN(normalizedBookingDate.getTime()) || Number.isNaN(normalizedEndBookingDate.getTime())) {
      return res.status(400).json({ message: "Booking date and end booking date must be valid dates." });
    }
    if (normalizedEndBookingDate < normalizedBookingDate) {
      return res.status(400).json({ message: "End booking date cannot be before booking date." });
    }
    details.bookingDate = normalizedBookingDateValue;
    details.endBookingDate = normalizedEndBookingDateValue;
    details.startTime = normalizedStartTime;
    details.endTime = normalizedEndTime;
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
    if (effectiveMode === "automatic") {
      if (!selectedBusiness) return res.status(400).json({ message: "Select a service before using automatic booking." });
      selectedOption = (selectedBusiness.availabilityTable?.rows || [])
        .map(normalizePriceOption)
        .find((option) => option.id === rawDetails.selectedOptionId || option.name === rawDetails.requestedService);
      if (!isAutomaticReady(selectedBusiness, selectedOption)) {
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
      if (capacityNeeded > selectedOption.availability) {
        return res.status(409).json({ message: "This service is not available for the selected date, time, or quantity. Please choose another option." });
      }
      const reserved = await Hotel.findOneAndUpdate(
        {
          _id: selectedBusiness._id,
          approvalStatus: "approved",
          status: "available",
          "availabilityTable.rows": { $elemMatch: { id: selectedOption.id, "cells.availability": { $gte: capacityNeeded } } },
        },
        { $inc: { "availabilityTable.rows.$[option].cells.availability": -capacityNeeded } },
        { returnDocument: "after", arrayFilters: [{ "option.id": selectedOption.id }] }
      );
      if (!reserved) {
        return res.status(409).json({ message: "This service is not available for the selected date, time, or quantity. Please choose another option." });
      }
      reservedBusiness = selectedBusiness._id;
      reservedOptionId = selectedOption.id;
      reservedQuantity = capacityNeeded;
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
      startTime: normalizedStartTime,
      endTime: normalizedEndTime,
      guests: Number(guests) || bookingQuantity,
      numberOfPeople: bookingPeople,
      quantity: bookingQuantity,
      totalConsumptionUnits,
      totalPrice: automaticQuote?.total || 0,
      depositPercentage: DEPOSIT_PERCENT,
      depositPercent: DEPOSIT_PERCENT,
      depositAmount: rebookOriginalBooking ? getPaidDepositAmount(rebookOriginalBooking) : automaticQuote?.deposit || 0,
      remainingBalance: rebookOriginalBooking ? Math.max(0, Number(automaticQuote?.total || 0) - getPaidDepositAmount(rebookOriginalBooking)) : automaticQuote?.remaining || 0,
      remainingAmount: rebookOriginalBooking ? Math.max(0, Number(automaticQuote?.total || 0) - getPaidDepositAmount(rebookOriginalBooking)) : automaticQuote?.remaining || 0,
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
      priceSnapshot: selectedOption ? {
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
      } : null,
      availabilityReservation: selectedOption ? {
        status: "reserved",
        quantity: reservedQuantity,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      } : undefined,
      paymentReason: automaticQuote?.reason || "",
      promotionSnapshot,
      isConnected: false,
      originalBookingId: rebookClaim?.originalBookingId || null,
      rebookRequestId: rebookClaim?.requestId || null,
      adminResponseMessage: automaticQuote
        ? "Your automatic quote is ready. Pay the 30% deposit to confirm and unlock provider details."
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
    if (!automaticQuote && selectedBusiness?.ownerUserId) {
      try {
        const owner = await selectedBusiness.populate("ownerUserId", "name email");
        await sendServiceProviderBookingRequestEmail({
          serviceProviderEmail: owner.ownerUserId?.email || selectedBusiness.sellerContactEmail || selectedBusiness.ownerEmail,
          serviceProviderName: owner.ownerUserId?.name || selectedBusiness.name,
          businessName: selectedBusiness.name,
          bookingId: booking._id,
        });
      } catch (emailError) {
        console.warn("Manual booking service provider email failed:", emailError.message);
      }
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

const payBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const method = req.body.paymentMethod || "mobile-money";
    const senderAccount = String(req.body.senderAccount || req.user.email || "").trim();

    const booking = await Booking.findOne({ _id: bookingId, touristId: req.user._id }).populate("touristId", "name email");
    if (!booking) return res.status(404).json({ message: "Booking not found." });
    if (!["confirmed", "waiting-for-payment"].includes(booking.status)) {
      return res.status(400).json({ message: "This booking is not ready for payment." });
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
      return res.status(409).json({ message: "The payment deadline for this approved booking has expired." });
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
      return res.status(409).json({ message: "This automatic quote expired and its availability was released. Please make a new booking." });
    }
    if (hasDepositPaid(booking)) {
      if (booking.depositPaid !== true || booking.locationUnlocked !== true || !booking.locationUnlockedAt) {
        booking.depositPaid = true;
        booking.detailsUnlocked = true;
        booking.locationUnlocked = true;
        booking.locationUnlockedAt = booking.locationUnlockedAt || new Date();
        await booking.save();
      }
      const transaction = await Transaction.findOne({ bookingId: booking._id, status: "paid" }).sort({ createdAt: -1 });
      return res.json({
        message: "Payment was already recorded.",
        booking,
        transaction,
        qr: {
          payload: booking.qrPayload,
          verificationCode: booking.verificationCode,
          verificationToken: booking.verificationToken,
          verifyUrl: buildVerifyUrl(booking.verificationToken),
          qrImageUrl: buildQrImageUrl(booking.verificationToken),
        },
      });
    }

    const businessId = booking.hotelId || booking.preferredHotelId;
    const business = businessId ? await Hotel.findById(businessId) : null;
    const exactTotal = Number(booking.totalPrice || 0);
    if (exactTotal <= 0) {
      return res.status(400).json({ message: "Admin must set the exact RWF quote before the deposit can be paid." });
    }
    const depositPercentage = Number(booking.depositPercent || booking.depositPercentage || DEPOSIT_PERCENT);
    const amount = Number(booking.depositAmount || calculateDepositAmount(exactTotal, depositPercentage));
    const commissionAmount = Number(booking.commissionAmount || Math.round((exactTotal * Number(booking.commissionPercentage || 0)) / 100));
    const paymentReference = prefixedCode("PAY", 14);
    if (!booking.bookingCode) booking.bookingCode = prefixedCode("SCN", 10);
    if (!booking.verificationCode) booking.verificationCode = prefixedCode("VERIFY", 10);
    if (!booking.verificationToken) {
      booking.verificationToken = secureToken([booking._id, booking.bookingCode, booking.touristId]);
    }

    const qrPayload = buildQrPayload(
      {
        ...booking.toObject(),
        paymentStatus: "deposit_paid",
        paymentMethod: method,
        paymentReference,
        amountPaid: amount,
        status: booking.bookingMode === "automatic" ? "provider-details-unlocked" : booking.status,
      },
      business,
      booking.touristId
    );
    const paidBooking = await Booking.findOneAndUpdate(
      {
        _id: booking._id,
        touristId: req.user._id,
        paymentStatus: { $nin: DEPOSIT_PAID_STATUSES },
      },
      {
        $set: {
          paymentStatus: "deposit_paid",
          paymentMethod: method,
          paymentReference,
          amountPaid: amount,
          depositPercent: depositPercentage,
          depositPercentage,
          depositAmount: amount,
          remainingBalance: Math.max(0, exactTotal - amount),
          remainingAmount: Math.max(0, exactTotal - amount),
          detailsUnlocked: true,
          depositPaid: true,
          locationUnlocked: true,
          locationUnlockedAt: new Date(),
          status: booking.bookingMode === "automatic" ? "provider-details-unlocked" : booking.status,
          "availabilityReservation.status": booking.bookingMode === "automatic" ? "paid" : booking.availabilityReservation?.status,
          qrPayload,
        },
      },
      { returnDocument: "after", runValidators: true }
    ).populate("touristId", "name email");

    if (!paidBooking) {
      const transaction = await Transaction.findOne({ bookingId: booking._id, status: "paid" }).sort({ createdAt: -1 });
      return res.json({
        message: "Payment was already recorded.",
        booking,
        transaction,
        qr: {
          payload: booking.qrPayload,
          verificationCode: booking.verificationCode,
          verificationToken: booking.verificationToken,
          verifyUrl: buildVerifyUrl(booking.verificationToken),
          qrImageUrl: buildQrImageUrl(booking.verificationToken),
        },
      });
    }

    const transaction = await Transaction.create({
      transactionId: prefixedCode("TXN", 14),
      bookingId: paidBooking._id,
      userId: req.user._id,
      sellerId: business?.ownerUserId || null,
      businessId: business?._id || null,
      amount,
      commissionAmount,
      sellerEarnings: Math.max(0, exactTotal - commissionAmount),
      paymentMethod: method,
      senderAccount,
      receiverAccount: business?.payoutDetails?.accountNumber || business?.sellerContactEmail || business?.ownerEmail || "SafarisCon Platform",
      paymentReference,
      commissionStatus: "collected",
      status: "paid",
    });

    await recordAnalyticsEvent(buildEventData(req, {
      eventType: "PAYMENT_SUCCESS",
      serviceId: business?._id,
      bookingId: paidBooking._id,
      paymentId: transaction._id,
      pageUrl: "/api/bookings/" + paidBooking._id + "/pay",
    }));

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

    if (AuditLog.db.readyState === 1) {
      await AuditLog.insertMany([
        { action: "payment-started", actorId: req.user._id, actorRole: req.user.role, bookingId: paidBooking._id, businessId: business?._id || null, metadata: { amount } },
        { action: "payment-successful", actorId: req.user._id, actorRole: req.user.role, bookingId: paidBooking._id, businessId: business?._id || null, metadata: { amount, paymentReference } },
        { action: "provider-details-unlocked", actorId: req.user._id, actorRole: req.user.role, bookingId: paidBooking._id, businessId: business?._id || null },
      ]);
    }

    emitUserRealtime(req.user._id, REALTIME_EVENTS.BOOKING_CHANGED, {
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

    return res.json({
      message: `30% deposit recorded successfully. Remaining balance: ${Math.max(0, exactTotal - amount)} RWF.`,
      booking: paidBooking,
      transaction,
      qr: {
        payload: paidBooking.qrPayload,
        verificationCode: paidBooking.verificationCode,
        verificationToken: paidBooking.verificationToken,
        verifyUrl: buildVerifyUrl(paidBooking.verificationToken),
        qrImageUrl: buildQrImageUrl(paidBooking.verificationToken),
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Payment failed.", error: error.message });
  }
};

const downloadReceipt = async (req, res) => {
  try {
    const booking = await Booking.findOne({ _id: req.params.bookingId, touristId: req.user._id })
      .populate("touristId", "name email")
      .populate("hotelId", "name ownerEmail sellerContactEmail contactInfo contactDetails location type images description");
    if (!booking) return res.status(404).json({ message: "Booking not found." });
    if (!hasDepositPaid(booking)) {
      return res.status(400).json({ message: "Receipt is available after the 30% deposit is confirmed." });
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
      .populate("preferredHotelId", "name type location locationDetails serviceLocation contactInfo contactDetails ownerEmail sellerContactEmail images description availabilityTable bookingRules services")
      .populate("hotelId", "name type location locationDetails serviceLocation contactInfo contactDetails ownerEmail sellerContactEmail images description availabilityTable bookingRules services")
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
            message: "Pay 30% deposit to unlock exact location and directions.",
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
    if (!hasDepositPaid(booking)) return res.status(409).json({ message: "No paid 30% deposit is available for refund." });
    if (booking.refundStatus && booking.refundStatus !== "none") {
      return res.status(409).json({ message: "This booking already has a refund decision." });
    }

    const refundedBooking = await applyBookingRefund({
      booking,
      refundPercentOfDeposit: REFUND_PERCENT.cancel,
      refundReason: "Customer cancelled booking.",
      cancellationReason: reason,
    });

    if (AuditLog.db.readyState === 1) {
      await AuditLog.create({
        action: "booking-cancel-refund-approved",
        actorId: req.user._id,
        actorRole: req.user.role,
        bookingId: refundedBooking._id,
        businessId: refundedBooking.hotelId || refundedBooking.preferredHotelId || null,
        metadata: { refundAmount: refundedBooking.refundAmount, refundPercentOfDeposit: REFUND_PERCENT.cancel },
      });
    }

    emitUserRealtime(req.user._id, REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "cancelled",
      bookingId: refundedBooking._id,
      refundAmount: refundedBooking.refundAmount,
    });
    if (refundedBooking.hotelId || refundedBooking.preferredHotelId) {
      emitHotelRealtime(refundedBooking.hotelId || refundedBooking.preferredHotelId, REALTIME_EVENTS.BOOKING_CHANGED, {
        action: "cancelled",
        bookingId: refundedBooking._id,
        refundAmount: refundedBooking.refundAmount,
      });
    }

    return res.json({
      message: `Booking cancelled. Refund approved for ${refundedBooking.refundAmount.toLocaleString()} RWF.`,
      booking: refundedBooking,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to cancel booking.", error: error.message });
  }
};

const runBookingNoActionRefundCleanup = async ({ now = new Date() } = {}) => {
  const summary = { noActionRefunded: 0 };
  const bookings = await Booking.find({
    paymentStatus: { $in: DEPOSIT_PAID_STATUSES },
    status: { $nin: ["cancelled", "completed", "rejected"] },
    refundStatus: { $in: ["none", null] },
    originalBookingId: null,
  });

  for (const booking of bookings) {
    if (booking.refundStatus === "not_applicable" || booking.rebookRequestId) continue;
    const deadline = resolveBookingActionDeadline(booking);
    if (!deadline || deadline > now) continue;
    await applyBookingRefund({
      booking,
      refundPercentOfDeposit: REFUND_PERCENT.noAction,
      refundReason: "No customer action before the allowed time.",
      cancellationReason: "No-action refund applied automatically.",
      now,
    });
    summary.noActionRefunded += 1;
  }

  return summary;
};

module.exports = {
  createBookingRequest,
  listMyBookings,
  payBooking,
  cancelBooking,
  downloadReceipt,
  runBookingNoActionRefundCleanup,
  calculateDepositAmount,
  calculateRefundAmount,
  hasDepositPaid,
};
