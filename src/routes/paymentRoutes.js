const express = require("express");
const { listPaymentCatalog } = require("../controllers/paymentController");

const router = express.Router();

router.get("/methods", listPaymentCatalog);
router.get("/providers", listPaymentCatalog);

module.exports = router;
