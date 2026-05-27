const Hotel = require("../models/Hotel");
const HotelService = require("../models/HotelService");
const Supplier = require("../models/Supplier");
const Booking = require("../models/Booking");
const { getCache, setCache } = require("../utils/cache");

const listPublicHotels = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 60));
    const cacheKey = `public:hotels:${page}:${limit}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const hotels = await Hotel.find({ approvalStatus: "approved", status: "available", quantityRemaining: { $gt: 0 } })
      .select(
        "name type location description basePrice priceText amenities images services starRating hotelType bookingRules supplierId approvalStatus status availableQuantity quantityRemaining ownerEmail sellerContactEmail createdAt"
      )
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const payload = {
      hotels,
      businesses: hotels,
      page,
      limit,
      hasMore: hotels.length === limit,
    };
    setCache(cacheKey, payload);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch marketplace businesses.",
      error: error.message,
    });
  }
};

const listMarketplaceSuppliers = async (_req, res) => {
  try {
    const cached = getCache("public:suppliers");
    if (cached) return res.json(cached);

    const suppliers = await Supplier.find({ verificationStatus: "verified" })
      .select("name category supplierType description address pricing verificationStatus profile")
      .sort({ createdAt: -1 })
      .lean();

    const payload = { suppliers };
    setCache("public:suppliers", payload);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch marketplace suppliers.",
      error: error.message,
    });
  }
};

const listHotelServices = async (req, res) => {
  try {
    const filter = req.params.hotelId
      ? { hotelId: req.params.hotelId, isActive: true }
      : { isActive: true };
    const cacheKey = `public:services:${req.params.hotelId || "all"}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const services = await HotelService.find(filter)
      .select("hotelId category name description priceModel availabilitySchedule bookingIntegration")
      .sort({ category: 1, name: 1 })
      .lean();

    const payload = { services };
    setCache(cacheKey, payload);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch hotel services.",
      error: error.message,
    });
  }
};

const verifyBooking = async (req, res) => {
  try {
    const booking = await Booking.findOne({ verificationToken: req.params.token })
      .populate("touristId", "name email")
      .populate("hotelId", "name type location ownerEmail sellerContactEmail")
      .lean();

    if (!booking) {
      return res.status(404).json({ verified: false, result: "INVALID", message: "Invalid booking verification token." });
    }

    return res.json({
      verified: booking.paymentStatus === "paid" && ["confirmed", "completed"].includes(booking.status),
      result: booking.paymentStatus === "paid" ? "VERIFIED" : "PENDING",
      booking: {
        id: booking._id,
        bookingCode: booking.bookingCode,
        user: booking.touristId,
        business: booking.hotelId,
        quantity: booking.quantity,
        paymentStatus: booking.paymentStatus,
        bookingStatus: booking.status,
        amountPaid: booking.amountPaid,
        verificationCode: booking.verificationCode,
      },
    });
  } catch (error) {
    return res.status(500).json({ verified: false, result: "INVALID", message: "Verification failed.", error: error.message });
  }
};

const publicReceipt = async (req, res) => {
  try {
    const booking = await Booking.findOne({ verificationToken: req.params.token })
      .populate("touristId", "name email")
      .populate("hotelId", "name ownerEmail sellerContactEmail location type");
    if (!booking) return res.status(404).send("Receipt not found.");
    if (booking.paymentStatus !== "paid") return res.status(400).send("Receipt is not ready.");
    const sellerEmail = booking.hotelId?.sellerContactEmail || booking.hotelId?.ownerEmail || "";
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${booking.bookingCode}</title><style>body{font-family:Arial,sans-serif;margin:40px;color:#111827}.ticket{max-width:860px;border:1px solid #d1d5db;border-radius:18px;overflow:hidden}.head{background:#0f766e;color:white;padding:28px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:24px}.box{border:1px solid #e5e7eb;border-radius:12px;padding:16px}.muted{color:#6b7280;font-size:12px;text-transform:uppercase}.big{font-size:24px;font-weight:800}.qr{font-family:monospace;word-break:break-all;background:#f3f4f6;padding:14px;border-radius:10px}.sig{font-family:cursive;font-size:24px}.ok{color:#047857;font-weight:800}@media print{button{display:none}}</style></head><body><button onclick="window.print()">Download PDF</button><section class="ticket"><div class="head"><div class="muted" style="color:#ccfbf1">SafarisCon Marketplace</div><div class="big">Booking Receipt</div><p>Airline-style reservation receipt and QR verification record</p></div><div class="grid"><div class="box"><div class="muted">Booking ID</div><div class="big">${booking.bookingCode}</div><p>Status: ${booking.status}</p><p>Verification: <span class="ok">VERIFIED</span></p></div><div class="box"><div class="muted">Payment</div><div class="big">${booking.amountPaid || booking.totalPrice} RWF</div><p>Method: ${booking.paymentMethod}</p><p>Reference: ${booking.paymentReference}</p></div><div class="box"><div class="muted">Customer</div><p>${booking.touristId?.name || "Customer"}</p><p>${booking.touristId?.email || ""}</p><p>Quantity: ${booking.quantity}</p></div><div class="box"><div class="muted">Seller / Business</div><p>${booking.hotelId?.name || "Business"}</p><p>${sellerEmail}</p><p>${booking.hotelId?.location || ""}</p></div><div class="box" style="grid-column:1/-1"><div class="muted">QR Verification Data</div><div class="qr">${booking.qrPayload || booking.verificationToken}</div></div><div class="box"><div class="muted">Issued</div><p>${new Date().toLocaleString()}</p></div><div class="box"><div class="muted">Admin Signature</div><div class="sig">SafarisCon Admin</div></div></div></section></body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (error) {
    return res.status(500).send(`Receipt failed: ${error.message}`);
  }
};

module.exports = {
  listPublicHotels,
  listMarketplaceSuppliers,
  listHotelServices,
  verifyBooking,
  publicReceipt,
};
