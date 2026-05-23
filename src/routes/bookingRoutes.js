const express = require("express");
const {
  createBookingRequest,
  createServiceBooking,
  listMyBookings,
  getMyBookingById,
} = require("../controllers/bookingController");
const { protect, touristOnly } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/request", protect, touristOnly, createBookingRequest);
router.post("/service", protect, touristOnly, createServiceBooking);
router.get("/my", protect, touristOnly, listMyBookings);
router.get("/my/:bookingId", protect, touristOnly, getMyBookingById);

module.exports = router;
