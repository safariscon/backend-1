const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const validator = require("validator");
const User = require("../models/User");
const Business = require("../models/Business");
const BusinessService = require("../models/BusinessService");
const Supplier = require("../models/Supplier");
const { generateAccessToken, generateRefreshToken, generateToken, buildUserPayload } = require("../utils/auth");
const { sendHotelCredentialsEmail } = require("../utils/notify");
const { generateRandomPassword } = require("../utils/password");
const { REALTIME_EVENTS, emitRealtime } = require("../utils/realtime");
const { getMarketplaceTypeConfig } = require("../utils/marketplaceTypes");
const { clearCache } = require("../utils/cache");

const BUSINESS_TYPE_CONFIG = {
  hotel: {
    supplierCategory: "accommodation",
    supplierType: "hotel",
    defaultUnit: "night",
  },
  "hotels-and-resorts": {
    supplierCategory: "accommodation",
    supplierType: "hotel",
    defaultUnit: "night",
  },
  "homestays-and-guesthouses": {
    supplierCategory: "accommodation",
    supplierType: "guesthouse",
    defaultUnit: "night",
  },
  "tent-rentals-and-camping-sites": {
    supplierCategory: "accommodation",
    supplierType: "camping",
    defaultUnit: "night",
  },
  "vacation-rentals-and-apartments": {
    supplierCategory: "accommodation",
    supplierType: "apartment",
    defaultUnit: "night",
  },
  "car-rentals": {
    supplierCategory: "transport",
    supplierType: "car-rental",
    defaultUnit: "day",
  },
  "motorbike-and-scooter-rentals": {
    supplierCategory: "transport",
    supplierType: "motorbike-rental",
    defaultUnit: "day",
  },
  "taxi-and-ride-services": {
    supplierCategory: "transport",
    supplierType: "taxi",
    defaultUnit: "trip",
  },
  "bus-and-minivan-charters": {
    supplierCategory: "transport",
    supplierType: "charter",
    defaultUnit: "trip",
  },
  restaurants: {
    supplierCategory: "food-beverage",
    supplierType: "restaurant",
    defaultUnit: "table",
  },
  "bars-and-pubs": {
    supplierCategory: "food-beverage",
    supplierType: "bar",
    defaultUnit: "table",
  },
  "coffee-shops-and-cafes": {
    supplierCategory: "food-beverage",
    supplierType: "cafe",
    defaultUnit: "table",
  },
  "food-trucks-and-street-food-stalls": {
    supplierCategory: "food-beverage",
    supplierType: "food-truck",
    defaultUnit: "order",
  },
  "conference-event-halls-mice": {
    supplierCategory: "experiences",
    supplierType: "venue",
    defaultUnit: "event",
  },
  "wedding-venues": {
    supplierCategory: "experiences",
    supplierType: "wedding-venue",
    defaultUnit: "event",
  },
  "tour-and-activity-operators": {
    supplierCategory: "experiences",
    supplierType: "tour-operator",
    defaultUnit: "person",
  },
  "entertainment-venues": {
    supplierCategory: "experiences",
    supplierType: "entertainment",
    defaultUnit: "ticket",
  },
  "souvenir-shops-and-craft-markets": {
    supplierCategory: "retail",
    supplierType: "souvenir-shop",
    defaultUnit: "item",
  },
  "gear-rentals": {
    supplierCategory: "retail",
    supplierType: "gear-rental",
    defaultUnit: "day",
  },
  "spas-and-wellness-centers": {
    supplierCategory: "experiences",
    supplierType: "spa",
    defaultUnit: "hour",
  },
  "childcare-services": {
    supplierCategory: "experiences",
    supplierType: "childcare",
    defaultUnit: "hour",
  },
  other: {
    supplierCategory: "retail",
    supplierType: "business",
    defaultUnit: "use",
  },
};

