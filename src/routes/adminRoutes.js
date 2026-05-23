const express = require("express");
const {
  registerHotel,
  registerBusiness,
  assignBooking,
  acknowledgeRequest,
  dashboardStats,
  listUsers,
  listHotels,
  listServices,
  listBookings,
  updateBusinessVerification,
  getHotelStatus,
  deleteHotel,
  deleteUser,
} = require("../controllers/adminController");
const { uploadImage } = require("../controllers/uploadController");
const { createService } = require("../controllers/serviceController");
const { protect, adminOnly } = require("../middleware/authMiddleware");
const { imageUpload } = require("../middleware/uploadMiddleware");

const router = express.Router();

router.use(protect, adminOnly);

router.post("/register-hotel", registerHotel);
router.post("/register-business", registerBusiness);
router.post("/services", createService);
router.post("/uploads/image", imageUpload.single("image"), uploadImage);
router.post("/assign-booking", assignBooking);
router.post("/acknowledge-request", acknowledgeRequest);
router.get("/dashboard-stats", dashboardStats);
router.get("/users", listUsers);
router.get("/hotels", listHotels);
router.get("/businesses", listHotels);
router.get("/hotels/:hotelId/status", getHotelStatus);
router.get("/businesses/:hotelId/status", getHotelStatus);
router.patch("/businesses/:hotelId/verification", updateBusinessVerification);
router.patch("/hotels/:hotelId/verification", updateBusinessVerification);
router.get("/services", listServices);
router.get("/bookings", listBookings);
router.delete("/hotels/:hotelId", deleteHotel);
router.delete("/businesses/:hotelId", deleteHotel);
router.delete("/users/:userId", deleteUser);

module.exports = router;
