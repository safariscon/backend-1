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
    priceText: {
      type: String,
      default: "",
      trim: true,
    },
    images: {
      type: [String],
      default: [],
    },
    availabilityTable: {
      columns: {
        type: [
          {
            id: { type: String, required: true, trim: true },
            label: { type: String, required: true, trim: true },
          },
        ],
        default: [],
      },
      rows: {
        type: [
          {
            id: { type: String, required: true, trim: true },
            cells: { type: mongoose.Schema.Types.Mixed, default: {} },
          },
        ],
        default: [],
      },
      updatedAt: {
        type: Date,
        default: null,
      },
    },
    inventoryStatus: {
      type: String,
      enum: ["available", "limited", "fully-booked", "out-of-stock", "temporarily-unavailable"],
      default: "available",
      index: true,
    },
    approvalStatus: {
      type: String,
      enum: ["draft", "pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    status: {
      type: String,
      enum: ["available", "unavailable", "paused"],
      default: "available",
      index: true,
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

hotelServiceSchema.index({ isActive: 1, category: 1, name: 1 });
hotelServiceSchema.index({ hotelId: 1, isActive: 1, category: 1 });
hotelServiceSchema.index({ approvalStatus: 1, status: 1, isActive: 1 });

module.exports = mongoose.model("HotelService", hotelServiceSchema);
