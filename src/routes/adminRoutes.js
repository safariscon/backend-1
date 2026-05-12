const express = require("express");
const {
  registerHotel,
  registerBusiness,
  connectTour,
  acknowledgeRequest,
  dashboardStats,
  listUsers,
  listHotels,
  listBookings,
  listRooms,
  listHotelRooms,
  getHotelStatus,
  deleteHotel,
  deleteUser,
  purgeVisitors,
} = require("../controllers/adminController");
const { uploadImage } = require("../controllers/uploadController");
const {
  getMarketplaceOverview,
  listSuppliers,
  createSupplier,
  updateSupplierVerification,
  listHotelCatalog,
  upsertHotelServiceByAdmin,
  upgradeHotelMarketplaceProfile,
  createCompositeBooking,
} = require("../controllers/marketplaceAdminController");
const { protect, adminOnly } = require("../middleware/authMiddleware");
const { imageUpload } = require("../middleware/uploadMiddleware");

const router = express.Router();

router.use(protect, adminOnly);

router.post("/register-hotel", registerHotel);
router.post("/register-business", registerBusiness);
router.post("/uploads/image", imageUpload.single("image"), uploadImage);
router.post("/connect-tour", connectTour);
router.post("/acknowledge-request", acknowledgeRequest);
router.get("/dashboard-stats", dashboardStats);
router.get("/users", listUsers);
router.get("/hotels", listHotels);
router.get("/businesses", listHotels);
router.get("/rooms", listRooms);
router.get("/hotels/:hotelId/rooms", listHotelRooms);
router.get("/hotels/:hotelId/status", getHotelStatus);
router.get("/bookings", listBookings);
router.get("/marketplace/overview", getMarketplaceOverview);
router.get("/marketplace/suppliers", listSuppliers);
router.post("/marketplace/suppliers", createSupplier);
router.put("/marketplace/suppliers/:supplierId/verification", updateSupplierVerification);
router.get("/marketplace/catalog", listHotelCatalog);
router.post("/marketplace/bookings", createCompositeBooking);
router.post("/marketplace/services", upsertHotelServiceByAdmin);
router.put("/marketplace/services/:serviceId", upsertHotelServiceByAdmin);
router.put("/marketplace/hotels/:hotelId", upgradeHotelMarketplaceProfile);
router.delete("/hotels/:hotelId", deleteHotel);
router.delete("/users/:userId", deleteUser);
router.delete("/users/visitors/purge", purgeVisitors);

module.exports = router;
