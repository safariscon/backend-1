const bcrypt = require("bcrypt");
const crypto = require("crypto");
const User = require("../models/User");
const Hotel = require("../models/Hotel");
const Room = require("../models/Room");
const Supplier = require("../models/Supplier");
const {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  generateAccessToken,
  generateRefreshToken,
  generateToken,
  hashToken,
  isRefreshTokenPayload,
  verifyAuthToken,
  buildUserPayload,
} = require("../utils/auth");
const { generateUniqueSellerId } = require("../utils/sellerIds");
const { normalizePayoutDetails, toLocalMsisdn } = require("../utils/payoutDetails");
const { hasAcceptedTerms, applyTermsAcceptance, termsRejectedPayload } = require("../utils/terms");
const {
  buildProviderInviteUrl,
  buildOnboardingPreview,
  normalizeSellerId,
} = require("../utils/providerOnboarding");
const {
  sendProviderOnboardingEmail,
  sendEmailVerificationOtp,
  sendPasswordResetOtp,
  sendLoginOtp,
  resolveLanguage,
} = require("../utils/notify");
const { REALTIME_EVENTS, emitRealtime } = require("../utils/realtime");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = Number(process.env.AUTH_OTP_EXPIRY_MINUTES || 10);
const OTP_RESEND_COOLDOWN_SECONDS = Number(process.env.AUTH_OTP_RESEND_COOLDOWN_SECONDS || 60);
const OTP_MAX_ATTEMPTS = Number(process.env.AUTH_OTP_MAX_ATTEMPTS || 5);

const normalizeEmail = (email) => String(email || "").toLowerCase().trim();
const isValidEmail = (email) => EMAIL_REGEX.test(String(email || ""));
const minutesFromNow = (minutes) => new Date(Date.now() + minutes * 60 * 1000);
const secondsSince = (date) => date ? Math.floor((Date.now() - new Date(date).getTime()) / 1000) : Infinity;
const createOtp = () => String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");

const buildGenericOtpResponse = (message) => ({
  message,
  expiresInMinutes: OTP_EXPIRY_MINUTES,
});

const canSendOtp = (lastSentAt) => secondsSince(lastSentAt) >= OTP_RESEND_COOLDOWN_SECONDS;

const parseRememberMe = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  return ["true", "1", "yes", "on"].includes(String(value || "").trim().toLowerCase());
};

const clearLoginOtp = (user) => {
  user.loginOtpHash = "";
  user.loginOtpExpiresAt = null;
  user.loginOtpAttempts = 0;
  user.loginRememberMe = false;
};

const clearRefreshSession = (user) => {
  user.refreshTokenHash = "";
  user.refreshTokenExpiresAt = null;
};

const buildTokenResponse = ({ userPayload, accessToken, refreshToken, rememberMe }) => ({
  user: userPayload,
  token: accessToken,
  accessToken,
  refreshToken: refreshToken || null,
  rememberMe: Boolean(rememberMe),
  accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
  refreshTokenExpiresIn: rememberMe ? REFRESH_TOKEN_TTL_SECONDS : null,
});

const issueSessionTokens = async (user, rememberMe) => {
  const accessToken = generateAccessToken(user);
  let refreshToken = null;

  if (rememberMe) {
    refreshToken = generateRefreshToken(user);
    user.refreshTokenHash = hashToken(refreshToken);
    user.refreshTokenExpiresAt = minutesFromNow(REFRESH_TOKEN_TTL_SECONDS / 60);
  } else {
    clearRefreshSession(user);
  }

  clearLoginOtp(user);
  await user.save();

  return buildTokenResponse({
    userPayload: await buildAuthUserPayload(user),
    accessToken,
    refreshToken,
    rememberMe,
  });
};

