const express = require("express");
const { listPaymentCatalog, handleXentripayWebhook } = require("../controllers/paymentController");

const router = express.Router();

router.get("/methods", listPaymentCatalog);
router.get("/providers", listPaymentCatalog);
router.post("/xentripay/webhook", handleXentripayWebhook);

module.exports = router;
