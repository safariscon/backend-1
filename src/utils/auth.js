const jwt = require("jsonwebtoken");

const generateAccessToken = (user) =>
  jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
      hotelId: user.hotelId || null,
      phone: user.phone || "",
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m" }
  );

const generateRefreshToken = (user) =>
  jwt.sign(
    {
      id: user._id,
      tokenType: "refresh",
    },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d" }
  );

const generateToken = generateAccessToken;

const buildUserPayload = (user) => ({
  id: user._id,
  email: user.email,
  name: user.name,
  role: user.role,
  hotelId: user.hotelId || null,
  supplierId: user.supplierId || null,
  businessId: user.hotelId || null,
  phone: user.phone || "",
});

module.exports = {
  generateToken,
  generateAccessToken,
  generateRefreshToken,
  buildUserPayload,
};