const issueEmailVerificationOtp = async (user, language = "en") => {
  if (user.emailVerified) return { sent: false, alreadyVerified: true };
  if (!canSendOtp(user.emailVerificationOtpSentAt)) return { sent: false, cooldown: true };

  const otp = createOtp();
  user.emailVerificationOtpHash = await bcrypt.hash(otp, 10);
  user.emailVerificationOtpExpiresAt = minutesFromNow(OTP_EXPIRY_MINUTES);
  user.emailVerificationOtpAttempts = 0;
  user.emailVerificationOtpSentAt = new Date();
  await user.save();

  await sendEmailVerificationOtp({
    email: user.email,
    name: user.name,
    otp,
    expiresInMinutes: OTP_EXPIRY_MINUTES,
    language,
  });

  return { sent: true };
};

const issuePasswordResetOtp = async (user, language = "en") => {
  if (!canSendOtp(user.passwordResetOtpSentAt)) return { sent: false, cooldown: true };

  const otp = createOtp();
  user.passwordResetOtpHash = await bcrypt.hash(otp, 10);
  user.passwordResetOtpExpiresAt = minutesFromNow(OTP_EXPIRY_MINUTES);
  user.passwordResetOtpAttempts = 0;
  user.passwordResetOtpSentAt = new Date();
  await user.save();

  await sendPasswordResetOtp({
    email: user.email,
    name: user.name,
    otp,
    expiresInMinutes: OTP_EXPIRY_MINUTES,
    language,
  });

  return { sent: true };
};

const issueLoginOtp = async (user, rememberMe, language = "en") => {
  const otp = createOtp();
  user.loginOtpHash = await bcrypt.hash(otp, 10);
  user.loginOtpExpiresAt = minutesFromNow(OTP_EXPIRY_MINUTES);
  user.loginOtpAttempts = 0;
  user.loginOtpSentAt = new Date();
  user.loginRememberMe = Boolean(rememberMe);
  await user.save();

  await sendLoginOtp({
    email: user.email,
    name: user.name,
    otp,
    expiresInMinutes: OTP_EXPIRY_MINUTES,
    language,
  });

  return { sent: true };
};

const verifyOtp = async ({ user, otp, hashField, expiresField, attemptsField }) => {
  if (!user?.[hashField] || !user?.[expiresField]) {
    return { ok: false, status: 400, message: "OTP has not been requested or has already been used." };
  }
  if (new Date(user[expiresField]).getTime() <= Date.now()) {
    return { ok: false, status: 400, message: "OTP has expired. Request a new code." };
  }
  if (Number(user[attemptsField] || 0) >= OTP_MAX_ATTEMPTS) {
    return { ok: false, status: 429, message: "Too many incorrect OTP attempts. Request a new code." };
  }

  const matches = await bcrypt.compare(String(otp || ""), user[hashField]);
  if (!matches) {
    user[attemptsField] = Number(user[attemptsField] || 0) + 1;
    await user.save();
    return { ok: false, status: 400, message: "Invalid OTP." };
  }

  return { ok: true };
};

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
    const { email, password, rememberMe } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "email and password are required." });
    }

    const normalizedEmail = normalizeEmail(email);
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials." });
    }
    if (["hotel", "supplier"].includes(user.role) && user.mustSetPassword) {
      return res.status(403).json({
        message: "Service provider account must complete onboarding before login.",
      });
    }
    if (!user.password) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials." });
    }
    if (!user.emailVerified) {
      return res.status(403).json({
        code: "EMAIL_NOT_VERIFIED",
        message: "Please verify your email before logging in.",
        email: user.email,
        emailVerified: false,
      });
    }

    const persistSession = parseRememberMe(rememberMe);
    await issueLoginOtp(user, persistSession, resolveLanguage(req));

    return res.json({
      code: "LOGIN_OTP_REQUIRED",
      message: "A login verification code has been sent to your email.",
      email: user.email,
      rememberMe: persistSession,
      expiresInMinutes: OTP_EXPIRY_MINUTES,
      termsAccepted: Boolean(user.termsAccepted),
    });
  } catch (error) {
    return res.status(500).json({ message: "Login failed.", error: error.message });
  }
};

