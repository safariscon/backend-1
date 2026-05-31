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
  createSeller,
  updateAnnouncement,
  listServices,
  updateBusinessVerification,
  approveBooking,
  verifyBookingByLookup,
  listTransactions,
  deleteUsers,
  deleteBusiness,
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
router.post("/sellers", createSeller);
router.post("/uploads/image", imageUpload.single("image"), uploadImage);
router.post("/connect-tour", connectTour);
router.post("/acknowledge-request", acknowledgeRequest);
router.get("/dashboard-stats", dashboardStats);
router.put("/announcement", updateAnnouncement);
router.get("/users", listUsers);
router.get("/hotels", listHotels);
router.get("/businesses", listHotels);
router.get("/rooms", listRooms);
router.get("/hotels/:hotelId/rooms", listHotelRooms);
router.get("/hotels/:hotelId/status", getHotelStatus);
router.get("/bookings", listBookings);
router.get("/booking-verification/:lookup", verifyBookingByLookup);
router.put("/bookings/:bookingId/approve", approveBooking);
router.get("/services", listServices);
router.put("/businesses/:businessId/verification", updateBusinessVerification);
router.put("/businesses/:businessId/approval", updateBusinessVerification);
router.delete("/businesses/:businessId", deleteBusiness);
router.get("/transactions", listTransactions);
router.get("/marketplace/overview", getMarketplaceOverview);
router.get("/marketplace/suppliers", listSuppliers);
router.post("/marketplace/suppliers", createSupplier);
router.put("/marketplace/suppliers/:supplierId/verification", updateSupplierVerification);
router.get("/marketplace/catalog", listHotelCatalog);
router.post("/marketplace/bookings", createCompositeBooking);
router.post("/marketplace/services", upsertHotelServiceByAdmin);
router.put("/marketplace/services/:serviceId", upsertHotelServiceByAdmin);
router.put("/marketplace/hotels/:hotelId", upgradeHotelMarketplaceProfile);
router.delete("/users/visitors/purge", purgeVisitors);
router.delete("/users/bulk", deleteUsers);
router.delete("/users/:userId", deleteUser);
router.delete("/hotels/:hotelId", deleteHotel);

module.exports = router;
