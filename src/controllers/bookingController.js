const Booking = require("../models/Booking");
const Hotel = require("../models/Hotel");
const Transaction = require("../models/Transaction");
const { REALTIME_EVENTS, emitRealtime, emitUserRealtime } = require("../utils/realtime");
const { prefixedCode, secureToken } = require("../utils/secureIds");
const { createPdfReceipt } = require("../utils/pdfReceipt");

const publicFrontendUrl = () =>
  String(process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");

const buildVerifyUrl = (token) => `${publicFrontendUrl()}/verify/${encodeURIComponent(token)}`;

const buildQrImageUrl = (token) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=12&data=${encodeURIComponent(
    buildVerifyUrl(token)
  )}`;

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const createBookingRequest = async (req, res) => {
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
    } = req.body;

    const details = bookingDetails && typeof bookingDetails === "object" ? bookingDetails : {};
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
    if (hotelId) {
      const hotel = await Hotel.findOne({
        _id: hotelId,
        approvalStatus: "approved",
        status: "available",
        quantityRemaining: { $gte: bookingQuantity },
      });
      if (!hotel) {
        return res.status(404).json({
          message: "This business is unavailable or does not have enough inventory for that quantity.",
        });
      }
      preferredHotelId = hotel._id;
    }
    const bookingCode = prefixedCode("SCN", 10);
    const verificationCode = prefixedCode("VERIFY", 10);
    const verificationToken = secureToken([req.user._id, preferredHotelId, bookingCode]);

    const booking = await Booking.create({
      touristId: req.user._id,
      destinationPlace: resolvedDestinationPlace,
      destinationLocation: resolvedDestinationLocation,
      preferredHotelId,
      checkIn: checkIn || null,
      checkOut: checkOut || null,
      guests: Number(guests) || bookingQuantity,
      quantity: bookingQuantity,
      totalPrice: Number(totalPrice) || 0,
      bookingCode,
      verificationCode,
      verificationToken,
      paymentStatus: "unpaid",
      status: "pending",
      bookingDetails: details,
      isConnected: false,
      adminResponseMessage:
        "Your request has been submitted successfully. Please wait for admin response.",
    });

    emitUserRealtime(req.user._id, REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "created",
      bookingId: booking._id,
      touristId: req.user._id,
      hotelId: preferredHotelId,
      status: booking.status,
    });

    return res.status(201).json({
      message: "Booking request created.",
      booking,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to create booking request.",
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
    if (booking.status !== "confirmed") {
      return res.status(400).json({ message: "Booking must be approved by admin before payment." });
    }
    if (booking.paymentStatus === "paid") {
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

    const business = booking.hotelId ? await Hotel.findById(booking.hotelId) : null;
    const amount = Number(booking.totalPrice || business?.basePrice || 0);
    const commissionAmount = Math.round(amount * Number(process.env.PLATFORM_COMMISSION_RATE || 0.12) * 100) / 100;
    const paymentReference = prefixedCode("PAY", 14);
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
      },
      business,
      booking.touristId
    );
    const paidBooking = await Booking.findOneAndUpdate(
      {
        _id: booking._id,
        touristId: req.user._id,
        paymentStatus: { $ne: "paid" },
      },
      {
        $set: {
          paymentStatus: "paid",
          paymentMethod: method,
          paymentReference,
          amountPaid: amount,
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
      sellerEarnings: Math.max(0, amount - commissionAmount),
      paymentMethod: method,
      senderAccount,
      receiverAccount: business?.sellerContactEmail || business?.ownerEmail || "SafarisCon Platform",
      paymentReference,
      status: "paid",
    });

    paidBooking.receipt = {
      receiptNumber: paidBooking.receipt?.receiptNumber || prefixedCode("RCT", 12),
      generatedAt: new Date(),
      contentType: "application/pdf",
    };
    await paidBooking.save();

    emitUserRealtime(req.user._id, REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "paid",
      bookingId: paidBooking._id,
      paymentStatus: paidBooking.paymentStatus,
    });
    emitRealtime(REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "paid",
      bookingId: paidBooking._id,
      businessId: business?._id || null,
      paymentStatus: paidBooking.paymentStatus,
    });

    return res.json({
      message: "Payment recorded successfully.",
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

const receiptHtml = (booking, business) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(booking.bookingCode)} receipt</title>
<style>body{font-family:Arial,sans-serif;color:#111827;margin:40px}.ticket{border:1px solid #d1d5db;border-radius:18px;overflow:hidden;max-width:900px}.head{background:#0f766e;color:white;padding:28px}.brand{font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#ccfbf1}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:24px}.box{border:1px solid #e5e7eb;border-radius:12px;padding:16px}.muted{color:#6b7280;font-size:12px;text-transform:uppercase}.big{font-size:24px;font-weight:800}.qr{font-family:monospace;word-break:break-all;background:#f3f4f6;padding:14px;border-radius:10px}.sig{font-family:cursive;font-size:24px}.ok{color:#047857;font-weight:800}.qrimg{width:180px;height:180px}@media print{button{display:none}body{margin:12px}.ticket{max-width:none}}</style>
</head><body><button onclick="window.print()">Download PDF</button><section class="ticket"><div class="head"><div class="brand">SafarisCon Marketplace</div><div class="big">Booking Receipt</div><p>Professional reservation receipt and QR verification record</p></div><div class="grid"><div class="box"><div class="muted">Booking ID</div><div class="big">${escapeHtml(booking.bookingCode)}</div><p>Status: ${escapeHtml(booking.status)}</p><p>Verification: <span class="ok">${booking.paymentStatus === "paid" ? "VERIFIED" : "PENDING"}</span></p></div><div class="box"><div class="muted">Payment</div><div class="big">${escapeHtml(booking.amountPaid || booking.totalPrice)} RWF</div><p>Method: ${escapeHtml(booking.paymentMethod || "Pending")}</p><p>Reference: ${escapeHtml(booking.paymentReference || "-")}</p></div><div class="box"><div class="muted">Customer</div><p>${escapeHtml(booking.touristId?.name || "Customer")}</p><p>${escapeHtml(booking.touristId?.email || "")}</p><p>Quantity: ${escapeHtml(booking.quantity)}</p></div><div class="box"><div class="muted">Seller / Business</div><p>${escapeHtml(business?.name || "Pending assignment")}</p><p>${escapeHtml(business?.sellerContactEmail || business?.ownerEmail || "")}</p><p>${escapeHtml(business?.location || "")}</p></div><div class="box"><div class="muted">Scan QR</div><img class="qrimg" alt="Booking verification QR code" src="${buildQrImageUrl(booking.verificationToken)}"><p><a href="${buildVerifyUrl(booking.verificationToken)}">${buildVerifyUrl(booking.verificationToken)}</a></p></div><div class="box"><div class="muted">Admin Signature</div><div class="sig">SafarisCon Admin</div><p>${escapeHtml(new Date().toLocaleString())}</p></div><div class="box" style="grid-column:1/-1"><div class="muted">QR Verification Data</div><div class="qr">${escapeHtml(booking.qrPayload || booking.verificationToken)}</div></div></div></section></body></html>`;

const downloadReceipt = async (req, res) => {
  try {
    const booking = await Booking.findOne({ _id: req.params.bookingId, touristId: req.user._id })
      .populate("touristId", "name email")
      .populate("hotelId", "name ownerEmail sellerContactEmail location type");
    if (!booking) return res.status(404).json({ message: "Booking not found." });
    if (booking.paymentStatus !== "paid") {
      return res.status(400).json({ message: "Receipt is available after successful payment." });
    }
    if (!booking.receipt?.receiptNumber) {
      booking.receipt = {
        receiptNumber: prefixedCode("RCT", 12),
        generatedAt: new Date(),
        contentType: "application/pdf",
      };
      await booking.save();
    }
    const transaction = await Transaction.findOne({ bookingId: booking._id, status: "paid" }).sort({ createdAt: -1 });
    const pdf = createPdfReceipt({
      booking,
      business: booking.hotelId,
      transaction,
      verifyUrl: buildVerifyUrl(booking.verificationToken),
    });
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
      paymentStatus: "paid",
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
      .populate("preferredHotelId", "name location basePrice")
      .populate("hotelId", "name location basePrice sellerContactEmail")
      .populate("roomId", "roomNumber type price status")
      .populate("tourHelpers", "name phone email")
      .sort({ createdAt: -1 });

    return res.json({ bookings });
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
