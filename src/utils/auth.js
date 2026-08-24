const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || "2h";
const REFRESH_TOKEN_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || "1d";
const ACCESS_TOKEN_TTL_SECONDS = Number(process.env.JWT_ACCESS_TTL_SECONDS || 2 * 60 * 60);
const REFRESH_TOKEN_TTL_SECONDS = Number(process.env.JWT_REFRESH_TTL_SECONDS || 24 * 60 * 60);

const buildAccessPayload = (user) => ({
  id: user._id,
  email: user.email,
  role: user.role,
  hotelId: user.hotelId || null,
  supplierId: user.supplierId || null,
  sellerId: user.sellerId || "",
  phone: user.phone || "",
  type: "access",
});

const generateAccessToken = (user) =>
  jwt.sign(buildAccessPayload(user), process.env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  });

const generateRefreshToken = (user) =>
  jwt.sign(
    {
      id: user._id,
      type: "refresh",
      jti: crypto.randomUUID(),
    },
    process.env.JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRES_IN }
  );

const generateToken = (user) => generateAccessToken(user);

const hashToken = (token) =>
  crypto.createHash("sha256").update(String(token || "")).digest("hex");

const verifyAuthToken = (token) => jwt.verify(token, process.env.JWT_SECRET);

const isAccessTokenPayload = (decoded) => decoded?.type === "access" || !decoded?.type;

const isRefreshTokenPayload = (decoded) => decoded?.type === "refresh";

const buildUserPayload = (user) => ({
  id: user._id,
  email: user.email,
  name: user.name,
  role: user.role,
  hotelId: user.hotelId || null,
  supplierId: user.supplierId || null,
  businessId: user.hotelId || null,
  sellerId: user.sellerId || "",
  phone: user.phone || "",
  emailVerified: Boolean(user.emailVerified),
  termsAccepted: Boolean(user.termsAccepted),
  termsAcceptedAt: user.termsAcceptedAt || null,
  avatarUrl: user.avatarUrl || "",
});

module.exports = {
  ACCESS_TOKEN_EXPIRES_IN,
  REFRESH_TOKEN_EXPIRES_IN,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  generateAccessToken,
  generateRefreshToken,
  generateToken,
  hashToken,
  verifyAuthToken,
  isAccessTokenPayload,
  isRefreshTokenPayload,
  buildUserPayload,
};