const normalizeBusinessType = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[ /]+/g, "-");

  if (!normalized) return "hotel";

  const aliases = {
    accommodation: "hotel",
    "hotel-accommodation": "hotel",
    hotel: "hotel",
    "hotels-and-resorts": "hotels-and-resorts",
    "hotel-and-resorts": "hotels-and-resorts",
    resorts: "hotels-and-resorts",
    "homestays-and-guesthouses": "homestays-and-guesthouses",
    homestays: "homestays-and-guesthouses",
    guesthouses: "homestays-and-guesthouses",
    "guest-houses": "homestays-and-guesthouses",
    "tent-rentals-and-camping-sites": "tent-rentals-and-camping-sites",
    camping: "tent-rentals-and-camping-sites",
    campsite: "tent-rentals-and-camping-sites",
    "vacation-rentals-and-apartments": "vacation-rentals-and-apartments",
    apartments: "vacation-rentals-and-apartments",
    rentals: "vacation-rentals-and-apartments",
    "car-rentals": "car-rentals",
    cars: "car-rentals",
    "motorbike-and-scooter-rentals": "motorbike-and-scooter-rentals",
    scooters: "motorbike-and-scooter-rentals",
    motorbikes: "motorbike-and-scooter-rentals",
    "taxi-and-ride-services": "taxi-and-ride-services",
    taxi: "taxi-and-ride-services",
    rides: "taxi-and-ride-services",
    "bus-and-minivan-charters": "bus-and-minivan-charters",
    buses: "bus-and-minivan-charters",
    minivans: "bus-and-minivan-charters",
    restaurants: "restaurants",
    restaurant: "restaurants",
    "bars-and-pubs": "bars-and-pubs",
    bars: "bars-and-pubs",
    pubs: "bars-and-pubs",
    "coffee-shops-and-cafes": "coffee-shops-and-cafes",
    cafes: "coffee-shops-and-cafes",
    "coffee-shops": "coffee-shops-and-cafes",
    "food-trucks-and-street-food-stalls": "food-trucks-and-street-food-stalls",
    "food-trucks": "food-trucks-and-street-food-stalls",
    "street-food": "food-trucks-and-street-food-stalls",
    "conference-event-halls-mice": "conference-event-halls-mice",
    "event-hall": "conference-event-halls-mice",
    hall: "conference-event-halls-mice",
    venue: "conference-event-halls-mice",
    mice: "conference-event-halls-mice",
    "wedding-venues": "wedding-venues",
    weddings: "wedding-venues",
    "tour-and-activity-operators": "tour-and-activity-operators",
    tours: "tour-and-activity-operators",
    activities: "tour-and-activity-operators",
    "entertainment-venues": "entertainment-venues",
    entertainment: "entertainment-venues",
    "souvenir-shops-and-craft-markets": "souvenir-shops-and-craft-markets",
    souvenirs: "souvenir-shops-and-craft-markets",
    crafts: "souvenir-shops-and-craft-markets",
    "gear-rentals": "gear-rentals",
    gear: "gear-rentals",
    "spas-and-wellness-centers": "spas-and-wellness-centers",
    spas: "spas-and-wellness-centers",
    wellness: "spas-and-wellness-centers",
    "childcare-services": "childcare-services",
    childcare: "childcare-services",
    other: "other",
  };

  return aliases[normalized] || "other";
};

const parseStringList = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }

  return String(value || "")
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const getServiceTypeForBusiness = (businessType, serviceCategory) => {
  const normalizedType = normalizeBusinessType(businessType);
  if (["hotel", "hotels-and-resorts", "homestays-and-guesthouses", "tent-rentals-and-camping-sites", "vacation-rentals-and-apartments"].includes(normalizedType)) return "hotel";
  if (["car-rentals", "motorbike-and-scooter-rentals"].includes(normalizedType)) return "car";
  if (["taxi-and-ride-services", "bus-and-minivan-charters"].includes(normalizedType)) return "transport";
  if (["restaurants", "bars-and-pubs", "coffee-shops-and-cafes", "food-trucks-and-street-food-stalls"].includes(normalizedType)) return "food";
  if (["conference-event-halls-mice", "wedding-venues", "entertainment-venues"].includes(normalizedType)) return "event";
  if (normalizedType === "tour-and-activity-operators") return "tour";
  if (normalizedType === "gear-rentals") return "rental";
  if (normalizedType === "spas-and-wellness-centers") return "spa";
  if (normalizedType === "childcare-services") return "childcare";
  if (serviceCategory === "shopping") return "shopping";
  return "rental";
};

