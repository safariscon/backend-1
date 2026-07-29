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
    passwordChangedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
