const bcrypt = require("bcrypt");
const User = require("../models/User");
const Hotel = require("../models/Hotel");
const Room = require("../models/Room");
const Supplier = require("../models/Supplier");
const { generateToken, buildUserPayload } = require("../utils/auth");
const { prefixedCode } = require("../utils/secureIds");
const { sendProviderOnboardingEmail } = require("../utils/notify");
const { REALTIME_EVENTS, emitRealtime } = require("../utils/realtime");

const BUSINESS_TYPE_CONFIG = {
  hotel: {
    supplierCategory: "accommodation",
    supplierType: "hotel",
    defaultUnit: "night",
    createsRooms: true,
  },
  "hotels-and-resorts": {
    supplierCategory: "accommodation",
    supplierType: "hotel",
    defaultUnit: "night",
    createsRooms: true,
  },
  "homestays-and-guesthouses": {
    supplierCategory: "accommodation",
    supplierType: "guesthouse",
    defaultUnit: "night",
    createsRooms: true,
  },
  "tent-rentals-and-camping-sites": {
    supplierCategory: "accommodation",
    supplierType: "camping",
    defaultUnit: "night",
    createsRooms: true,
  },
  "vacation-rentals-and-apartments": {
    supplierCategory: "accommodation",
    supplierType: "apartment",
    defaultUnit: "night",
    createsRooms: true,
  },
  "car-rentals": {
    supplierCategory: "transport",
    supplierType: "car-rental",
    defaultUnit: "day",
    createsRooms: false,
  },
  "motorbike-and-scooter-rentals": {
    supplierCategory: "transport",
    supplierType: "motorbike-rental",
    defaultUnit: "day",
    createsRooms: false,
  },
  "taxi-and-ride-services": {
    supplierCategory: "transport",
    supplierType: "taxi",
    defaultUnit: "trip",
    createsRooms: false,
  },
  "bus-and-minivan-charters": {
    supplierCategory: "transport",
    supplierType: "charter",
    defaultUnit: "trip",
    createsRooms: false,
  },
  restaurants: {
    supplierCategory: "food-beverage",
    supplierType: "restaurant",
    defaultUnit: "table",
    createsRooms: false,
  },
  "bars-and-pubs": {
    supplierCategory: "food-beverage",
    supplierType: "bar",
    defaultUnit: "table",
    createsRooms: false,
  },
  "coffee-shops-and-cafes": {
    supplierCategory: "food-beverage",
    supplierType: "cafe",
    defaultUnit: "table",
    createsRooms: false,
  },
  "food-trucks-and-street-food-stalls": {
    supplierCategory: "food-beverage",
    supplierType: "food-truck",
    defaultUnit: "order",
    createsRooms: false,
  },
  "conference-event-halls-mice": {
    supplierCategory: "experiences",
    supplierType: "venue",
    defaultUnit: "event",
    createsRooms: false,
  },
  "wedding-venues": {
    supplierCategory: "experiences",
    supplierType: "wedding-venue",
    defaultUnit: "event",
    createsRooms: false,
  },
  "tour-and-activity-operators": {
    supplierCategory: "experiences",
    supplierType: "tour-operator",
    defaultUnit: "person",
    createsRooms: false,
  },
  "entertainment-venues": {
    supplierCategory: "experiences",
    supplierType: "entertainment",
    defaultUnit: "ticket",
    createsRooms: false,
  },
  "souvenir-shops-and-craft-markets": {
    supplierCategory: "retail",
    supplierType: "souvenir-shop",
    defaultUnit: "item",
    createsRooms: false,
  },
  "gear-rentals": {
    supplierCategory: "retail",
    supplierType: "gear-rental",
    defaultUnit: "day",
    createsRooms: false,
  },
  "spas-and-wellness-centers": {
    supplierCategory: "experiences",
    supplierType: "spa",
    defaultUnit: "hour",
    createsRooms: false,
  },
  "childcare-services": {
    supplierCategory: "experiences",
    supplierType: "childcare",
    defaultUnit: "hour",
    createsRooms: false,
  },
  other: {
    supplierCategory: "retail",
    supplierType: "business",
    defaultUnit: "use",
    createsRooms: false,
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

const buildAuthUserPayload = async (user) => {
  const payload = buildUserPayload(user);

  if (user.role === "hotel" && user.hotelId) {
    const hotel = await Hotel.findById(user.hotelId).select("type supplierId name");
    payload.businessId = hotel?._id || user.hotelId || null;
    payload.businessType = hotel?.type || "hotel";
    payload.businessName = hotel?.name || "";
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

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials." });
    }
    if (["hotel", "supplier"].includes(user.role) && user.mustSetPassword) {
      return res.status(403).json({
        message: "Provider account must complete onboarding before login.",
      });
    }
    if (!user.password) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    const token = generateToken(user);
    return res.json({
      user: await buildAuthUserPayload(user),
      token,
    });
  } catch (error) {
    return res.status(500).json({ message: "Login failed.", error: error.message });
  }
};

const registerTourist = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res
        .status(400)
        .json({ message: "name, email, password and role are required." });
    }

    if (!["customer", "tourist"].includes(role)) {
      return res
        .status(400)
        .json({ message: 'Only customer accounts can self-register.' });
    }

    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ message: "User already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      role: "customer",
    });

    const token = generateToken(user);
    return res.status(201).json({
      user: await buildAuthUserPayload(user),
      token,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Registration failed.", error: error.message });
  }
};

