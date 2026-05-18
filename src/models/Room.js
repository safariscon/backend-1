const mongoose = require("mongoose");
const { ROOM_TYPES } = require("../constants/marketplace");

const roomSchema = new mongoose.Schema(
  {
    hotelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      required: true,
      index: true,
    },
    roomNumber: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      default: "standard",
      trim: true,
    },
    roomType: {
      type: String,
      enum: ROOM_TYPES,
      default: "standard",
      index: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    pricePerNight: {
      type: Number,
      default: null,
      min: 0,
    },
    capacity: {
      adults: {
        type: Number,
        default: 2,
        min: 1,
      },
      children: {
        type: Number,
        default: 0,
        min: 0,
      },
    },
    amenities: {
      type: [String],
      default: [],
    },
    availabilityCalendar: {
      type: [
        {
          date: {
            type: Date,
            default: null,
          },
          startDate: {
            type: Date,
            default: null,
          },
          endDate: {
            type: Date,
            default: null,
          },
          isAvailable: {
            type: Boolean,
            default: true,
          },
          inventory: {
            type: Number,
            default: 1,
            min: 0,
          },
          note: {
            type: String,
            default: "",
            trim: true,
          },
        },
      ],
      default: [],
    },
    smokingAllowed: {
      type: Boolean,
      default: false,
    },
    occupancyType: {
      type: String,
      default: "double",
      trim: true,
    },
    status: {
      type: String,
      enum: ["available", "occupied", "maintenance"],
      default: "available",
      index: true,
    },
  },
  { timestamps: true }
);

roomSchema.index({ hotelId: 1, roomNumber: 1 }, { unique: true });
roomSchema.index({ hotelId: 1, status: 1 });

roomSchema.pre("validate", function syncLegacyPricing(next) {
  if (!this.type && this.roomType) {
    this.type = this.roomType;
  }
  if (!this.roomType && this.type) {
    this.roomType = this.type;
  }
  if (this.pricePerNight === null || this.pricePerNight === undefined) {
    this.pricePerNight = this.price;
  }
  if (this.price === null || this.price === undefined) {
    this.price = this.pricePerNight;
  }
  next();
});

module.exports = mongoose.model("Room", roomSchema);
