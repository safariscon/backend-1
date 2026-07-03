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
const { protect, sellerOnly } = require("../middleware/authMiddleware");
const { imageUpload } = require("../middleware/uploadMiddleware");

const router = express.Router();

router.get("/overview", protect, sellerOnly, getMyHotelOverview);
router.get("/bookings", protect, sellerOnly, listMyBookings);
router.get("/booking-verification/:lookup", protect, sellerOnly, verifyMyBooking);
router.put("/bookings/:bookingId/status", protect, sellerOnly, updateBookingStatus);
router.get("/rooms", protect, sellerOnly, listMyRooms);
router.get("/services", protect, sellerOnly, listMyServices);
router.post("/uploads/images", protect, sellerOnly, imageUpload.array("images", 3), uploadImages);
router.post("/rooms", protect, sellerOnly, createRoom);
router.put("/rooms/:roomId", protect, sellerOnly, updateRoom);
router.post("/services", protect, sellerOnly, upsertMyService);
router.put("/services/:serviceId", protect, sellerOnly, upsertMyService);
router.delete("/services/:serviceId", protect, sellerOnly, deleteService);
router.delete("/rooms/:roomId", protect, sellerOnly, deleteRoom);

module.exports = router;
