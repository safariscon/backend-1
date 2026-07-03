const jwt = require("jsonwebtoken");
const User = require("../models/User");

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;

    if (!token) {
      return res.status(401).json({ message: "Unauthorized: token missing." });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return res.status(401).json({ message: "Unauthorized: user not found." });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Unauthorized: invalid token." });
  }
};

const optionalProtect = async (req, _res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
    if (!token) return next();
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
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

module.exports = { protect, optionalProtect, adminOnly, customerOnly, sellerOnly, supplierOnly };
