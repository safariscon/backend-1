const express = require("express");
const {
  createBookingRequest,
  listMyBookings,
  payBooking,
  downloadReceipt,
} = require("../controllers/bookingController");
const { protect, touristOnly } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/request", protect, touristOnly, createBookingRequest);
router.get("/my", protect, touristOnly, listMyBookings);
router.post("/:bookingId/pay", protect, touristOnly, payBooking);
router.get("/:bookingId/receipt", protect, touristOnly, downloadReceipt);

module.exports = router;
