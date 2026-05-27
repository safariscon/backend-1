const express = require("express");
const {
  listPublicHotels,
  listMarketplaceSuppliers,
  listHotelServices,
  verifyBooking,
  publicReceipt,
} = require("../controllers/publicController");

const router = express.Router();

router.get("/hotels", listPublicHotels);
router.get("/hotels/:hotelId/services", listHotelServices);
router.get("/marketplace/suppliers", listMarketplaceSuppliers);
router.get("/marketplace/services", listHotelServices);
router.get("/verify/:token", verifyBooking);
router.get("/receipt/:token", publicReceipt);

module.exports = router;