const resendLoginOtp = async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ message: "A valid email address is required." });
    }

    const generic = buildGenericOtpResponse(
      "If a login is in progress for this email, a new verification code has been sent."
    );
    const user = await User.findOne({ email: normalizedEmail });
    if (!user || !user.loginOtpHash || !user.emailVerified || user.mustSetPassword) {
      return res.json(generic);
    }

    await issueLoginOtp(user, Boolean(user.loginRememberMe), resolveLanguage(req));
    return res.json(generic);
  } catch (error) {
    return res.status(500).json({ message: "Failed to resend login code.", error: error.message });
  }
};

const verifyLoginOtp = async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || "").trim();
    if (!isValidEmail(normalizedEmail) || !otp) {
      return res.status(400).json({ message: "A valid email and OTP are required." });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(404).json({ message: "User not found." });
    if (!user.emailVerified) {
      return res.status(403).json({
        code: "EMAIL_NOT_VERIFIED",
        message: "Please verify your email before logging in.",
        email: user.email,
        emailVerified: false,
      });
    }

    const verification = await verifyOtp({
      user,
      otp,
      hashField: "loginOtpHash",
      expiresField: "loginOtpExpiresAt",
      attemptsField: "loginOtpAttempts",
    });
    if (!verification.ok) {
      return res.status(verification.status).json({ message: verification.message });
    }

    const rememberMe = Boolean(user.loginRememberMe);
    const session = await issueSessionTokens(user, rememberMe);
    return res.json({
      message: "Login successful.",
      ...session,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to verify login code.", error: error.message });
  }
};

const refreshSession = async (req, res) => {
  try {
    const refreshToken = String(req.body.refreshToken || "").trim();
    if (!refreshToken) {
      return res.status(400).json({ message: "refreshToken is required." });
    }

    let decoded;
    try {
      decoded = verifyAuthToken(refreshToken);
    } catch (_error) {
      return res.status(401).json({ message: "Invalid or expired refresh token." });
    }

    if (!isRefreshTokenPayload(decoded) || !decoded.id) {
      return res.status(401).json({ message: "Invalid or expired refresh token." });
    }

    const user = await User.findById(decoded.id);
    if (!user || !user.refreshTokenHash) {
      return res.status(401).json({ message: "Invalid or expired refresh token." });
    }
    if (user.refreshTokenExpiresAt && new Date(user.refreshTokenExpiresAt).getTime() <= Date.now()) {
      clearRefreshSession(user);
      await user.save();
      return res.status(401).json({ message: "Invalid or expired refresh token." });
    }
    if (user.refreshTokenHash !== hashToken(refreshToken)) {
      return res.status(401).json({ message: "Invalid or expired refresh token." });
    }

    const session = await issueSessionTokens(user, true);
    return res.json({
      message: "Session refreshed.",
      ...session,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to refresh session.", error: error.message });
  }
};

const logout = async (req, res) => {
  try {
    const refreshToken = String(req.body?.refreshToken || "").trim();
    let user = req.user || null;

    if (!user && refreshToken) {
      try {
        const decoded = verifyAuthToken(refreshToken);
        if (isRefreshTokenPayload(decoded) && decoded.id) {
          user = await User.findById(decoded.id);
        }
      } catch (_error) {
        user = null;
      }
    }

    if (user) {
      clearRefreshSession(user);
      clearLoginOtp(user);
      await user.save();
    }

    return res.json({ message: "Logged out." });
  } catch (error) {
    return res.status(500).json({ message: "Failed to logout.", error: error.message });
  }
};

const registerTourist = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!name || !email || !password || !role) {
      return res
        .status(400)
        .json({ message: "name, email, password and role are required." });
    }
    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ message: "A valid email address is required." });
    }

    if (!["customer", "tourist"].includes(role)) {
      return res
        .status(400)
        .json({ message: 'Only customer accounts can self-register.' });
    }

    if (!hasAcceptedTerms(req.body)) {
      return res.status(400).json(
        termsRejectedPayload(
          "You must accept the Terms of use and Privacy policy before creating an account."
        )
      );
    }

    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ message: "User already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const acceptedAt = new Date();
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: "customer",
      termsAccepted: true,
      termsAcceptedAt: acceptedAt,
    });

    let emailVerificationSent = false;
    try {
      const otpResult = await issueEmailVerificationOtp(user, resolveLanguage(req));
      emailVerificationSent = Boolean(otpResult.sent);
    } catch (emailError) {
      console.warn("Email verification OTP delivery failed:", emailError.message);
    }

    const token = generateToken(user);
    return res.status(201).json({
      user: await buildAuthUserPayload(user),
      token,
      emailVerification: {
        required: true,
        sent: emailVerificationSent,
        expiresInMinutes: OTP_EXPIRY_MINUTES,
      },
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
    let credentialEmailSent = false;
    let credentialEmailWarning = "";
    if (normalizedEmail && normalizedOwnerName) {
      const sellerId = await generateUniqueSellerId({
        exists: (candidate) => User.exists({ sellerId: candidate }),
      });

      owner = await User.create({
        name: normalizedOwnerName,
        email: normalizedEmail,
        password: "",
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
        serviceProviderName: normalizedOwnerName,
        serviceProviderEmail: normalizedEmail,
        sellerId,
        registrationPath: "/provider-register",
        registrationUrl: buildProviderInviteUrl({ sellerId }),
      };

      try {
        await sendProviderOnboardingEmail({
          providerEmail: normalizedEmail,
          businessName: hotel.name,
          providerName: normalizedOwnerName,
          sellerId,
          registrationUrl: onboardingCredentials.registrationUrl,
          language: resolveLanguage(req),
        });
        credentialEmailSent = true;
      } catch (emailError) {
        credentialEmailWarning =
          "Business and service provider account were created, but seller ID email delivery failed.";
        console.warn("Service provider seller ID email delivery failed:", emailError.message);
      }
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
      serviceProviderEmail: owner ? normalizedEmail : "",
      serviceProviderName: owner ? normalizedOwnerName : "",
      registrationPath: owner ? "/provider-register" : "",
      serviceProviderRegistrationPath: owner ? "/provider-register" : "",
      registrationUrl: onboardingCredentials?.registrationUrl || "",
      credentials: onboardingCredentials,
      credentialEmail: {
        sent: credentialEmailSent,
        warning: credentialEmailWarning,
      },
      message:
        credentialEmailWarning ||
        (owner
          ? "Business registered by admin. The service provider must complete registration to set a password."
          : "Business registered by admin successfully."),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Business registration failed.", error: error.message });
  }
};

const getProviderOnboarding = async (req, res) => {
  try {
    const sellerId = normalizeSellerId(req.params.sellerId || req.query.sellerId);
    if (!sellerId) {
      return res.status(400).json({ message: "sellerId is required." });
    }

    const user = await User.findOne(
      {
        sellerId,
        role: { $in: ["hotel", "supplier"] },
      },
      "name email sellerId role mustSetPassword hotelId"
    );

    if (!user) {
      return res.status(404).json({
        message: "Service provider onboarding account not found. Check the seller ID in your invite email.",
      });
    }
    if (!user.mustSetPassword) {
      return res.status(409).json({
        code: "ONBOARDING_ALREADY_COMPLETED",
        message: "This service provider has already completed registration. Please log in.",
      });
    }

    let businessName = "";
    if (user.hotelId) {
      const hotel = await Hotel.findById(user.hotelId).select("name type");
      businessName = hotel?.name || "";
    }

    return res.json({
      ...buildOnboardingPreview(user),
      businessName,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to load service provider onboarding details.",
      error: error.message,
    });
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
      confirmPassword,
    } = req.body;

    if (!sellerId || !newPassword) {
      return res.status(400).json({
        message: "Seller ID and new password are required.",
      });
    }

    if (String(newPassword).length < 8) {
      return res.status(400).json({
        message: "New password must be at least 8 characters long.",
      });
    }
    if (confirmPassword !== undefined && String(confirmPassword) !== String(newPassword)) {
      return res.status(400).json({ message: "Password confirmation does not match." });
    }
    if (!hasAcceptedTerms(req.body)) {
      return res.status(400).json(
        termsRejectedPayload(
          "You must accept the Terms of use and Privacy policy before completing registration."
        )
      );
    }

    const normalizedSellerId = normalizeSellerId(sellerId);
    const user = await User.findOne({
      sellerId: normalizedSellerId,
      role: { $in: ["hotel", "supplier"] },
      mustSetPassword: true,
    });

    if (!user) {
      return res.status(404).json({
        message: "Service provider onboarding account not found. Check the seller ID supplied by the admin.",
      });
    }

    if (providerEmail) {
      const normalizedEmail = String(providerEmail).toLowerCase().trim();
      if (user.email !== normalizedEmail) {
        return res.status(400).json({
          message: "Email does not match the admin-created account. Use the email from your invite.",
        });
      }
    }
    if (providerName && user.name.trim().toLowerCase() !== String(providerName).trim().toLowerCase()) {
      return res
        .status(400)
        .json({ message: "Service provider name does not match the admin-created account." });
    }

    if (generatedPassword && user.password) {
      const generatedPasswordMatches = await bcrypt.compare(
        String(generatedPassword),
        user.password
      );
      if (!generatedPasswordMatches) {
        return res.status(401).json({ message: "Invalid onboarding credentials." });
      }
    }
    if (!generatedPassword && user.password) {
      return res.status(401).json({ message: "Invalid onboarding credentials." });
    }

    const payoutResult = normalizePayoutDetails(
      req.body.payoutDetails || req.body.paymentDetails || req.body.receivingPayment
    );
    if (!payoutResult.ok) {
      return res.status(payoutResult.status).json({ message: payoutResult.message });
    }

    const phone = toLocalMsisdn(req.body.phone || "");

    user.password = await bcrypt.hash(String(newPassword), 12);
    user.mustSetPassword = false;
    user.emailVerified = false;
    user.emailVerifiedAt = null;
    user.emailVerificationOtpHash = "";
    user.emailVerificationOtpExpiresAt = null;
    user.emailVerificationOtpAttempts = 0;
    applyTermsAcceptance(user);
    user.payoutDetails = payoutResult.value;
    if (phone) user.phone = phone;
    await user.save();

    // Completing registration must not create a listing. Listings are created later
    // via POST /api/hotel/services. If admin already attached a business, only sync payout.
    const business = user.hotelId ? await Hotel.findById(user.hotelId) : null;
    if (business) {
      business.payoutDetails = payoutResult.value;
      if (phone) {
        business.contactDetails = {
          ...(business.contactDetails || {}),
          phone,
        };
      }
      await business.save();
    }

    let emailVerificationSent = false;
    try {
      const otpResult = await issueEmailVerificationOtp(user, resolveLanguage(req));
      emailVerificationSent = Boolean(otpResult.sent);
    } catch (emailError) {
      console.warn("Service provider email verification OTP delivery failed:", emailError.message);
    }

    const token = generateToken(user);
    return res.json({
      user: await buildAuthUserPayload(user),
      token,
      business: business
        ? {
            id: business._id,
            name: business.name,
            type: business.type,
            approvalStatus: business.approvalStatus,
            payoutDetails: business.payoutDetails,
          }
        : null,
      payoutDetails: payoutResult.value,
      message: business
        ? "Service provider registration completed. Verify your email before logging in."
        : "Service provider registration completed. Verify your email before logging in. Create a service listing from your dashboard when you are ready.",
      emailVerification: {
        required: true,
        sent: emailVerificationSent,
        expiresInMinutes: OTP_EXPIRY_MINUTES,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to complete service provider registration.",
      error: error.message,
    });
  }
};

const resendVerificationOtp = async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ message: "A valid email address is required." });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.json(buildGenericOtpResponse("If this email is registered, a verification code has been sent."));
    }
    if (user.emailVerified) {
      return res.json({ message: "Email is already verified.", emailVerified: true });
    }

    const result = await issueEmailVerificationOtp(user, resolveLanguage(req));
    if (result.cooldown) {
      return res.status(429).json({
        message: `Please wait ${OTP_RESEND_COOLDOWN_SECONDS} seconds before requesting another code.`,
      });
    }

    return res.json(buildGenericOtpResponse("Verification code sent."));
  } catch (error) {
    return res.status(500).json({ message: "Failed to send verification code.", error: error.message });
  }
};

