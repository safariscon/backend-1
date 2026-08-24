const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema(
  {
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    verifiedStay: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

reviewSchema.index({ serviceId: 1, userId: 1 }, { unique: true });
reviewSchema.index({ serviceId: 1, createdAt: -1 });

module.exports = mongoose.model("Review", reviewSchema);