const buildAuthUserPayload = async (user) => {
  const payload = buildUserPayload(user);

  if (["hotel", "supplier", "businessOwner"].includes(user.role) && user.hotelId) {
    const hotel = await Business.findById(user.hotelId).select("type businessType supplierId name businessName");
    payload.businessId = hotel?._id || user.hotelId || null;
    payload.businessType = hotel?.businessType || hotel?.type || "Other";
    payload.businessName = hotel?.businessName || hotel?.name || "";
    payload.supplierId = hotel?.supplierId || user.supplierId || null;
  } else {
    payload.businessType = null;
    payload.businessName = "";
  }

  return payload;
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "email and password are required." });
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (!validator.isEmail(normalizedEmail)) {
      return res.status(400).json({ message: "Invalid email." });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials." });
    }
    if (user.mustSetPassword) {
      return res.status(403).json({
        message:
          "Business account must complete registration first. Use business complete-registration.",
      });
    }
    if (!user.password) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    const token = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    return res.json({
      user: await buildAuthUserPayload(user),
      token,
      accessToken: token,
      refreshToken,
    });
  } catch (error) {
    return res.status(500).json({ message: "Login failed.", error: error.message });
  }
};

const registerTourist = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    const normalizedEmail = String(email || "").toLowerCase().trim();
    if (!name || !normalizedEmail || !password || !role) {
      return res
        .status(400)
        .json({ message: "name, email, password and role are required." });
    }

    if (!validator.isEmail(normalizedEmail)) {
      return res.status(400).json({ message: "Invalid email." });
    }

    if (!["tourist", "customer"].includes(role)) {
      return res
        .status(400)
        .json({ message: 'Only role "customer" can self-register.' });
    }

    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ message: "User already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: "customer",
    });

    const token = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    return res.status(201).json({
      user: await buildAuthUserPayload(user),
      token,
      accessToken: token,
      refreshToken,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Registration failed.", error: error.message });
  }
};

const registerHotelByAdmin = async (req, res) => {
  try {
    const {
      businessName,
      businessType,
      hotelName,
      location,
      description,
      ownerEmail,
      hotelEmail,
      ownerName,
    } = req.body;

    const normalizedBusinessName = (businessName || hotelName || "").trim();
    const normalizedBusinessType = normalizeBusinessType(businessType);
    const normalizedLocation = location?.trim();
    const normalizedOwnerName = (ownerName || "").trim();
    const normalizedEmail = (ownerEmail || hotelEmail || "").toLowerCase().trim();
    const normalizedDescription = (description || `${normalizedBusinessName} service provider in ${normalizedLocation || "Rwanda"}.`).trim();
    const normalizedContactInfo = normalizedEmail;
    const businessConfig =
      BUSINESS_TYPE_CONFIG[normalizedBusinessType] || BUSINESS_TYPE_CONFIG.other;
    const marketplaceConfig = getMarketplaceTypeConfig(normalizedBusinessType);

    if (
      !normalizedBusinessName ||
      !normalizedBusinessType ||
      !normalizedLocation ||
      !normalizedOwnerName ||
      !normalizedEmail
    ) {
      return res.status(400).json({
        message:
          "businessName, businessType, ownerName, ownerEmail and location are required.",
      });
    }

    if (normalizedEmail && !validator.isEmail(normalizedEmail)) {
      return res.status(400).json({ message: "Invalid email." });
    }

    if (normalizedEmail) {
      const existingOwner = await User.findOne({ email: normalizedEmail });
      if (existingOwner) {
        return res
          .status(409)
          .json({ message: "A user with this business owner email already exists." });
      }
    }

    if ((normalizedEmail && !normalizedOwnerName) || (!normalizedEmail && normalizedOwnerName)) {
      return res.status(400).json({
        message: "Owner name and owner email must be provided together.",
      });
    }

    const supplier = await Supplier.create({
      name: normalizedBusinessName,
      category: businessConfig.supplierCategory,
      supplierType: businessConfig.supplierType,
      description: normalizedDescription,
      contact: {
        email: normalizedEmail || undefined,
        phone: normalizedContactInfo || undefined,
      },
      address: {
        city: normalizedLocation,
        country: "Rwanda",
      },
      verificationStatus: "verified",
      pricing: {
        model: {
          type: "fixed",
          amount: 0,
          currency: "USD",
          unit: businessConfig.defaultUnit,
        },
      },
      commission: {
        percentage: 12,
        payoutSchedule: "monthly",
      },
    });

    const hotel = await Business.create({
      ownerId: null,
      businessName: normalizedBusinessName,
      name: normalizedBusinessName,
      email: normalizedEmail || `${supplier._id}@business.local`,
      phone: normalizedContactInfo,
      type: normalizedBusinessType,
      businessType: marketplaceConfig.businessType,
      serviceCategory: marketplaceConfig.serviceCategory,
      bookingModel: marketplaceConfig.bookingModel,
      pricingModel: marketplaceConfig.pricingModel,
      pricingUnit: marketplaceConfig.pricingUnit,
      inventoryType: marketplaceConfig.inventoryType,
      assignmentType: marketplaceConfig.assignmentType,
      location: normalizedLocation,
      description: normalizedDescription,
      basePrice: 0,
      amenities: [],
      contactInfo: normalizedContactInfo,
      images: [],
      services: [],
      supplierId: supplier._id,
      ownerEmail: normalizedEmail || `${supplier._id}@business.local`,
      verificationStatus: "pending",
    });

    supplier.hotelId = hotel._id;
    await supplier.save();

    let owner = null;
    let accessCode = "";
    if (normalizedEmail && normalizedOwnerName) {
      accessCode = generateRandomPassword(10);
      const temporaryHash = await bcrypt.hash(accessCode, 12);

      owner = await User.create({
        name: normalizedOwnerName,
        email: normalizedEmail,
        password: temporaryHash,
        role: "supplier",
        hotelId: hotel._id,
        supplierId: supplier._id,
        mustSetPassword: true,
      });

      supplier.ownerUserId = owner._id;
      hotel.ownerId = owner._id;
      await hotel.save();
      await supplier.save();

      await sendHotelCredentialsEmail({
        hotelEmail: normalizedEmail,
        hotelName: hotel.businessName || hotel.name,
        ownerName: normalizedOwnerName,
        accessCode,
      });
    }

    emitRealtime(REALTIME_EVENTS.HOTEL_CHANGED, {
      action: "created",
      hotelId: hotel._id,
      supplierId: supplier._id,
    });
    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "business-registered" });

    return res.status(201).json({
      hotel,
      business: hotel,
      ownerEmail: owner ? normalizedEmail : "",
      ownerName: owner ? normalizedOwnerName : "",
      accessCode: owner ? accessCode : "",
      onboardingCredentials: owner
        ? {
            ownerName: normalizedOwnerName,
            ownerEmail: normalizedEmail,
            accessCode,
            registrationPath: "/hotel-register",
          }
        : null,
      registrationPath: owner ? "/hotel-register" : "",
      message:
        owner
          ? "Business registered by admin. Give the owner these onboarding credentials so they can complete registration."
          : "Business registered by admin successfully.",
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Business registration failed.", error: error.message });
  }
};

