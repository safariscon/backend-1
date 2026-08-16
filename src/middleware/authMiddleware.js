const User = require("../models/User");
const { isAccessTokenPayload, verifyAuthToken } = require("../utils/auth");
const { hasUserAcceptedTerms, termsRejectedPayload } = require("../utils/terms");

const loadAccessUser = async (req) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : null;

  if (!token) {
    return { status: 401, body: { code: "TOKEN_MISSING", message: "Unauthorized: token missing." } };
  }

  let decoded;
  try {
    decoded = verifyAuthToken(token);
  } catch (error) {
    if (error?.name === "TokenExpiredError") {
      return { status: 401, body: { code: "TOKEN_EXPIRED", message: "Unauthorized: token expired." } };
    }
    return { status: 401, body: { code: "AUTH_UNAUTHORIZED", message: "Unauthorized: invalid token." } };
  }

  if (!isAccessTokenPayload(decoded)) {
    return { status: 401, body: { code: "AUTH_UNAUTHORIZED", message: "Unauthorized: access token required." } };
  }

  const user = await User.findById(decoded.id).select("-password");
  if (!user) {
    return { status: 401, body: { code: "AUTH_UNAUTHORIZED", message: "Unauthorized: user not found." } };
  }

  return { user };
};

const createProtect =
  ({ requireTerms = true } = {}) =>
  async (req, res, next) => {
    try {
      const result = await loadAccessUser(req);
      if (!result.user) {
        return res.status(result.status).json(result.body);
      }

      if (requireTerms && result.user.role !== "admin" && !hasUserAcceptedTerms(result.user)) {
        return res.status(403).json(
          termsRejectedPayload(
            "You must accept the Terms of use and Privacy policy before you can use SafarisCon."
          )
        );
      }

      req.user = result.user;
      next();
    } catch (_error) {
      return res.status(401).json({ code: "AUTH_UNAUTHORIZED", message: "Unauthorized: invalid token." });
    }
  };

const protect = createProtect({ requireTerms: true });
const protectAllowWithoutTerms = createProtect({ requireTerms: false });

const optionalProtect = async (req, _res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
    if (!token) return next();
    const decoded = verifyAuthToken(token);
    if (!isAccessTokenPayload(decoded)) return next();
    req.user = await User.findById(decoded.id).select("-password");
    return next();
  } catch (_error) {
    return next();
  }
};

const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden: admin role required." });
  }
  next();
};

const customerOnly = (req, res, next) => {
  if (!req.user || !["tourist", "customer"].includes(req.user.role)) {
    return res.status(403).json({ message: "Forbidden: customer account required." });
  }
  next();
};

const sellerOnly = (req, res, next) => {
  if (!req.user || !["hotel", "supplier"].includes(req.user.role)) {
    return res.status(403).json({ message: "Forbidden: seller role required." });
  }
  next();
};

const supplierOnly = (req, res, next) => {
  if (!req.user || !["supplier", "hotel"].includes(req.user.role)) {
    return res.status(403).json({ message: "Forbidden: supplier role required." });
  }
  next();
};

module.exports = {
  protect,
  protectAllowWithoutTerms,
  optionalProtect,
  adminOnly,
  customerOnly,
  sellerOnly,
  supplierOnly,
};
