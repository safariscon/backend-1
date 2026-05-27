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

const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden: admin role required." });
  }
  next();
};

const touristOnly = (req, res, next) => {
  if (!req.user || req.user.role !== "tourist") {
    return res
      .status(403)
      .json({ message: "Forbidden: tourist role required." });
  }
  next();
};

const hotelOnly = (req, res, next) => {
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

module.exports = { protect, adminOnly, touristOnly, hotelOnly, supplierOnly };