const registerBusinessOwner = async (req, res) => {
  try {
    const {
      businessName,
      businessType,
      ownerName,
      email,
      phone,
      location,
      businessDescription,
      description,
      serviceName,
      serviceDescription,
      servicePrice,
      availabilityStatus,
      remainingQuantity,
      serviceImages,
      password,
      confirmPassword,
    } = req.body;

    const normalizedEmail = String(email || "").toLowerCase().trim();
    if (
      !businessName ||
      !businessType ||
      !ownerName ||
      !normalizedEmail ||
      !phone ||
      !location ||
      !(businessDescription || description) ||
      !serviceName ||
      servicePrice === undefined ||
      String(servicePrice).trim() === "" ||
      !password ||
      !confirmPassword
    ) {
      return res.status(400).json({
        message: "Please fill in all business and service registration fields.",
      });
    }

    if (!validator.isEmail(normalizedEmail)) {
      return res.status(400).json({ message: "Invalid email." });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match." });
    }

    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ message: "Email is already registered." });
    }

    const normalizedBusinessType = normalizeBusinessType(businessType);
    const marketplaceConfig = getMarketplaceTypeConfig(normalizedBusinessType);
    const normalizedServicePrice = String(servicePrice).trim();

    const serviceStatus = String(availabilityStatus || "available").trim() === "unavailable"
      ? "unavailable"
      : "available";
    const quantity = remainingQuantity === undefined || remainingQuantity === ""
      ? 1
      : Math.max(0, Number(remainingQuantity) || 0);
    const hashedPassword = await bcrypt.hash(password, 12);

    const owner = await User.create({
      name: ownerName.trim(),
      email: normalizedEmail,
      phone: String(phone).trim(),
      password: hashedPassword,
      role: "supplier",
    });

    const business = await Business.create({
      ownerId: owner._id,
      businessName: businessName.trim(),
      name: businessName.trim(),
      businessType: normalizedBusinessType,
      type: normalizedBusinessType,
      serviceCategory: marketplaceConfig.serviceCategory,
      bookingModel: marketplaceConfig.bookingModel,
      pricingModel: marketplaceConfig.pricingModel,
      pricingUnit: marketplaceConfig.pricingUnit,
      inventoryType: marketplaceConfig.inventoryType,
      assignmentType: marketplaceConfig.assignmentType,
      description: String(businessDescription || description).trim(),
      phone: String(phone).trim(),
      email: normalizedEmail,
      ownerEmail: normalizedEmail,
      location: String(location).trim(),
      verificationStatus: "pending",
      basePrice: 0,
      services: [String(serviceName).trim()],
    });

    const service = await BusinessService.create({
      businessId: business._id,
      hotelId: business._id,
      title: String(serviceName).trim(),
      name: String(serviceName).trim(),
      description: String(serviceDescription || businessDescription || description).trim(),
      serviceType: getServiceTypeForBusiness(normalizedBusinessType, marketplaceConfig.serviceCategory),
      category: marketplaceConfig.serviceCategory,
      pricing: {
        amount: 0,
        unit: marketplaceConfig.pricingUnit || "service",
        currency: "USD",
      },
      priceText: normalizedServicePrice,
      availableQuantity: quantity,
      status: serviceStatus,
      images: parseStringList(serviceImages),
      location: String(location).trim(),
      isActive: false,
    });

    owner.hotelId = business._id;
    await owner.save();

    emitRealtime(REALTIME_EVENTS.HOTEL_CHANGED, {
      action: "business-registered",
      businessId: business._id,
    });
    emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "business-self-registered" });
    clearCache("public:");

    const token = generateAccessToken(owner);
    const refreshToken = generateRefreshToken(owner);
    return res.status(201).json({
      message: "Business registered. Admin will verify it soon.",
      user: await buildAuthUserPayload(owner),
      business,
      service,
      token,
      accessToken: token,
      refreshToken,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Business registration failed.",
      error: error.message,
    });
  }
};

