const express = require("express");
const rateLimit = require("express-rate-limit");
const { search, reverse, route } = require("../controllers/geoController");

const router = express.Router();

const geoLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many location lookups. Try again in a minute." },
});

router.use(geoLimiter);
router.get("/search", search);
router.get("/reverse", reverse);
router.get("/route", route);

module.exports = router;
