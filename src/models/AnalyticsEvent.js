const mongoose = require("mongoose");

const EVENT_TYPES = [
  "APP_VISIT",
  "SERVICE_VIEW",
  "BOOKING_FORM_OPENED",
  "BOOKING_SUBMITTED",
  "PAY_DEPOSIT_CLICKED",
  "PAYMENT_SUCCESS",
  "PAYMENT_FAILED",
];

const analyticsEventSchema = new mongoose.Schema(
  {
    eventType: { type: String, enum: EVENT_TYPES, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    sessionId: { type: String, default: "", trim: true, maxlength: 120, index: true },
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: "Hotel", default: null, index: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", default: null, index: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", default: null, index: true },
    role: { type: String, default: "guest", trim: true, maxlength: 40 },
    pageUrl: { type: String, default: "", trim: true, maxlength: 500 },
    deviceType: { type: String, enum: ["mobile", "tablet", "desktop", "unknown"], default: "unknown" },
    browser: { type: String, default: "Unknown", trim: true, maxlength: 80 },
    ipHash: { type: String, default: "", trim: true, select: false },
  },
  { timestamps: true }
);

analyticsEventSchema.index({ eventType: 1, createdAt: -1 });
analyticsEventSchema.index({ serviceId: 1, eventType: 1, createdAt: -1 });
analyticsEventSchema.index({ userId: 1, createdAt: -1 });
analyticsEventSchema.index({ sessionId: 1, createdAt: -1 });
analyticsEventSchema.index({ createdAt: -1 });

module.exports = mongoose.model("AnalyticsEvent", analyticsEventSchema);
module.exports.EVENT_TYPES = EVENT_TYPES;