const completeHotelRegistration = async (req, res) => {
  try {
    const { name, email, accessCode, temporaryPassword, password } = req.body;
    const submittedAccessCode = String(accessCode || temporaryPassword || "").trim();

    if (!name || !email || !submittedAccessCode || !password) {
      return res
        .status(400)
        .json({ message: "name, email, accessCode and password are required." });
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (!validator.isEmail(normalizedEmail)) {
      return res.status(400).json({ message: "Invalid email." });
    }
    const user = await User.findOne({
      email: normalizedEmail,
      role: { $in: ["hotel", "supplier"] },
      mustSetPassword: true,
    });

    if (!user) {
      return res.status(404).json({
        message:
          "Business onboarding account not found. Ask admin to register your business email first.",
      });
    }

    if (user.name.trim().toLowerCase() !== name.trim().toLowerCase()) {
      return res
        .status(400)
        .json({ message: "Provided name does not match admin-registered owner name." });
    }

    const accessCodeMatches = await bcrypt.compare(submittedAccessCode, user.password);
    if (!accessCodeMatches) {
      return res.status(401).json({ message: "Invalid admin access code." });
    }

    user.password = await bcrypt.hash(password, 12);
    user.mustSetPassword = false;
    await user.save();

    const token = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    return res.json({
      user: await buildAuthUserPayload(user),
      token,
      accessToken: token,
      refreshToken,
      message: "Business registration completed. You can now login.",
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to complete hotel registration.",
      error: error.message,
    });
  }
};

const refreshToken = async (req, res) => {
  try {
    const token = req.body.refreshToken;
    if (!token) {
      return res.status(400).json({ message: "refreshToken is required." });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
    );
    if (decoded.tokenType !== "refresh") {
      return res.status(401).json({ message: "Invalid refresh token." });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: "User not found." });
    }

    const accessToken = generateAccessToken(user);
    return res.json({
      token: accessToken,
      accessToken,
      refreshToken: generateRefreshToken(user),
      user: await buildAuthUserPayload(user),
    });
  } catch (error) {
    return res.status(401).json({ message: "Invalid refresh token." });
  }
};

module.exports = {
  login,
  registerTourist,
  registerHotelByAdmin,
  registerBusinessOwner,
  completeHotelRegistration,
  refreshToken,
};
