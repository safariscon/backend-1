const express = require("express");
const {
  login,
  registerTourist,
  registerBusinessByAdmin,
  completeProviderRegistration,
  resendVerificationOtp,
  verifyEmailOtp,
  forgotPassword,
  resetPassword,
} = require("../controllers/authController");
const { protect, adminOnly } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/login", login);
router.post("/register", registerTourist);
router.post("/provider/complete-registration", completeProviderRegistration);
router.post("/email/resend-verification-otp", resendVerificationOtp);
router.post("/email/verify-otp", verifyEmailOtp);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/admin/register-business", protect, adminOnly, registerBusinessByAdmin);

module.exports = router;
