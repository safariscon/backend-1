const express = require("express");
const {
  createBookingRequest,
  listMyBookings,
  payBooking,
  downloadReceipt,
} = require("../controllers/bookingController");
const { protect, customerOnly } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/request", protect, customerOnly, createBookingRequest);
router.get("/my", protect, customerOnly, listMyBookings);
router.post("/:bookingId/pay", protect, customerOnly, payBooking);
router.get("/:bookingId/receipt", protect, customerOnly, downloadReceipt);

module.exports = router;