const verifyEmailOtp = async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || "").trim();
    if (!isValidEmail(normalizedEmail) || !otp) {
      return res.status(400).json({ message: "A valid email and OTP are required." });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(404).json({ message: "User not found." });
    if (user.emailVerified) {
      return res.json({
        message: "Email is already verified.",
        user: await buildAuthUserPayload(user),
        token: generateToken(user),
      });
    }

    const verification = await verifyOtp({
      user,
      otp,
      hashField: "emailVerificationOtpHash",
      expiresField: "emailVerificationOtpExpiresAt",
      attemptsField: "emailVerificationOtpAttempts",
    });
    if (!verification.ok) {
      return res.status(verification.status).json({ message: verification.message });
    }

    user.emailVerified = true;
    user.emailVerifiedAt = new Date();
    user.emailVerificationOtpHash = "";
    user.emailVerificationOtpExpiresAt = null;
    user.emailVerificationOtpAttempts = 0;
    await user.save();

    return res.json({
      message: "Email verified successfully.",
      user: await buildAuthUserPayload(user),
      token: generateToken(user),
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to verify email.", error: error.message });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ message: "A valid email address is required." });
    }

    const generic = buildGenericOtpResponse("If this email is registered, a password reset code has been sent.");
    const user = await User.findOne({ email: normalizedEmail });
    if (!user || !user.password || user.mustSetPassword) return res.json(generic);

    const result = await issuePasswordResetOtp(user, resolveLanguage(req));
    if (result.cooldown) {
      return res.status(429).json({
        message: `Please wait ${OTP_RESEND_COOLDOWN_SECONDS} seconds before requesting another code.`,
      });
    }

    return res.json(generic);
  } catch (error) {
    return res.status(500).json({ message: "Failed to start password reset.", error: error.message });
  }
};

