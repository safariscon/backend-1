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
    locationDetails: {
      province: { type: String, default: "", trim: true },
      district: { type: String, default: "", trim: true, index: true },
      sector: { type: String, default: "", trim: true },
      cell: { type: String, default: "", trim: true },
      village: { type: String, default: "", trim: true },
    },
    serviceLocation: {
      country: { type: String, default: "Rwanda", trim: true },
      province: { type: String, default: "", trim: true },
      district: { type: String, default: "", trim: true, index: true },
      sector: { type: String, default: "", trim: true },
      cell: { type: String, default: "", trim: true },
      village: { type: String, default: "", trim: true },
      fullAddress: { type: String, default: "", trim: true },
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      locationSource: {
        type: String,
        enum: ["search", "map_click", "gps", "admin_manual"],
        default: "map_click",
      },
      isExactLocationVerified: { type: Boolean, default: false },
    },
    contactDetails: {
      phone: { type: String, default: "", trim: true },
      whatsapp: { type: String, default: "", trim: true },
      email: { type: String, default: "", trim: true, lowercase: true },
      exactAddress: { type: String, default: "", trim: true },
      googleMapsUrl: { type: String, default: "", trim: true },
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      website: { type: String, default: "", trim: true },
      facebook: { type: String, default: "", trim: true },
      instagram: { type: String, default: "", trim: true },
      x: { type: String, default: "", trim: true },
      tiktok: { type: String, default: "", trim: true },
      registrationDetails: { type: String, default: "", trim: true },
    },
    images: {
      type: [String],
      default: [],
      validate: {
        validator: (images) => Array.isArray(images) && images.length <= 3,
        message: "A service can have no more than 3 images.",
      },
    },
    promotion: {
      enabled: { type: Boolean, default: false, index: true },
      title: { type: String, default: "", trim: true, maxlength: 100 },
      description: { type: String, default: "", trim: true, maxlength: 500 },
      percent: { type: Number, default: 0, min: 0, max: 100 },
      note: { type: String, default: "", trim: true, maxlength: 500 },
      startAt: { type: Date, default: null },
      endAt: { type: Date, default: null },
    },
    rebookSettings: {
      requestDeadlineHours: { type: Number, default: 24, min: 0, max: 2160 },
      rebookIdValidityHours: { type: Number, default: 72, min: 1, max: 2160 },
    },
    promotionHistory: {
      type: [
        {
          title: { type: String, default: "", trim: true },
          description: { type: String, default: "", trim: true },
          startAt: { type: Date, default: null },
          endAt: { type: Date, default: null },
          recordedAt: { type: Date, default: Date.now },
        },
      ],
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
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
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
    availableQuantity: {
      type: Number,
      default: 1,
      min: 0,
    },
    quantityRemaining: {
      type: Number,
      default: 1,
      min: 0,
    },
    priceText: {
      type: String,
      default: "",
      trim: true,
    },
    commissionPercentage: {
      type: Number,
      default: 5,
      min: 0,
      max: 100,
    },
    payoutDetails: {
      method: { type: String, default: "mobile-money", trim: true },
      accountName: { type: String, default: "", trim: true },
      accountNumber: { type: String, default: "", trim: true },
      instructions: { type: String, default: "", trim: true },
    },
    availabilityTable: {
      columns: {
        type: [
          {
            id: {
              type: String,
              required: true,
              trim: true,
            },
            label: {
              type: String,
              required: true,
              trim: true,
            },
          },
        ],
        default: [],
      },
      rows: {
        type: [
          {
            id: {
              type: String,
              required: true,
              trim: true,
            },
            cells: {
              type: mongoose.Schema.Types.Mixed,
              default: {},
            },
          },
        ],
        default: [],
      },
      updatedAt: {
        type: Date,
        default: null,
      },
    },
    bookingMode: {
      type: String,
      enum: ["manual", "automatic"],
      default: "manual",
      index: true,
    },
    bookingForm: {
      title: {
        type: String,
        default: "",
        trim: true,
      },
      description: {
        type: String,
        default: "",
        trim: true,
      },
      isPublished: {
        type: Boolean,
        default: false,
        index: true,
      },
      fields: {
        type: [
          {
            id: { type: String, required: true, trim: true },
            type: {
              type: String,
              enum: [
                "text",
                "textarea",
                "number",
                "email",
                "tel",
                "date",
                "time",
                "datetime-local",
                "select",
                "radio",
                "checkbox",
                "file",
                "url",
              ],
              default: "text",
            },
            label: { type: String, required: true, trim: true },
            placeholder: { type: String, default: "", trim: true },
            helpText: { type: String, default: "", trim: true },
            defaultValue: { type: mongoose.Schema.Types.Mixed, default: "" },
            required: { type: Boolean, default: false },
            enabled: { type: Boolean, default: true },
            validation: {
              min: { type: Number, default: null },
              max: { type: Number, default: null },
              pattern: { type: String, default: "", trim: true },
              maxFileSizeMb: { type: Number, default: 5 },
              acceptedFileTypes: { type: String, default: "", trim: true },
            },
            options: {
              type: [String],
              default: [],
            },
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
    },
    sellerContactEmail: {
      type: String,
      default: "",
      lowercase: true,
      trim: true,
    },
  },
  { timestamps: true }
);

hotelSchema.index({ location: 1, type: 1, createdAt: -1 });
hotelSchema.index({ basePrice: 1, createdAt: -1 });
hotelSchema.index({ approvalStatus: 1, status: 1, createdAt: -1 });
hotelSchema.index({ ownerUserId: 1, createdAt: -1 });

hotelSchema.pre("validate", function rejectInlineImages() {
  const inlineImage = (this.images || []).find((image) =>
    /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(String(image || ""))
  );

  if (inlineImage) {
    throw new Error("Inline base64 images are not allowed. Upload to Cloudinary and save the URL only.");
  }
});

module.exports = mongoose.model("Hotel", hotelSchema);
