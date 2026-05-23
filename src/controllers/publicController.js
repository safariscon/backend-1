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

    const hotels = await Business.find({ verificationStatus: { $ne: "rejected" } })
      .select(
        "businessName name businessType type location description basePrice amenities images services verificationStatus phone email responseTime serviceCategory bookingModel pricingUnit supplierId createdAt"
      )
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const businessIds = hotels.map((hotel) => hotel._id);
    const services = await BusinessService.find({
      businessId: { $in: businessIds },
      isActive: true,
    })
      .select("businessId title name description images pricing priceText availableQuantity status location serviceType category createdAt")
      .sort({ createdAt: -1 })
      .lean();
    const servicesByBusiness = services.reduce((map, service) => {
      const key = String(service.businessId);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(service);
      return map;
    }, new Map());

    const businesses = hotels.map((hotel) => {
      const businessServices = servicesByBusiness.get(String(hotel._id)) || [];
      const primaryService = businessServices[0] || null;
      return decorateBusiness({
        ...hotel,
        primaryService,
        serviceItems: businessServices,
        businessName: primaryService?.title || primaryService?.name || hotel.businessName,
        name: primaryService?.title || primaryService?.name || hotel.name,
        description: primaryService?.description || hotel.description,
        images: primaryService?.images?.length ? primaryService.images : hotel.images,
        priceText: primaryService?.priceText || "",
        availableInventory: primaryService?.availableQuantity ?? hotel.availableInventory,
      });
    });
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
      ? { businessId: req.params.hotelId, isActive: true }
      : { isActive: true };
    const cacheKey = `public:services:${req.params.hotelId || "all"}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const services = await BusinessService.find(filter)
      .select("businessId hotelId serviceType category title name description images pricing priceText availableQuantity status location rules cancellationPolicy priceModel availabilitySchedule bookingIntegration")
      .sort({ category: 1, title: 1 })
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