const resetPassword = async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || "").trim();
    const newPassword = String(req.body.newPassword || "");

    if (!isValidEmail(normalizedEmail) || !otp || !newPassword) {
      return res.status(400).json({ message: "A valid email, OTP, and new password are required." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: "New password must be at least 8 characters long." });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(404).json({ message: "User not found." });

    const verification = await verifyOtp({
      user,
      otp,
      hashField: "passwordResetOtpHash",
      expiresField: "passwordResetOtpExpiresAt",
      attemptsField: "passwordResetOtpAttempts",
    });
    if (!verification.ok) {
      return res.status(verification.status).json({ message: verification.message });
    }

    user.password = await bcrypt.hash(newPassword, 12);
    user.passwordResetOtpHash = "";
    user.passwordResetOtpExpiresAt = null;
    user.passwordResetOtpAttempts = 0;
    user.passwordChangedAt = new Date();
    user.mustSetPassword = false;
    clearRefreshSession(user);
    clearLoginOtp(user);
    await user.save();

    return res.json({
      message: "Password reset successfully. You can now login with the new password.",
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to reset password.", error: error.message });
  }
};

const acceptTerms = async (req, res) => {
  try {
    if (!hasAcceptedTerms(req.body) && req.body.accepted !== true) {
      return res.status(400).json(
        termsRejectedPayload(
          "You must accept the Terms of use and Privacy policy to continue."
        )
      );
    }

    const user = req.user;
    if (user.termsAccepted) {
      return res.json({
        message: "Terms and Privacy policy already accepted.",
        user: await buildAuthUserPayload(user),
      });
    }

    applyTermsAcceptance(user);
    await user.save();

    return res.json({
      message: "Terms of use and Privacy policy accepted.",
      user: await buildAuthUserPayload(user),
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to accept terms.", error: error.message });
  }
};

module.exports = {
  login,
  resendLoginOtp,
  verifyLoginOtp,
  refreshSession,
  logout,
  registerTourist,
  registerBusinessByAdmin,
  getProviderOnboarding,
  completeProviderRegistration,
  resendVerificationOtp,
  verifyEmailOtp,
  forgotPassword,
  resetPassword,
  acceptTerms,
};
