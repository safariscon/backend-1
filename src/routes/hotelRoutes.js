const express = require("express");
const {
  getMyHotelOverview,
  listMyBookings,
  listMyServices,
  updateBookingStatus,
  upsertMyService,
  deleteService,
} = require("../controllers/hotelController");
const { uploadImages } = require("../controllers/uploadController");
const { protect, hotelOnly } = require("../middleware/authMiddleware");
const { imageUpload } = require("../middleware/uploadMiddleware");

const router = express.Router();

router.get("/overview", protect, hotelOnly, getMyHotelOverview);
router.get("/bookings", protect, hotelOnly, listMyBookings);
router.put("/bookings/:bookingId/status", protect, hotelOnly, updateBookingStatus);
router.get("/services", protect, hotelOnly, listMyServices);
router.post("/uploads/service-images", protect, hotelOnly, imageUpload.array("images", 3), uploadImages);
router.post("/services", protect, hotelOnly, upsertMyService);
router.put("/services/:serviceId", protect, hotelOnly, upsertMyService);
router.delete("/services/:serviceId", protect, hotelOnly, deleteService);

module.exports = router;
