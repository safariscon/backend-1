const express = require("express");
const {
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
  getServiceDetail,
  updateBusinessVerification,
  approveBooking,
  rejectBooking,
  updateMarketplaceSettings,
  updateServiceBookingMode,
  verifyBookingByLookup,
  listTransactions,
  updateCommissionStatus,
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
const { getMongoStorage, getCloudinaryStorage, getStorageOverview } = require("../controllers/storageController");
const { getAnalyticsOverview, getAnalyticsServices, getAnalyticsPayments } = require("../controllers/analyticsController");
const { listPayouts, syncPayout, triggerPayout, triggerAllEligiblePayouts, getAdminFinance } = require("../controllers/paymentController");
const {
  listAdminCategories,
  getAdminCategory,
  createAdminCategory,
  updateAdminCategory,
  updateAdminCategoryFields,
  deleteAdminCategory,
} = require("../controllers/serviceCategoryController");

const router = express.Router();

router.use(protect, adminOnly);

router.post("/register-business", registerBusiness);
router.post("/sellers", createSeller);
router.post("/uploads/image", imageUpload.single("image"), uploadImage);
router.post("/connect-tour", connectTour);
router.post("/acknowledge-request", acknowledgeRequest);
router.get("/dashboard-stats", dashboardStats);
router.get("/storage/mongodb", getMongoStorage);
router.get("/storage/cloudinary", getCloudinaryStorage);
router.get("/storage/overview", getStorageOverview);
router.get("/analytics/overview", getAnalyticsOverview);
router.get("/analytics/services", getAnalyticsServices);
router.get("/analytics/payments", getAnalyticsPayments);
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
router.put("/bookings/:bookingId/reject", rejectBooking);
router.put("/marketplace-settings", updateMarketplaceSettings);
router.put("/businesses/:businessId/booking-mode", updateServiceBookingMode);
router.get("/services", listServices);
router.get("/services/:serviceId", getServiceDetail);
router.put("/services/:serviceId/approval", updateBusinessVerification);
router.patch("/services/:serviceId/approval", updateBusinessVerification);
router.post("/services/:serviceId/approval", updateBusinessVerification);
router.put("/services/:serviceId/verification", updateBusinessVerification);
router.put("/services/:serviceId/approve", updateBusinessVerification);
router.put("/services/:serviceId/reject", updateBusinessVerification);
router.put("/services/:serviceId/booking-mode", updateServiceBookingMode);
router.put("/businesses/:businessId/verification", updateBusinessVerification);
router.put("/businesses/:businessId/approval", updateBusinessVerification);
router.get("/service-categories", listAdminCategories);
router.get("/service-categories/:id", getAdminCategory);
router.post("/service-categories", createAdminCategory);
router.put("/service-categories/:id", updateAdminCategory);
router.put("/service-categories/:id/fields", updateAdminCategoryFields);
router.delete("/service-categories/:id", deleteAdminCategory);
router.delete("/businesses/:businessId", deleteBusiness);
router.get("/transactions", listTransactions);
router.get("/finance", getAdminFinance);
router.get("/payouts", listPayouts);
router.post("/payouts/trigger-all", triggerAllEligiblePayouts);
router.post("/payouts/:transactionId/trigger", triggerPayout);
router.post("/payouts/:transactionId/sync", syncPayout);
router.put("/transactions/:transactionId/commission", updateCommissionStatus);
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
