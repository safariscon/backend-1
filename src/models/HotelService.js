const mongoose = require("mongoose");
const { PRICE_MODELS } = require("../constants/marketplace");

const hotelServiceSchema = new mongoose.Schema(
  {
    hotelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      required: true,
      index: true,
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      default: null,
      index: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    priceModel: {
      type: {
        type: String,
        enum: PRICE_MODELS,
        default: "free",
      },
      amount: {
        type: Number,
        default: 0,
        min: 0,
      },
      currency: {
        type: String,
        default: "USD",
        trim: true,
      },
      unit: {
        type: String,
        default: "use",
        trim: true,
      },
    },
    availabilitySchedule: {
      timezone: {
        type: String,
        default: "Africa/Kigali",
        trim: true,
      },
      alwaysAvailable: {
        type: Boolean,
        default: false,
      },
      windows: {
        type: [
          {
            day: {
              type: String,
              default: "",
              trim: true,
            },
            startTime: {
              type: String,
              default: "",
              trim: true,
            },
            endTime: {
              type: String,
              default: "",
              trim: true,
            },
          },
        ],
        default: [],
      },
      inventory: {
        type: Number,
        default: 1,
        min: 0,
      },
      notes: {
        type: String,
        default: "",
        trim: true,
      },
    },
    bookingIntegration: {
      bookableWithReservation: {
        type: Boolean,
        default: true,
      },
      requiresSeparateConfirmation: {
        type: Boolean,
        default: false,
      },
      providerReference: {
        type: String,
        default: "",
        trim: true,
      },
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("HotelService", hotelServiceSchema);
