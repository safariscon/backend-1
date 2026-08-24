const mongoose = require("mongoose");

const categoryBookingDetailSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      unique: true,
      index: true,
    },
    domain: {
      type: String,
      enum: ["accommodation", "transport", "experiences", "dining", "venues"],
      required: true,
      index: true,
    },
    categorySlug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      default: null,
      index: true,
    },
    inventoryId: {
      type: String,
      default: "",
      trim: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

categoryBookingDetailSchema.index({ domain: 1, serviceId: 1, createdAt: -1 });

module.exports = mongoose.model("CategoryBookingDetail", categoryBookingDetailSchema);
