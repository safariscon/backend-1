const express = require("express");
const {
  login,
  registerTourist,
  registerBusinessByAdmin,
  completeProviderRegistration,
} = require("../controllers/authController");
const { protect, adminOnly } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/login", login);
router.post("/register", registerTourist);
router.post("/provider/complete-registration", completeProviderRegistration);
router.post("/admin/register-business", protect, adminOnly, registerBusinessByAdmin);

module.exports = router;
