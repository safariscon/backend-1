const mongoose = require("mongoose");

/**
 * Provider-managed closures for an option (or service).
 * Example: 1 of 3 apartments is occupied / closed from 2026-08-25 to 2026-08-29.
 * Dates are hotel-style: start inclusive, end exclusive (checkout day is free).
 */
const availabilityBlockSchema = new mongoose.Schema(
  {
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      required: true,
      index: true,
    },
    optionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceOption",
      default: null,
      index: true,
    },
    startDate: { type: String, required: true, trim: true, index: true },
    endDate: { type: String, required: true, trim: true, index: true },
    units: { type: Number, default: 1, min: 1 },
    note: { type: String, default: "", trim: true, maxlength: 240 },
    source: { type: String, enum: ["provider", "system"], default: "provider" },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

availabilityBlockSchema.index({ serviceId: 1, optionId: 1, isActive: 1, startDate: 1, endDate: 1 });

module.exports = mongoose.model("AvailabilityBlock", availabilityBlockSchema);
