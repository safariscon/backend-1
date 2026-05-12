const express = require("express");
const {
  createBookingRequest,
  listMyBookings,
} = require("../controllers/bookingController");
const { protect, touristOnly } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/request", protect, touristOnly, createBookingRequest);
router.get("/my", protect, touristOnly, listMyBookings);

module.exports = router;