const registerBusinessByAdmin = async (req, res) => {
  try {
    const {
      businessName,
      businessType,
      contactInfo,
      contactDetails,
      images,
      services,
      location,
      description,
      basePrice,
      amenities,
      providerEmail,
      providerName,
    } = req.body;

    const normalizedBusinessName = (businessName || "").trim();
    const normalizedBusinessType = normalizeBusinessType(businessType);
    const normalizedLocation = location?.trim();
    const normalizedOwnerName = (providerName || "").trim();
    const normalizedEmail = (providerEmail || "").toLowerCase().trim();
    const normalizedDescription = (description || "").trim();
    const normalizedContactInfo = String(contactInfo || normalizedEmail || "").trim();
    const normalizedImages = parseStringList(images).slice(0, 3);
    const normalizedServices = parseStringList(services);
    const parsedBasePrice = Number(basePrice || 0);
    const businessConfig =
      BUSINESS_TYPE_CONFIG[normalizedBusinessType] || BUSINESS_TYPE_CONFIG.other;

    if (
      !normalizedBusinessName ||
      !normalizedBusinessType ||
      !normalizedLocation ||
      !normalizedDescription ||
      normalizedImages.length === 0 ||
      normalizedServices.length === 0 ||
      !Number.isFinite(parsedBasePrice)
    ) {
      return res.status(400).json({
        message:
          "businessName, businessType, description, location, images and services are required.",
      });
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
          amount: parsedBasePrice,
          currency: "RWF",
          unit: businessConfig.defaultUnit,
        },
      },
      commission: {
        percentage: 12,
        payoutSchedule: "monthly",
      },
    });

    const hotel = await Hotel.create({
      name: normalizedBusinessName,
      type: normalizedBusinessType,
      location: normalizedLocation,
      description: normalizedDescription,
      basePrice: parsedBasePrice,
      amenities: Array.isArray(amenities) ? amenities : [],
      contactInfo: normalizedContactInfo,
      contactDetails: {
        ...(contactDetails && typeof contactDetails === "object" ? contactDetails : {}),
        phone: contactDetails?.phone || normalizedContactInfo,
        email: contactDetails?.email || normalizedEmail,
      },
      images: normalizedImages,
      services: normalizedServices,
      supplierId: supplier._id,
      ownerEmail: normalizedEmail || `${supplier._id}@business.local`,
    });

    supplier.hotelId = hotel._id;
    await supplier.save();

    let owner = null;
    let onboardingCredentials = null;
    if (normalizedEmail && normalizedOwnerName) {
      const sellerId = prefixedCode("SELLER", 8);
      const generatedPassword = prefixedCode("SCN", 14);
      const temporaryHash = await bcrypt.hash(generatedPassword, 12);

      owner = await User.create({
        name: normalizedOwnerName,
        email: normalizedEmail,
        password: temporaryHash,
        role: "hotel",
        sellerId,
        hotelId: hotel._id,
        supplierId: supplier._id,
        mustSetPassword: true,
      });

      supplier.ownerUserId = owner._id;
      await supplier.save();

      onboardingCredentials = {
        providerName: normalizedOwnerName,
        providerEmail: normalizedEmail,
        sellerId,
        generatedPassword,
      };

      await sendProviderOnboardingEmail({
        providerEmail: normalizedEmail,
        businessName: hotel.name,
        providerName: normalizedOwnerName,
      });
    }

    if (businessConfig.createsRooms) {
      await Room.create({
        hotelId: hotel._id,
        roomNumber: "101",
        type: "standard",
        price: parsedBasePrice,
        status: "available",
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
      providerEmail: owner ? normalizedEmail : "",
      providerName: owner ? normalizedOwnerName : "",
      registrationPath: owner ? "/provider-register" : "",
      credentials: onboardingCredentials,
      message:
        owner
          ? "Business registered by admin. The provider must complete registration to set a password."
          : "Business registered by admin successfully.",
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Business registration failed.", error: error.message });
  }
};

const completeProviderRegistration = async (req, res) => {
  try {
    const {
      providerName,
      providerEmail,
      sellerId,
      generatedPassword,
      newPassword,
    } = req.body;

    if (
      !providerName ||
      !providerEmail ||
      !sellerId ||
      !generatedPassword ||
      !newPassword
    ) {
      return res
        .status(400)
        .json({
          message:
            "Provider name, provider email, seller ID, generated password, and new password are required.",
        });
    }

    if (String(newPassword).length < 8) {
      return res.status(400).json({
        message: "New password must be at least 8 characters long.",
      });
    }

    const normalizedEmail = String(providerEmail).toLowerCase().trim();
    const normalizedSellerId = String(sellerId).toUpperCase().trim();
    const user = await User.findOne({
      email: normalizedEmail,
      sellerId: normalizedSellerId,
      role: { $in: ["hotel", "supplier"] },
      mustSetPassword: true,
    });

    if (!user) {
      return res.status(404).json({
        message: "Provider onboarding account not found. Check the credentials supplied by the admin.",
      });
    }

    if (user.name.trim().toLowerCase() !== String(providerName).trim().toLowerCase()) {
      return res
        .status(400)
        .json({ message: "Provider name does not match the admin-created account." });
    }

    const generatedPasswordMatches = await bcrypt.compare(
      String(generatedPassword),
      user.password
    );
    if (!generatedPasswordMatches) {
      return res.status(401).json({ message: "Generated password is incorrect." });
    }

    user.password = await bcrypt.hash(String(newPassword), 12);
    user.mustSetPassword = false;
    await user.save();

    const token = generateToken(user);
    return res.json({
      user: await buildAuthUserPayload(user),
      token,
      message: "Provider registration completed. You can now login.",
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to complete provider registration.",
      error: error.message,
    });
  }
};

module.exports = {
  login,
  registerTourist,
  registerBusinessByAdmin,
  completeProviderRegistration,
};
