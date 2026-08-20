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
