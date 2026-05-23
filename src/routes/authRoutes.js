const express = require("express");
const {
  login,
  registerTourist,
  registerHotelByAdmin,
  registerBusinessOwner,
  completeHotelRegistration,
  refreshToken,
} = require("../controllers/authController");
const { protect, adminOnly } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/login", login);
router.post("/register", registerTourist);
router.post("/refresh-token", refreshToken);
router.post("/business-register", registerBusinessOwner);
router.post("/hotel/complete-registration", completeHotelRegistration);
router.post("/business/complete-registration", completeHotelRegistration);
router.post("/admin/register-hotel", protect, adminOnly, registerHotelByAdmin);

module.exports = router;
