const Hotel = require("../models/Hotel");
const HotelService = require("../models/HotelService");
const Supplier = require("../models/Supplier");
const Booking = require("../models/Booking");
const Transaction = require("../models/Transaction");
const SiteSetting = require("../models/SiteSetting");
const { getCache, setCache } = require("../utils/cache");
const { createPdfReceipt } = require("../utils/pdfReceipt");
const { anonymizeBusinessList, createGuestName } = require("../utils/anonymousBusiness");
const QRCode = require("qrcode");
const { storeBookingPdf, getBookingPdfDownloadUrl } = require("../services/bookingPdfStorage");

const publicFrontendUrl = () =>
  String(process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || "https://safariscon.vercel.app").replace(/\/+$/, "");

const buildVerifyUrl = (token) => `${publicFrontendUrl()}/verify/${encodeURIComponent(token)}`;

const buildQrImageUrl = (token) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=12&data=${encodeURIComponent(
    buildVerifyUrl(token)
  )}`;

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
        "type location locationDetails images promotion bookingRules bookingMode availabilityTable bookingForm approvalStatus status availableQuantity quantityRemaining inventoryStatus createdAt updatedAt"
      )
      .sort({ type: 1, createdAt: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const anonymousHotels = anonymizeBusinessList(hotels).sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );
    const payload = {
      hotels: anonymousHotels,
      businesses: anonymousHotels,
      page,
      limit,
      hasMore: anonymousHotels.length === limit,
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
      .select("category supplierType pricing verificationStatus createdAt")
      .sort({ category: 1, supplierType: 1, createdAt: 1 })
      .lean();

    const payload = {
      suppliers: anonymizeBusinessList(suppliers.map((supplier) => ({
        ...supplier,
        type: supplier.supplierType || supplier.category || "service",
        basePrice: supplier.pricing?.baseAmount || 0,
        approvalStatus: supplier.verificationStatus,
      }))),
    };
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
      .select("hotelId category priceModel availabilitySchedule bookingIntegration inventoryStatus updatedAt")
      .sort({ category: 1, name: 1 })
      .lean();

    const categoryCounters = new Map();
    const payload = {
      services: services.map((service) => {
        const key = service.category || "service";
        const position = (categoryCounters.get(key) || 0) + 1;
        categoryCounters.set(key, position);
        return {
          _id: service._id,
          hotelId: service.hotelId,
          category: service.category,
          name: createGuestName(service.category, position),
          description: "Provider identity and exact details unlock after the confirmed 30% deposit.",
          priceModel: service.priceModel,
          availabilitySchedule: service.availabilitySchedule,
          bookingIntegration: service.bookingIntegration,
          inventoryStatus: service.inventoryStatus,
          isAnonymous: true,
          updatedAt: service.updatedAt,
        };
      }),
    };
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
      .populate("hotelId", "name type location ownerEmail sellerContactEmail contactInfo contactDetails images description")
      .lean();

    if (!booking) {
      return res.status(404).json({ verified: false, result: "INVALID", message: "Invalid booking verification token." });
    }

    const verified = ["deposit-paid", "paid"].includes(booking.paymentStatus) && ["confirmed", "deposit-paid", "provider-details-unlocked", "completed"].includes(booking.status);
    return res.json({
      verified,
      result: verified ? "VERIFIED" : ["deposit-paid", "paid"].includes(booking.paymentStatus) ? "INVALID" : "PENDING",
      booking: {
        id: booking._id,
        bookingCode: booking.bookingCode,
        user: booking.touristId,
        business: verified ? booking.hotelId : null,
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
      .populate("hotelId", "name ownerEmail sellerContactEmail contactInfo contactDetails location type images description");
    if (!booking) return res.status(404).send("Receipt not found.");
    if (!["deposit-paid", "paid"].includes(booking.paymentStatus)) return res.status(400).send("Receipt is not ready.");
    if (!booking.receipt?.receiptNumber) {
      booking.receipt = {
        receiptNumber: `RCT-${String(booking._id).slice(-8).toUpperCase()}`,
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
    const disposition = req.query.print === "1" ? "inline" : "attachment";
    res.setHeader("Content-Disposition", `${disposition}; filename="Booking-${booking.bookingCode || booking.receipt.receiptNumber}.pdf"`);
    return res.send(pdf);
  } catch (error) {
    return res.status(500).send(`Receipt failed: ${error.message}`);
  }
};

const publicQr = async (req, res) => {
  try {
    const booking = await Booking.findOne({ verificationToken: req.params.token })
      .select("paymentStatus verificationToken")
      .lean();
    if (!booking || !["deposit-paid", "paid"].includes(booking.paymentStatus)) return res.status(404).send("QR code not found.");
    const image = await QRCode.toBuffer(buildVerifyUrl(booking.verificationToken), {
      type: "png",
      width: 320,
      margin: 2,
      errorCorrectionLevel: "M",
    });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=86400");
    return res.send(image);
  } catch (error) {
    return res.status(500).send(`QR generation failed: ${error.message}`);
  }
};

const getAnnouncement = async (_req, res) => {
  try {
    const setting = await SiteSetting.findOne({ key: "announcement" }).lean();
    const value = setting?.value || {};
    const legacyItem = {
      text: value.text || "Niba ushaka guhindura ururimi kanda ahanditse English",
      linkUrl: value.linkUrl || "",
      linkLabel: value.linkLabel || "",
    };
    const announcements = (Array.isArray(value.items) ? value.items : [legacyItem])
      .filter((item) => item && String(item.text || "").trim())
      .slice(0, 5)
      .map((item) => ({
        text: String(item.text || "").trim(),
        linkUrl: String(item.linkUrl || "").trim(),
        linkLabel: String(item.linkLabel || "").trim(),
      }));
    const announcement = announcements[0] || legacyItem;
    return res.json({
      announcement: { ...announcement, enabled: value.enabled !== false },
      announcements,
      enabled: value.enabled !== false,
      intervalSeconds: Math.max(
        1,
        Math.min(3600, Number(value.intervalSeconds) || Number(value.intervalMinutes) * 60 || 5)
      ),
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch announcement.", error: error.message });
  }
};

const getMarketplaceSettings = async (_req, res) => {
  try {
    const setting = await SiteSetting.findOne({ key: "marketplace-settings" }).lean();
    const value = setting?.value || {};
    return res.json({
      settings: {
        depositPercentage: 30,
        bookingMode: ["manual", "automatic", "service-level"].includes(value.bookingMode) ? value.bookingMode : "manual",
        defaultCommissionPercentage: Math.max(0, Math.min(100, Number(value.defaultCommissionPercentage) || 10)),
        bookingRules: Array.isArray(value.bookingRules)
          ? value.bookingRules.map((rule) => String(rule || "").trim()).filter(Boolean).slice(0, 20)
          : ["Provide accurate booking information.", "The remaining balance is paid according to the provider agreement."],
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch marketplace settings.", error: error.message });
  }
};

module.exports = {
  listPublicHotels,
  listMarketplaceSuppliers,
  listHotelServices,
  verifyBooking,
  publicReceipt,
  publicQr,
  getAnnouncement,
  getMarketplaceSettings,
};
