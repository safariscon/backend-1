const express = require("express");
const {
  createRequest,
  listCustomerRequests,
  listSellerRequests,
  listAdminRequests,
  approveRequest,
  rejectRequest,
  approveRefund,
  verifyRebookId,
  confirmUnavailable,
  markSellerNotified,
  getSettings,
  updateSettings,
} = require("../controllers/rebookController");
const { protect, customerOnly, sellerOnly, adminOnly } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/request", protect, customerOnly, createRequest);
router.get("/customer", protect, customerOnly, listCustomerRequests);
router.get("/seller", protect, sellerOnly, listSellerRequests);
router.get("/admin", protect, adminOnly, listAdminRequests);
router.post("/verify-id", protect, customerOnly, verifyRebookId);
router.post("/:id/confirm-unavailable", protect, sellerOnly, confirmUnavailable);
router.post("/:id/approve", protect, adminOnly, approveRequest);
router.post("/:id/reject", protect, adminOnly, rejectRequest);
router.post("/:id/refund", protect, adminOnly, approveRefund);
router.post("/:id/mark-seller-notified", protect, adminOnly, markSellerNotified);
router.get("/settings", protect, getSettings);
router.put("/settings", protect, adminOnly, updateSettings);

module.exports = router;
