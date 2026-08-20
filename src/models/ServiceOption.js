const mongoose = require("mongoose");

const serviceOptionSchema = new mongoose.Schema(
  {
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: "RWF",
      trim: true,
      uppercase: true,
    },
    priceType: {
      type: String,
      default: "fixed",
      trim: true,
    },
    calculationField: {
      type: String,
      default: "quantity",
      trim: true,
    },
    durationUnit: {
      type: String,
      default: "",
      trim: true,
    },
    maximumDuration: {
      type: Number,
      default: null,
      min: 0,
    },
    capacity: {
      type: Number,
      default: 1,
      min: 0,
    },
    availableFrom: {
      type: String,
      default: "",
      trim: true,
    },
    availableTo: {
      type: String,
      default: "",
      trim: true,
    },
    availableDays: {
      type: [String],
      default: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    },
    availableStartTime: {
      type: String,
      default: "",
      trim: true,
    },
    availableEndTime: {
      type: String,
      default: "",
      trim: true,
    },
    requiresTime: {
      type: Boolean,
      default: false,
    },
    details: {
      type: String,
      default: "",
      trim: true,
    },
    attributes: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

serviceOptionSchema.index({ serviceId: 1, isActive: 1, sortOrder: 1 });

module.exports = mongoose.model("ServiceOption", serviceOptionSchema);
