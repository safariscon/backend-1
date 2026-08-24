const express = require("express");
const {
  getMyHotelOverview,
  listMyBookings,
  listMyRooms,
  listMyServices,
  getMyService,
  listMyServiceOptions,
  upsertMyServiceOption,
  deleteMyServiceOption,
  getMyServiceAvailability,
  upsertMyServiceAvailability,
  listMyServiceAvailabilities,
  listMyOptionBlocks,
  createMyOptionBlock,
  deleteMyOptionBlock,
  updateBookingStatus,
  verifyBookingCodeForCompletion,
  completeVerifiedBooking,
  createRoom,
  updateRoom,
  upsertMyService,
  deleteService,
  deleteRoom,
  verifyMyBooking,
} = require("../controllers/hotelController");
const { getMyPayoutDetails, updateMyPayoutDetails, getSellerFinance } = require("../controllers/paymentController");
const { uploadImages } = require("../controllers/uploadController");
const { listPublicCategories, getPublicCategory } = require("../controllers/serviceCategoryController");
const { protect, sellerOnly } = require("../middleware/authMiddleware");
const { imageUpload } = require("../middleware/uploadMiddleware");

const router = express.Router();

router.get("/overview", protect, sellerOnly, getMyHotelOverview);
router.get("/payout-details", protect, sellerOnly, getMyPayoutDetails);
router.put("/payout-details", protect, sellerOnly, updateMyPayoutDetails);
router.get("/finance", protect, sellerOnly, getSellerFinance);
router.get("/bookings", protect, sellerOnly, listMyBookings);
router.post("/bookings/verify-code", protect, sellerOnly, verifyBookingCodeForCompletion);
router.post("/bookings/complete-verified", protect, sellerOnly, completeVerifiedBooking);
router.get("/booking-verification/:lookup", protect, sellerOnly, verifyMyBooking);
router.put("/bookings/:bookingId/status", protect, sellerOnly, updateBookingStatus);
router.get("/rooms", protect, sellerOnly, listMyRooms);
router.get("/service-categories", protect, sellerOnly, listPublicCategories);
router.get("/service-categories/:idOrSlug", protect, sellerOnly, getPublicCategory);
router.get("/services", protect, sellerOnly, listMyServices);
router.get("/services/:serviceId", protect, sellerOnly, getMyService);
router.get("/services/:serviceId/options", protect, sellerOnly, listMyServiceOptions);
router.post("/services/:serviceId/options", protect, sellerOnly, upsertMyServiceOption);
router.put("/services/:serviceId/options/:optionId", protect, sellerOnly, upsertMyServiceOption);
router.delete("/services/:serviceId/options/:optionId", protect, sellerOnly, deleteMyServiceOption);
router.get("/services/:serviceId/availability", protect, sellerOnly, getMyServiceAvailability);
router.get("/services/:serviceId/availabilities", protect, sellerOnly, listMyServiceAvailabilities);
router.put("/services/:serviceId/availability", protect, sellerOnly, upsertMyServiceAvailability);
router.put("/services/:serviceId/options/:optionId/availability", protect, sellerOnly, upsertMyServiceAvailability);
router.get("/services/:serviceId/options/:optionId/blocks", protect, sellerOnly, listMyOptionBlocks);
router.post("/services/:serviceId/options/:optionId/blocks", protect, sellerOnly, createMyOptionBlock);
router.delete("/services/:serviceId/options/:optionId/blocks/:blockId", protect, sellerOnly, deleteMyOptionBlock);
router.post("/uploads/images", protect, sellerOnly, imageUpload.array("images", 5), uploadImages);
router.post("/rooms", protect, sellerOnly, createRoom);
router.put("/rooms/:roomId", protect, sellerOnly, updateRoom);
router.post("/services", protect, sellerOnly, upsertMyService);
router.put("/services/:serviceId", protect, sellerOnly, upsertMyService);
router.delete("/services/:serviceId", protect, sellerOnly, deleteService);
router.delete("/rooms/:roomId", protect, sellerOnly, deleteRoom);

module.exports = router;
