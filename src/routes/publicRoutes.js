const express = require("express");
const {
  listPublicHotels,
  listMarketplaceSuppliers,
  listHotelServices,
} = require("../controllers/publicController");

const router = express.Router();

router.get("/hotels", listPublicHotels);
router.get("/hotels/:hotelId/services", listHotelServices);
router.get("/marketplace/suppliers", listMarketplaceSuppliers);
router.get("/marketplace/services", listHotelServices);

module.exports = router;
