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
} = require("../controllers/hotelController");
const { protect, hotelOnly } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/overview", protect, hotelOnly, getMyHotelOverview);
router.get("/bookings", protect, hotelOnly, listMyBookings);
router.put("/bookings/:bookingId/status", protect, hotelOnly, updateBookingStatus);
router.get("/rooms", protect, hotelOnly, listMyRooms);
router.get("/services", protect, hotelOnly, listMyServices);
router.post("/rooms", protect, hotelOnly, createRoom);
router.put("/rooms/:roomId", protect, hotelOnly, updateRoom);
router.post("/services", protect, hotelOnly, upsertMyService);
router.put("/services/:serviceId", protect, hotelOnly, upsertMyService);
router.delete("/services/:serviceId", protect, hotelOnly, deleteService);
router.delete("/rooms/:roomId", protect, hotelOnly, deleteRoom);

module.exports = router;
