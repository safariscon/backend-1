const jwt = require("jsonwebtoken");

const generateToken = (user) =>
  jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
      hotelId: user.hotelId || null,
      phone: user.phone || "",
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

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
  buildUserPayload,
};
