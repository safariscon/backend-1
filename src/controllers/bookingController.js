const Booking = require("../models/Booking");
const Hotel = require("../models/Hotel");
const Transaction = require("../models/Transaction");
const { REALTIME_EVENTS, emitUserRealtime } = require("../utils/realtime");
const { prefixedCode, secureToken } = require("../utils/secureIds");

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
    } = req.body;

    if (!destinationPlace || !destinationLocation) {
      return res.status(400).json({
        message: "destinationPlace and destinationLocation are required.",
      });
    }

    let preferredHotelId = null;
    if (hotelId) {
      const hotel = await Hotel.findById(hotelId);
      if (!hotel) {
        return res.status(404).json({ message: "Preferred hotel not found." });
      }
      preferredHotelId = hotel._id;
    }
    const bookingQuantity = Math.max(1, Number(quantity || guests || 1));
    const bookingCode = prefixedCode("SCN", 10);
    const verificationCode = prefixedCode("VERIFY", 10);
    const verificationToken = secureToken([req.user._id, preferredHotelId, bookingCode]);

    const booking = await Booking.create({
      touristId: req.user._id,
      destinationPlace: destinationPlace.trim(),
      destinationLocation: destinationLocation.trim(),
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
    verifyUrl: `${process.env.PUBLIC_API_URL || ""}/api/verify/${booking.verificationToken}`,
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

    const business = booking.hotelId ? await Hotel.findById(booking.hotelId) : null;
    const amount = Number(booking.totalPrice || business?.basePrice || 0);
    const commissionAmount = Math.round(amount * Number(process.env.PLATFORM_COMMISSION_RATE || 0.12) * 100) / 100;
    const paymentReference = prefixedCode("PAY", 14);

    booking.paymentStatus = "paid";
    booking.paymentMethod = method;
    booking.paymentReference = paymentReference;
    booking.amountPaid = amount;
    booking.qrPayload = buildQrPayload(booking, business, booking.touristId);
    await booking.save();

    const transaction = await Transaction.create({
      transactionId: prefixedCode("TXN", 14),
      bookingId: booking._id,
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

    emitUserRealtime(req.user._id, REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "paid",
      bookingId: booking._id,
      paymentStatus: booking.paymentStatus,
    });

    return res.json({
      message: "Payment recorded successfully.",
      booking,
      transaction,
      qr: {
        payload: booking.qrPayload,
        verificationCode: booking.verificationCode,
        verificationToken: booking.verificationToken,
        verifyUrl: `/verify/${booking.verificationToken}`,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Payment failed.", error: error.message });
  }
};

const receiptHtml = (booking, business) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${booking.bookingCode} receipt</title>
<style>body{font-family:Arial,sans-serif;color:#111827;margin:40px}.ticket{border:1px solid #d1d5db;border-radius:18px;overflow:hidden;max-width:860px}.head{background:#0f766e;color:white;padding:28px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:24px}.box{border:1px solid #e5e7eb;border-radius:12px;padding:16px}.muted{color:#6b7280;font-size:12px;text-transform:uppercase}.big{font-size:24px;font-weight:800}.qr{font-family:monospace;word-break:break-all;background:#f3f4f6;padding:14px;border-radius:10px}.sig{font-family:cursive;font-size:24px}.ok{color:#047857;font-weight:800}@media print{button{display:none}}</style>
</head><body><button onclick="window.print()">Download PDF</button><section class="ticket"><div class="head"><div class="muted" style="color:#ccfbf1">SafarisCon Marketplace</div><div class="big">Booking Receipt</div><p>Professional reservation receipt and QR verification record</p></div><div class="grid"><div class="box"><div class="muted">Booking ID</div><div class="big">${booking.bookingCode}</div><p>Status: ${booking.status}</p><p>Verification: <span class="ok">${booking.paymentStatus === "paid" ? "VERIFIED" : "PENDING"}</span></p></div><div class="box"><div class="muted">Payment</div><div class="big">${booking.amountPaid || booking.totalPrice} RWF</div><p>Method: ${booking.paymentMethod || "Pending"}</p><p>Reference: ${booking.paymentReference || "-"}</p></div><div class="box"><div class="muted">Customer</div><p>${booking.touristId?.name || "Customer"}</p><p>${booking.touristId?.email || ""}</p><p>Quantity: ${booking.quantity}</p></div><div class="box"><div class="muted">Seller / Business</div><p>${business?.name || "Pending assignment"}</p><p>${business?.sellerContactEmail || business?.ownerEmail || ""}</p><p>${business?.location || ""}</p></div><div class="box" style="grid-column:1/-1"><div class="muted">QR Verification Data</div><div class="qr">${booking.qrPayload || booking.verificationToken}</div></div><div class="box"><div class="muted">Issued</div><p>${new Date().toLocaleString()}</p></div><div class="box"><div class="muted">Admin Signature</div><div class="sig">SafarisCon Admin</div></div></div></section></body></html>`;

const downloadReceipt = async (req, res) => {
  try {
    const booking = await Booking.findOne({ _id: req.params.bookingId, touristId: req.user._id })
      .populate("touristId", "name email")
      .populate("hotelId", "name ownerEmail sellerContactEmail location type");
    if (!booking) return res.status(404).json({ message: "Booking not found." });
    if (booking.paymentStatus !== "paid") {
      return res.status(400).json({ message: "Receipt is available after successful payment." });
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(receiptHtml(booking, booking.hotelId));
  } catch (error) {
    return res.status(500).json({ message: "Failed to generate receipt.", error: error.message });
  }
};

const listMyBookings = async (req, res) => {
  try {
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
