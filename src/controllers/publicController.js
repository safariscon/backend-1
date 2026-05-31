const Hotel = require("../models/Hotel");
const HotelService = require("../models/HotelService");
const Supplier = require("../models/Supplier");
const Booking = require("../models/Booking");
const Transaction = require("../models/Transaction");
const SiteSetting = require("../models/SiteSetting");
const { getCache, setCache } = require("../utils/cache");
const { createPdfReceipt } = require("../utils/pdfReceipt");

const publicFrontendUrl = () =>
  String(process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || "https://safariscon.vercel.app").replace(/\/+$/, "");

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

const listPublicHotels = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 60));
    const cacheKey = `public:hotels:${page}:${limit}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const hotels = await Hotel.find({
      $and: [
        { approvalStatus: { $ne: "rejected" } },
        {
          $or: [
            { approvalStatus: "approved" },
            { approvalStatus: { $exists: false } },
          ],
        },
      ],
    })
      .select(
        "name type location description basePrice priceText amenities images services starRating hotelType bookingRules supplierId approvalStatus status availableQuantity quantityRemaining inventoryStatus availabilityTable bookingForm contactInfo createdAt updatedAt"
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
      .select("hotelId category name description priceModel availabilitySchedule bookingIntegration images availabilityTable inventoryStatus updatedAt")
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

    const verified = booking.paymentStatus === "paid" && ["confirmed", "completed"].includes(booking.status);
    return res.json({
      verified,
      result: verified ? "VERIFIED" : booking.paymentStatus === "paid" ? "INVALID" : "PENDING",
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
        verifyUrl: buildVerifyUrl(booking.verificationToken),
        qrImageUrl: buildQrImageUrl(booking.verificationToken),
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
    if (!booking.receipt?.receiptNumber) {
      booking.receipt = {
        receiptNumber: `RCT-${String(booking._id).slice(-8).toUpperCase()}`,
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
    res.setHeader("Content-Disposition", `inline; filename="${booking.receipt.receiptNumber}.pdf"`);
    return res.send(pdf);
  } catch (error) {
    return res.status(500).send(`Receipt failed: ${error.message}`);
  }
};

const getAnnouncement = async (_req, res) => {
  try {
    const setting = await SiteSetting.findOne({ key: "announcement" }).lean();
    const value = setting?.value || {};
    return res.json({
      announcement: {
        enabled: value.enabled !== false,
        text:
          value.text ||
          "Umwaka wa mituweli 2026/2027 watangiye. Ishyurira umuryango wawe hano",
        linkUrl: value.linkUrl || "",
        linkLabel: value.linkLabel || "",
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch announcement.", error: error.message });
  }
};

module.exports = {
  listPublicHotels,
  listMarketplaceSuppliers,
  listHotelServices,
  verifyBooking,
  publicReceipt,
  getAnnouncement,
};
