const express = require("express");
const {
  getMyHotelOverview,
  listMyBookings,
  listMyRooms,
  listMyServices,
  updateBookingStatus,
  createRoom,
  updateRoom,
  upsertMyService,
  deleteService,
  deleteRoom,
  verifyMyBooking,
} = require("../controllers/hotelController");
const { uploadImages } = require("../controllers/uploadController");
const { protect, hotelOnly } = require("../middleware/authMiddleware");
const { imageUpload } = require("../middleware/uploadMiddleware");

const router = express.Router();

router.get("/overview", protect, hotelOnly, getMyHotelOverview);
router.get("/bookings", protect, hotelOnly, listMyBookings);
router.get("/booking-verification/:lookup", protect, hotelOnly, verifyMyBooking);
router.put("/bookings/:bookingId/status", protect, hotelOnly, updateBookingStatus);
router.get("/rooms", protect, hotelOnly, listMyRooms);
router.get("/services", protect, hotelOnly, listMyServices);
router.post("/uploads/images", protect, hotelOnly, imageUpload.array("images", 3), uploadImages);
router.post("/rooms", protect, hotelOnly, createRoom);
router.put("/rooms/:roomId", protect, hotelOnly, updateRoom);
router.post("/services", protect, hotelOnly, upsertMyService);
router.put("/services/:serviceId", protect, hotelOnly, upsertMyService);
router.delete("/services/:serviceId", protect, hotelOnly, deleteService);
router.delete("/rooms/:roomId", protect, hotelOnly, deleteRoom);

module.exports = router;
