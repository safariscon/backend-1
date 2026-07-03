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
} = require("../controllers/publicController");

const router = express.Router();

router.get("/hotels", listPublicHotels);
router.get("/hotels/:hotelId/services", listHotelServices);
router.get("/marketplace/suppliers", listMarketplaceSuppliers);
router.get("/announcement", getAnnouncement);
router.get("/marketplace-settings", getMarketplaceSettings);
router.get("/marketplace/services", listHotelServices);
router.get("/verify/:token", verifyBooking);
router.get("/receipt", (_req, res) => res.status(400).json({ message: "Receipt token is required." }));
router.get("/receipt/:token", publicReceipt);
router.get("/qr/:token", publicQr);

module.exports = router;
