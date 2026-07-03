const mongoose = require("mongoose");

const STATUS_VALUES = [
  "pending",
  "approved",
  "rejected",
  "rebook_id_generated",
  "used",
  "cancel_requested",
  "refund_requested",
  "refund_approved",
  "expired",
];

const timelineSchema = new mongoose.Schema(
  {
    event: { type: String, required: true, trim: true },
    message: { type: String, default: "", trim: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorRole: { type: String, default: "system", trim: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const rebookRequestSchema = new mongoose.Schema(
  {
    originalBookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, index: true },
    newBookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", default: null, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: "Hotel", required: true, index: true },
    requestType: { type: String, enum: ["rebook", "cancel"], required: true, index: true },
    reason: { type: String, required: true, trim: true, minlength: 3, maxlength: 1500 },
    rebookId: { type: String, trim: true, uppercase: true },
    status: { type: String, enum: STATUS_VALUES, required: true, index: true },
    activeKey: { type: String, trim: true },
    deadlineAt: { type: Date, required: true, index: true },
    expiresAt: { type: Date, default: null, index: true },
    usedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    refundAmount: { type: Number, default: 0, min: 0 },
    refundStatus: {
      type: String,
      enum: ["not_applicable", "pending", "approved"],
      default: "not_applicable",
      index: true,
    },
    refundReference: { type: String, default: "", trim: true },
    sellerNotified: { type: Boolean, default: false, index: true },
    sellerNotifiedAt: { type: Date, default: null },
    sellerConfirmedUnavailable: { type: Boolean, default: false },
    sellerConfirmedUnavailableAt: { type: Date, default: null },
    adminReviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    eligibilitySnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    auditLogs: { type: [timelineSchema], default: [] },
    redemptionClaimToken: { type: String, default: "", select: false },
    redemptionClaimExpiresAt: { type: Date, default: null, select: false },
  },
  { timestamps: true }
);

rebookRequestSchema.index({ rebookId: 1 }, { unique: true, sparse: true });
rebookRequestSchema.index({ activeKey: 1 }, { unique: true, sparse: true });
rebookRequestSchema.index({ customerId: 1, createdAt: -1 });
rebookRequestSchema.index({ sellerId: 1, createdAt: -1 });

module.exports = mongoose.model("RebookRequest", rebookRequestSchema);
module.exports.STATUS_VALUES = STATUS_VALUES;
