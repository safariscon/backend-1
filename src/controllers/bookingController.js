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
const {
  cleanText,
  normalizePriceOption,
  isAutomaticReady,
  resolveBookingMode,
  calculateDuration,
  calculateQuote,
} = require("../services/automaticBookingService");

const publicFrontendUrl = () =>
  String(process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || "https://safariscon.vercel.app").replace(/\/+$/, "");

const buildVerifyUrl = (token) => `${publicFrontendUrl()}/verify/${encodeURIComponent(token)}`;

const buildQrImageUrl = (token) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=12&data=${encodeURIComponent(
    buildVerifyUrl(token)
  )}`;

const createBookingRequest = async (req, res) => {
  let reservedBusiness = null;
  let reservedOptionId = "";
  let reservedQuantity = 0;
  let rebookClaim = null;
  let rebookFinalized = false;
  let createdBooking = null;
  try {
    const {
      hotelId,
      checkIn,
      checkOut,
      guests,
      quantity,
      totalPrice,
      destinationPlace,
      destinationLocation,
      bookingDetails,
      rebookId,
    } = req.body;

    const rawDetails = bookingDetails && typeof bookingDetails === "object" ? bookingDetails : {};
    const details = {
      ...rawDetails,
      fullName: cleanText(rawDetails.fullName, 120),
      phone: cleanText(rawDetails.phone, 40),
      email: cleanText(rawDetails.email, 160).toLowerCase(),
      customerLocation: cleanText(rawDetails.customerLocation, 300),
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

    const bookingQuantity = Math.max(1, Number(quantity || guests || 1));
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
      const promotion = hotel.promotion;
      const now = new Date();
      const promotionStart = promotion?.startAt ? new Date(promotion.startAt) : null;
      const promotionEnd = promotion?.endAt ? new Date(promotion.endAt) : null;
      if (
        promotion?.enabled === true &&
        promotion.title &&
        promotion.description &&
        promotionStart &&
        promotionEnd &&
        promotionStart <= now &&
        promotionEnd >= now
      ) {
        promotionSnapshot = {
          title: promotion.title,
          description: promotion.description,
          startAt: promotionStart,
          endAt: promotionEnd,
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
      if (!rawDetails.bookingDate) return res.status(400).json({ message: "Booking date is required." });
      const people = Math.max(1, Math.floor(Number(rawDetails.numberOfPeople || guests || 0)));
      const units = Math.max(1, Math.floor(Number(rawDetails.quantity || quantity || 0)));
      const duration = calculateDuration({
        startDate: rawDetails.bookingDate,
        endDate: rawDetails.endDate || rawDetails.bookingDate,
        startTime: rawDetails.startTime,
        endTime: rawDetails.endTime,
        unit: selectedOption.durationUnit,
      });
      if (selectedOption.maximumDuration > 0 && duration > selectedOption.maximumDuration) {
        return res.status(400).json({ message: `Booking duration cannot exceed ${selectedOption.maximumDuration} ${selectedOption.durationUnit}.` });
      }
      const capacityNeeded = selectedOption.priceType === "per-person" ? people : units;
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
      automaticQuote = { ...calculateQuote({ option: selectedOption, people, quantity: units, duration }), people, quantity: units, duration };
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
      checkIn: checkIn || null,
      checkOut: checkOut || null,
      guests: Number(guests) || bookingQuantity,
      quantity: bookingQuantity,
      totalPrice: automaticQuote?.total || 0,
      depositPercentage: 30,
      depositAmount: automaticQuote?.deposit || 0,
      remainingBalance: automaticQuote?.remaining || 0,
      bookingCode,
      anonymousBusinessName,
      verificationCode,
      verificationToken,
      paymentStatus,
      status: bookingStatus,
      bookingDetails: details,
      bookingMode: effectiveMode,
      serviceOptionId: selectedOption?.id || "",
      priceSnapshot: selectedOption ? {
        ...selectedOption,
        availabilityAtBooking: selectedOption.availability,
        bookingDuration: automaticQuote.duration,
        numberOfPeople: automaticQuote.people,
        quantity: automaticQuote.quantity,
        totalPrice: automaticQuote.total,
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
    emitRealtime(REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "created",
      bookingId: booking._id,
      businessId: preferredHotelId,
      status: booking.status,
    });

    return res.status(201).json({
      message: automaticQuote ? "Automatic quote created. Your availability is reserved for 15 minutes." : "Booking request created.",
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
    if (["deposit-paid", "paid"].includes(booking.paymentStatus)) {
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
    const depositPercentage = Number(booking.depositPercentage || 30);
    const amount = Number(booking.depositAmount || Math.round((exactTotal * depositPercentage) / 100));
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
        paymentStatus: "deposit-paid",
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
        paymentStatus: { $nin: ["deposit-paid", "paid"] },
      },
      {
        $set: {
          paymentStatus: "deposit-paid",
          paymentMethod: method,
          paymentReference,
          amountPaid: amount,
          depositAmount: amount,
          remainingBalance: Math.max(0, exactTotal - amount),
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
    if (!["deposit-paid", "paid"].includes(booking.paymentStatus)) {
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
      paymentStatus: { $in: ["deposit-paid", "paid"] },
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
      .populate("preferredHotelId", "name type location locationDetails contactInfo contactDetails ownerEmail sellerContactEmail images description availabilityTable bookingRules services")
      .populate("hotelId", "name type location locationDetails contactInfo contactDetails ownerEmail sellerContactEmail images description availabilityTable bookingRules services")
      .populate("roomId", "roomNumber type price status")
      .populate("tourHelpers", "name phone email")
      .sort({ createdAt: -1 });

    const customerBookings = bookings.map((bookingDocument) => {
      const booking = bookingDocument.toObject();
      if (["deposit-paid", "paid"].includes(booking.paymentStatus)) {
        return { ...booking, providerDetailsUnlocked: true };
      }

      const sourceBusiness = booking.hotelId || booking.preferredHotelId;
      const anonymousName = booking.anonymousBusinessName || createGuestName(sourceBusiness?.type, 1);
      const hiddenBusiness = sourceBusiness
        ? {
            _id: sourceBusiness._id,
            name: anonymousName,
            type: sourceBusiness.type,
            location: sourceBusiness.locationDetails?.district || "District available after seller updates location",
            isAnonymous: true,
          }
        : null;

      return {
        ...booking,
        anonymousBusinessName: anonymousName,
        preferredHotelId: hiddenBusiness,
        hotelId: hiddenBusiness,
        tourHelpers: [],
        providerDetailsUnlocked: false,
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

module.exports = {
  createBookingRequest,
  listMyBookings,
  payBooking,
  downloadReceipt,
};
