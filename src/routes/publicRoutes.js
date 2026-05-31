const express = require("express");
const {
  listPublicHotels,
  listMarketplaceSuppliers,
  listHotelServices,
  verifyBooking,
  publicReceipt,
  getAnnouncement,
} = require("../controllers/publicController");

const router = express.Router();

router.get("/hotels", listPublicHotels);
router.get("/hotels/:hotelId/services", listHotelServices);
router.get("/marketplace/suppliers", listMarketplaceSuppliers);
router.get("/announcement", getAnnouncement);
router.get("/marketplace/services", listHotelServices);
router.get("/verify/:token", verifyBooking);
router.get("/receipt", (_req, res) => res.status(400).json({ message: "Receipt token is required." }));
router.get("/receipt/:token", publicReceipt);

module.exports = router;
