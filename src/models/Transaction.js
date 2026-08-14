const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    transactionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      default: null,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: "RWF",
      trim: true,
    },
    commissionAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    commissionStatus: {
      type: String,
      enum: ["pending", "collected", "waived"],
      default: "pending",
      index: true,
    },
    sellerEarnings: {
      type: Number,
      default: 0,
      min: 0,
    },
    platformAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    providerAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    commissionPercentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    paymentMethod: {
      type: String,
      enum: ["mobile-money", "card", "bank-transfer", "cash", "placeholder", "simulation-mobile-money", "simulation-card"],
      default: "placeholder",
    },
    senderAccount: {
      type: String,
      default: "",
      trim: true,
    },
    receiverAccount: {
      type: String,
      default: "SafarisCon Platform",
      trim: true,
    },
    paymentReference: {
      type: String,
      required: true,
      index: true,
    },
    customerRef: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    collectionRef: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    collectionTid: {
      type: String,
      default: "",
      trim: true,
    },
    collectionAuthKey: {
      type: String,
      default: "",
      trim: true,
    },
    collectionStatus: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
      index: true,
    },
    checkoutUrl: {
      type: String,
      default: "",
      trim: true,
    },
    payoutReference: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    payoutInternalRef: {
      type: String,
      default: "",
      trim: true,
    },
    payoutStatus: {
      type: String,
      enum: ["none", "held", "batched", "pending", "successful", "failed", "reversed"],
      default: "none",
      index: true,
    },
    payoutMessage: {
      type: String,
      default: "",
      trim: true,
    },
    payoutProviderId: {
      type: String,
      default: "",
      trim: true,
    },
    refundPayoutReference: {
      type: String,
      default: "",
      trim: true,
    },
    refundPayoutStatus: {
      type: String,
      enum: ["none", "pending", "successful", "failed"],
      default: "none",
    },
    refundPayoutMessage: {
      type: String,
      default: "",
      trim: true,
    },
    verifiedAccountName: {
      type: String,
      default: "",
      trim: true,
    },
    customerPayment: {
      email: { type: String, default: "", trim: true },
      name: { type: String, default: "", trim: true },
      phone: { type: String, default: "", trim: true },
      msisdn: { type: String, default: "", trim: true },
      method: { type: String, default: "", trim: true },
    },
    gatewayRaw: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Transaction", transactionSchema);
