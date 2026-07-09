const mongoose = require("mongoose");
const {
  BOOKING_ITEM_TYPES,
  BOOKING_STATUSES,
  PRICING_UNITS,
} = require("../constants/marketplace");

const bookingSchema = new mongoose.Schema(
  {
    touristId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    bookingCode: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    bookingCodeUsed: {
      type: Boolean,
      default: false,
      index: true,
    },
    bookingCodeUsedAt: {
      type: Date,
      default: null,
    },
    anonymousBusinessName: {
      type: String,
      default: "",
      trim: true,
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
      ref: "Hotel",
      default: null,
      index: true,
    },
    hotelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      default: null,
      index: true,
    },
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      default: null,
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      default: null,
      index: true,
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
            default: "room",
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
          roomId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Room",
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
    quantity: {
      type: Number,
      default: 1,
      min: 1,
    },
    amountPaid: {
      type: Number,
      default: 0,
      min: 0,
    },
    depositPercentage: {
      type: Number,
      default: 30,
      min: 0,
      max: 100,
    },
    depositPercent: {
      type: Number,
      default: 30,
      min: 0,
      max: 100,
    },
    depositAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    remainingBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    commissionPercentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    commissionAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "pending", "deposit-paid", "deposit_paid", "paid", "failed", "refunded", "completed"],
      default: "unpaid",
      index: true,
    },
    detailsUnlocked: {
      type: Boolean,
      default: false,
      index: true,
    },
    paymentMethod: {
      type: String,
      default: "",
      trim: true,
    },
    paymentReference: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    verificationCode: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    verificationToken: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    qrPayload: {
      type: String,
      default: "",
      trim: true,
    },
    receipt: {
      receiptNumber: {
        type: String,
        default: "",
        trim: true,
        index: true,
      },
      generatedAt: {
        type: Date,
        default: null,
      },
      contentType: {
        type: String,
        default: "",
        trim: true,
      },
      cloudinaryUrl: { type: String, default: "", trim: true },
      cloudinaryPublicId: { type: String, default: "", trim: true },
      cloudinaryResourceType: { type: String, default: "", trim: true },
      cloudinaryDeliveryType: { type: String, default: "", trim: true },
      cloudinaryFormat: { type: String, default: "pdf", trim: true },
      bytes: { type: Number, default: 0, min: 0 },
      storageStatus: {
        type: String,
        enum: ["pending", "stored", "failed"],
        default: "pending",
      },
      storedAt: { type: Date, default: null },
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
    bookingDetails: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    bookingMode: {
      type: String,
      enum: ["manual", "automatic"],
      default: "manual",
      index: true,
    },
    serviceOptionId: {
      type: String,
      default: "",
      trim: true,
    },
    priceSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    availabilityReservation: {
      status: {
        type: String,
        enum: ["none", "reserved", "paid", "released", "expired"],
        default: "none",
      },
      quantity: { type: Number, default: 0, min: 0 },
      expiresAt: { type: Date, default: null },
    },
    promotionSnapshot: {
      title: { type: String, default: "", trim: true },
      description: { type: String, default: "", trim: true },
      startAt: { type: Date, default: null },
      endAt: { type: Date, default: null },
      appliedAt: { type: Date, default: null },
    },
    status: {
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
    refundStatus: {
      type: String,
      enum: ["none", "pending", "approved", "refunded", "not_applicable"],
      default: "none",
      index: true,
    },
    refundAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    refundReason: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    refundPercentOfDeposit: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancellationReason: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    completionStatus: {
      type: String,
      enum: ["pending", "completed"],
      default: "pending",
      index: true,
    },
    remainingPaymentStatus: {
      type: String,
      enum: ["unpaid", "paid_to_seller"],
      default: "unpaid",
      index: true,
    },
    remainingAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    completedAt: {
      type: Date,
      default: null,
      index: true,
    },
    completedBySeller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    completionAuditLogs: {
      type: [
        {
          event: { type: String, required: true, trim: true },
          message: { type: String, default: "", trim: true },
          actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
          actorRole: { type: String, default: "system", trim: true },
          at: { type: Date, default: Date.now },
        },
      ],
      default: [],
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
    paymentReason: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
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
    originalBookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      default: null,
      index: true,
    },
    rebookRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RebookRequest",
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

bookingSchema.index({ status: 1, createdAt: -1 });
bookingSchema.index({ hotelId: 1, status: 1, createdAt: -1 });
bookingSchema.index({ touristId: 1, createdAt: -1 });
bookingSchema.index({ "items.serviceId": 1, status: 1 });
bookingSchema.index({ bookingCode: 1, verificationToken: 1 });
bookingSchema.index(
  { bookingCode: 1 },
  { unique: true, partialFilterExpression: { bookingCode: { $type: "string", $ne: "" } } }
);
bookingSchema.index({ originalBookingId: 1, rebookRequestId: 1 });

module.exports = mongoose.model("Booking", bookingSchema);
