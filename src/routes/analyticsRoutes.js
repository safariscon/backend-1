const express = require("express");
const rateLimit = require("express-rate-limit");
const { optionalProtect } = require("../middleware/authMiddleware");
const { trackEvent } = require("../controllers/analyticsController");

const router = express.Router();
const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/track", analyticsLimiter, optionalProtect, trackEvent);

module.exports = router;
