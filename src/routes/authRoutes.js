const express = require("express");
const {
  login,
  resendLoginOtp,
  verifyLoginOtp,
  refreshSession,
  logout,
  registerTourist,
  registerBusinessByAdmin,
  completeProviderRegistration,
  resendVerificationOtp,
  verifyEmailOtp,
  forgotPassword,
  resetPassword,
} = require("../controllers/authController");
const { protect, optionalProtect, adminOnly } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/login", login);
router.post("/login/resend-otp", resendLoginOtp);
router.post("/login/verify-otp", verifyLoginOtp);
router.post("/refresh", refreshSession);
router.post("/logout", optionalProtect, logout);
router.post("/register", registerTourist);
router.post("/provider/complete-registration", completeProviderRegistration);
router.post("/email/resend-verification-otp", resendVerificationOtp);
router.post("/email/verify-otp", verifyEmailOtp);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/admin/register-business", protect, adminOnly, registerBusinessByAdmin);

module.exports = router;
