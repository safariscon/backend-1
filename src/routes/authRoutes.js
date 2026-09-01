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
  getProviderOnboarding,
  resendVerificationOtp,
  verifyEmailOtp,
  forgotPassword,
  resetPassword,
  acceptTerms,
  updateProfile,
  uploadProfileAvatar,
  changePassword,
} = require("../controllers/authController");
const { protect, protectAllowWithoutTerms, optionalProtect, adminOnly } = require("../middleware/authMiddleware");
const { imageUpload } = require("../middleware/uploadMiddleware");
const { uploadCustomerDocuments } = require("../controllers/uploadController");

const router = express.Router();

router.post("/login", login);
router.post("/login/resend-otp", resendLoginOtp);
router.post("/login/verify-otp", verifyLoginOtp);
router.post("/refresh", refreshSession);
router.post("/logout", optionalProtect, logout);
router.post("/register", registerTourist);
router.get("/provider/onboarding", getProviderOnboarding);
router.get("/provider/onboarding/:sellerId", getProviderOnboarding);
router.post("/provider/complete-registration", completeProviderRegistration);
router.post("/email/resend-verification-otp", resendVerificationOtp);
router.post("/email/verify-otp", verifyEmailOtp);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/accept-terms", protectAllowWithoutTerms, acceptTerms);
router.post("/change-password", protect, changePassword);
router.put("/profile", protect, updateProfile);
router.post("/profile/avatar", protect, imageUpload.single("image"), uploadProfileAvatar);
// Licence / permit photos a customer attaches to a vehicle booking.
router.post("/documents", protect, imageUpload.array("documents", 2), uploadCustomerDocuments);
router.post("/admin/register-business", protect, adminOnly, registerBusinessByAdmin);

module.exports = router;
