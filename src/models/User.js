const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      default: "",
      trim: true,
    },
    payoutDetails: {
      method: { type: String, default: "", trim: true },
      providerId: { type: String, default: "", trim: true },
      providerName: { type: String, default: "", trim: true },
      accountName: { type: String, default: "", trim: true },
      accountNumber: { type: String, default: "", trim: true },
      msisdn: { type: String, default: "", trim: true },
      instructions: { type: String, default: "", trim: true },
      verified: { type: Boolean, default: false },
      verifiedAccountName: { type: String, default: "", trim: true },
      verifiedAt: { type: Date, default: null },
    },
    password: {
      type: String,
      default: "",
    },
    role: {
      type: String,
      enum: ["admin", "tourist", "hotel", "tourHelper", "supplier", "customer"],
      required: true,
    },
    sellerId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    hotelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      default: null,
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      default: null,
    },
    mustSetPassword: {
      type: Boolean,
      default: false,
      index: true,
    },
    emailVerified: {
      type: Boolean,
      default: false,
      index: true,
    },
    emailVerifiedAt: {
      type: Date,
      default: null,
    },
    emailVerificationOtpHash: {
      type: String,
      default: "",
    },
    emailVerificationOtpExpiresAt: {
      type: Date,
      default: null,
    },
    emailVerificationOtpAttempts: {
      type: Number,
      default: 0,
    },
    emailVerificationOtpSentAt: {
      type: Date,
      default: null,
    },
    passwordResetOtpHash: {
      type: String,
      default: "",
    },
    passwordResetOtpExpiresAt: {
      type: Date,
      default: null,
    },
    passwordResetOtpAttempts: {
      type: Number,
      default: 0,
    },
    passwordResetOtpSentAt: {
      type: Date,
      default: null,
    },
    loginOtpHash: {
      type: String,
      default: "",
    },
    loginOtpExpiresAt: {
      type: Date,
      default: null,
    },
    loginOtpAttempts: {
      type: Number,
      default: 0,
    },
    loginOtpSentAt: {
      type: Date,
      default: null,
    },
    loginRememberMe: {
      type: Boolean,
      default: false,
    },
    refreshTokenHash: {
      type: String,
      default: "",
    },
    refreshTokenExpiresAt: {
      type: Date,
      default: null,
    },
    passwordChangedAt: {
      type: Date,
      default: null,
    },
    termsAccepted: {
      type: Boolean,
      default: false,
      index: true,
    },
    termsAcceptedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
