const Business = require("../models/Business");
const BusinessService = require("../models/BusinessService");
const Supplier = require("../models/Supplier");
const { getCache, setCache } = require("../utils/cache");
const { decorateBusiness } = require("../utils/marketplaceTypes");

const listPublicHotels = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 60));
    const cacheKey = `public:hotels:${page}:${limit}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const hotels = await Business.find({})
      .select(
        "name type location description basePrice amenities images services starRating hotelType bookingRules supplierId createdAt"
      )
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const businesses = hotels.map(decorateBusiness);
    const payload = {
      hotels: businesses,
      businesses,
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

    const services = await BusinessService.find(filter)
      .select("hotelId category name description priceModel availabilitySchedule bookingIntegration")
      .sort({ category: 1, name: 1 })
      .lean();

    const payload = { services };
    setCache(cacheKey, payload);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch marketplace services.",
      error: error.message,
    });
  }
};

module.exports = {
  listPublicHotels,
  listMarketplaceSuppliers,
  listHotelServices,
};
