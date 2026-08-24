const mongoose = require("mongoose");
const { fieldSchemaItem } = require("./fieldSchemaItem");

const serviceCategorySchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    group: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    domain: {
      type: String,
      enum: ["accommodation", "transport", "experiences", "dining", "venues"],
      default: "experiences",
      index: true,
    },
    subtype: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    icon: {
      type: String,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
      index: true,
    },
    supportsOptions: {
      type: Boolean,
      default: true,
    },
    /**
     * Admin toggles: whether providers must configure availability
     * for listing (option-less) and/or options, and which modes apply.
     */
    availabilityPolicy: {
      listingRequiresAvailability: { type: Boolean, default: false },
      optionRequiresAvailability: { type: Boolean, default: false },
      modes: {
        dateWindow: { type: Boolean, default: true },
        daysOfWeek: { type: Boolean, default: true },
        timeOfDay: { type: Boolean, default: true },
      },
      trackCapacity: { type: Boolean, default: true },
    },
    /**
     * Admin toggles for customer consumption schedule on the booking form.
     * bookedAt is always set by the server (now) — not configured here.
     */
    consumptionPolicy: {
      requireConsumptionStartDate: { type: Boolean, default: true },
      requireConsumptionEndDate: { type: Boolean, default: false },
      requireConsumptionStartTime: { type: Boolean, default: false },
      requireConsumptionEndTime: { type: Boolean, default: false },
    },
    listingFieldSchema: {
      type: [fieldSchemaItem()],
      default: [],
    },
    optionFieldSchema: {
      type: [fieldSchemaItem()],
      default: [],
    },
    bookingFieldSchema: {
      type: [fieldSchemaItem()],
      default: [],
    },
    defaults: {
      suggestedCancelWindowHours: {
        type: Number,
        default: 6,
        min: 0,
        max: 2160,
      },
    },
  },
  { timestamps: true }
);

serviceCategorySchema.index({ group: 1, sortOrder: 1, name: 1 });
serviceCategorySchema.index({ isActive: 1, sortOrder: 1 });

module.exports = mongoose.model("ServiceCategory", serviceCategorySchema);
