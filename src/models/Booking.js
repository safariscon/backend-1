const mongoose = require("mongoose");
const crypto = require("crypto");
const {
  BOOKING_ITEM_TYPES,
  BOOKING_STATUSES,
  PRICING_UNITS,
} = require("../constants/marketplace");

const bookingSchema = new mongoose.Schema(
  {
    bookingCode: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    touristId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    destinationPlace: {
      type: String,
      required: true,
      trim: true,
    },
    destinationLocation: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    preferredHotelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      default: null,
      index: true,
    },
    preferredBusinessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      default: null,
      index: true,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      default: null,
      index: true,
    },
    hotelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      default: null,
      index: true,
    },
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BusinessService",
      default: null,
      index: true,
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      default: null,
      index: true,
    },
    businessType: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    serviceCategory: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    bookingModel: {
      type: String,
      default: "accommodation",
      trim: true,
      index: true,
    },
    pricingModel: {
      type: String,
      enum: ["per_night", "per_hour", "per_trip", "per_person", "fixed", "per_day", "mixed"],
      default: "per_night",
    },
    pricingUnit: {
      type: String,
      default: "night",
      trim: true,
    },
    assignmentType: {
      type: String,
      default: "service",
      trim: true,
    },
    assignmentTargetId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    assignmentLabel: {
      type: String,
      default: "",
      trim: true,
    },
    tourHelpers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    items: {
      type: [
        {
          itemType: {
            type: String,
            enum: BOOKING_ITEM_TYPES,
            default: "service",
          },
          supplierId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Supplier",
            default: null,
          },
          hotelId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Hotel",
            default: null,
          },
          serviceId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "HotelService",
            default: null,
          },
          name: {
            type: String,
            default: "",
            trim: true,
          },
          quantity: {
            type: Number,
            default: 1,
            min: 1,
          },
          pricingUnit: {
            type: String,
            enum: PRICING_UNITS,
            default: "night",
          },
          unitPrice: {
            type: Number,
            default: 0,
            min: 0,
          },
          total: {
            type: Number,
            default: 0,
            min: 0,
          },
          commission: {
            percentage: {
              type: Number,
              default: 0,
              min: 0,
            },
          },
          lockId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "InventoryLock",
            default: null,
          },
        },
      ],
      default: [],
    },
    totalPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    startDate: {
      type: Date,
      default: null,
      index: true,
    },
    endDate: {
      type: Date,
      default: null,
    },
    checkIn: {
      type: Date,
      default: null,
    },
    checkOut: {
      type: Date,
      default: null,
    },
    guests: {
      type: Number,
      default: 1,
      min: 1,
    },
    quantity: {
      type: Number,
      default: 1,
      min: 1,
    },
    reservationDate: {
      type: Date,
      default: null,
    },
    reservationTime: {
      type: String,
      default: "",
      trim: true,
    },
    pickupLocation: {
      type: String,
      default: "",
      trim: true,
    },
    dropoffLocation: {
      type: String,
      default: "",
      trim: true,
    },
    vehicleType: {
      type: String,
      default: "",
      trim: true,
    },
    durationHours: {
      type: Number,
      default: 0,
      min: 0,
    },
    durationDays: {
      type: Number,
      default: 0,
      min: 0,
    },
    packageType: {
      type: String,
      default: "",
      trim: true,
    },
    specialRequests: {
      type: String,
      default: "",
      trim: true,
    },
    bookingDetails: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: BOOKING_STATUSES,
      default: "pending",
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
      index: true,
    },
    bookingStatus: {
      type: String,
      enum: BOOKING_STATUSES,
      default: "pending",
      index: true,
    },
    pricingMode: {
      type: String,
      enum: ["per-night", "per-hour", "per-person", "mixed"],
      default: "per-night",
    },
    cancellation: {
      policyType: {
        type: String,
        default: "moderate",
        trim: true,
      },
      refundableUntil: {
        type: Date,
        default: null,
      },
      cancelledAt: {
        type: Date,
        default: null,
      },
      refundAmount: {
        type: Number,
        default: 0,
        min: 0,
      },
    },
    availabilityLocks: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "InventoryLock",
      },
    ],
    isConnected: {
      type: Boolean,
      default: false,
    },
    adminResponseMessage: {
      type: String,
      default: "",
      trim: true,
    },
    isAcknowledgedByAdmin: {
      type: Boolean,
      default: false,
      index: true,
    },
    acknowledgedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

bookingSchema.index({ status: 1, createdAt: -1 });
bookingSchema.index({ hotelId: 1, status: 1, createdAt: -1 });
bookingSchema.index({ businessId: 1, status: 1, createdAt: -1 });
bookingSchema.index({ touristId: 1, createdAt: -1 });
bookingSchema.index({ userId: 1, createdAt: -1 });
bookingSchema.index({ "items.serviceId": 1, status: 1 });

bookingSchema.pre("validate", function normalizeBookingFields() {
  this.bookingCode =
    this.bookingCode ||
    `BK-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  this.userId = this.userId || this.touristId;
  this.touristId = this.touristId || this.userId;
  this.businessId = this.businessId || this.hotelId || this.preferredBusinessId || this.preferredHotelId;
  this.hotelId = this.hotelId || this.businessId;
  this.preferredBusinessId = this.preferredBusinessId || this.businessId;
  this.preferredHotelId = this.preferredHotelId || this.businessId;
  this.startDate = this.startDate || this.checkIn || this.reservationDate;
  this.endDate = this.endDate || this.checkOut || this.startDate;
  this.bookingStatus = this.bookingStatus || this.status || "pending";
  this.status = this.status || this.bookingStatus || "pending";
});

module.exports = mongoose.model("Booking", bookingSchema);
