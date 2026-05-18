const mongoose = require("mongoose");
const { HOTEL_TYPES, STAR_RATINGS } = require("../constants/marketplace");

const hotelSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      default: "hotel",
      trim: true,
      index: true,
    },
    location: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    basePrice: {
      type: Number,
      required: true,
      min: 0,
    },
    amenities: {
      type: [String],
      default: [],
    },
    contactInfo: {
      type: String,
      default: "",
      trim: true,
    },
    images: {
      type: [String],
      default: [],
    },
    services: {
      type: [String],
      default: [],
    },
    starRating: {
      type: String,
      enum: STAR_RATINGS,
      default: "unrated",
      index: true,
    },
    hotelType: {
      type: String,
      enum: HOTEL_TYPES,
      default: "boutique",
      index: true,
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      default: null,
      index: true,
    },
    bookingRules: {
      minStay: {
        type: Number,
        default: 0,
        min: 0,
      },
      maxStay: {
        type: Number,
        default: 0,
        min: 0,
      },
      cancellationPolicy: {
        type: {
          type: String,
          default: "moderate",
          trim: true,
        },
        description: {
          type: String,
          default: "",
          trim: true,
        },
      },
    },
    checkInWindow: {
      from: {
        type: String,
        default: "14:00",
        trim: true,
      },
      to: {
        type: String,
        default: "23:00",
        trim: true,
      },
    },
    ownerEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
    },
  },
  { timestamps: true }
);

hotelSchema.index({ location: 1, type: 1, createdAt: -1 });
hotelSchema.index({ basePrice: 1, createdAt: -1 });

hotelSchema.pre("validate", function rejectInlineImages() {
  const inlineImage = (this.images || []).find((image) =>
    /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(String(image || ""))
  );

  if (inlineImage) {
    throw new Error("Inline base64 images are not allowed. Upload to Cloudinary and save the URL only.");
  }
});

module.exports = mongoose.model("Hotel", hotelSchema);
