const express = require("express");
const {
  listPublicHotels,
  listMarketplaceSuppliers,
  listHotelServices,
  verifyBooking,
  publicReceipt,
  publicQr,
  getAnnouncement,
  getMarketplaceSettings,
  getPublicServiceAvailability,
  getPublicHotel,
} = require("../controllers/publicController");
const { listReviews, upsertReview } = require("../controllers/reviewController");
const { listPublicCategories, getPublicCategory } = require("../controllers/serviceCategoryController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/hotels", listPublicHotels);
router.get("/hotels/:hotelId/services", listHotelServices);
router.get("/hotels/:hotelId/availability", getPublicServiceAvailability);
router.get("/hotels/:hotelId/reviews", listReviews);
router.post("/hotels/:hotelId/reviews", protect, upsertReview);
router.get("/hotels/:hotelId", getPublicHotel);
router.get("/marketplace/suppliers", listMarketplaceSuppliers);
router.get("/announcement", getAnnouncement);
router.get("/marketplace-settings", getMarketplaceSettings);
router.get("/marketplace/services", listHotelServices);
router.get("/service-categories", listPublicCategories);
router.get("/service-categories/:idOrSlug", getPublicCategory);
router.get("/verify/:token", verifyBooking);
router.get("/receipt", (_req, res) => res.status(400).json({ message: "Receipt token is required." }));
router.get("/receipt/:token", publicReceipt);
router.get("/qr/:token", publicQr);

module.exports = router;
