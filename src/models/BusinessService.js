const mongoose = require("mongoose");
const { PRICING_UNITS, SERVICE_STATUSES } = require("../constants/marketplace");

const reviewSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      default: 5,
    },
    comment: {
      type: String,
      default: "",
      trim: true,
    },
    images: {
      type: [String],
      default: [],
    },
    verifiedBooking: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const businessServiceSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },
    hotelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      default: null,
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
    serviceType: {
      type: String,
      enum: [
        "hotel",
        "car",
        "food",
        "spa",
        "transport",
        "tour",
        "event",
        "rental",
        "restaurant",
        "shopping",
        "childcare",
        "accommodation",
        "wellness",
      ],
      default: "rental",
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    images: {
      type: [String],
      default: [],
    },
    pricing: {
      amount: {
        type: Number,
        default: 0,
        min: 0,
      },
      unit: {
        type: String,
        enum: PRICING_UNITS,
        default: "per_day",
      },
      currency: {
        type: String,
        default: "USD",
        trim: true,
      },
    },
    priceText: {
      type: String,
      default: "",
      trim: true,
    },
    availableQuantity: {
      type: Number,
      default: 1,
      min: 0,
      index: true,
    },
    features: {
      type: [String],
      default: [],
    },
    location: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: SERVICE_STATUSES,
      default: "available",
      index: true,
    },
    rules: {
      type: [String],
      default: [],
    },
    cancellationPolicy: {
      type: String,
      default: "Flexible cancellation. Contact the business for details.",
      trim: true,
    },
    reviews: {
      type: [reviewSchema],
      default: [],
    },
    availabilitySchedule: {
      timezone: {
        type: String,
        default: "Africa/Kigali",
        trim: true,
      },
      alwaysAvailable: {
        type: Boolean,
        default: true,
      },
      windows: {
        type: [
          {
            day: { type: String, default: "", trim: true },
            startTime: { type: String, default: "", trim: true },
            endTime: { type: String, default: "", trim: true },
          },
        ],
        default: [],
      },
      notes: {
        type: String,
        default: "",
        trim: true,
      },
    },
    priceModel: {
      type: {
        type: String,
        default: "fixed",
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
        default: "per_day",
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
  { timestamps: true, collection: "services" }
);

businessServiceSchema.index({ isActive: 1, status: 1, category: 1, title: 1 });
businessServiceSchema.index({ businessId: 1, isActive: 1, category: 1 });

businessServiceSchema.pre("validate", function normalizeServiceFields() {
  this.name = this.name || this.title;
  this.title = this.title || this.name;
  this.serviceType = this.serviceType || this.category || "rental";
  this.hotelId = this.hotelId || this.businessId;
  this.businessId = this.businessId || this.hotelId;
  this.location = this.location || "";
  this.priceModel = {
    type: this.priceModel?.type || "fixed",
    amount: this.pricing?.amount ?? this.priceModel?.amount ?? 0,
    currency: this.pricing?.currency || this.priceModel?.currency || "USD",
    unit: this.pricing?.unit || this.priceModel?.unit || "per_day",
  };
  this.pricing = {
    amount: this.pricing?.amount ?? this.priceModel.amount,
    currency: this.pricing?.currency || this.priceModel.currency,
    unit: this.pricing?.unit || this.priceModel.unit,
  };
  if (this.availableQuantity <= 0 && this.status === "available") {
    this.status = "fully_booked";
  }
});

module.exports = mongoose.model("BusinessService", businessServiceSchema);
