const mongoose = require("mongoose");
const {
  SUPPLIER_CATEGORIES,
  VERIFICATION_STATUSES,
} = require("../constants/marketplace");

const supplierSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      trim: true,
      index: true,
    },
    category: {
      type: String,
      enum: SUPPLIER_CATEGORIES,
      required: true,
      index: true,
    },
    supplierType: {
      type: String,
      default: "hotel",
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    contact: {
      email: {
        type: String,
        default: "",
        lowercase: true,
        trim: true,
      },
      phone: {
        type: String,
        default: "",
        trim: true,
      },
      website: {
        type: String,
        default: "",
        trim: true,
      },
    },
    address: {
      country: {
        type: String,
        default: "Rwanda",
        trim: true,
      },
      city: {
        type: String,
        default: "",
        trim: true,
        index: true,
      },
      line1: {
        type: String,
        default: "",
        trim: true,
      },
      line2: {
        type: String,
        default: "",
        trim: true,
      },
    },
    verificationStatus: {
      type: String,
      enum: VERIFICATION_STATUSES,
      default: "pending",
      index: true,
    },
    pricing: {
      model: {
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
          default: "use",
          trim: true,
        },
      },
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
        refundWindowHours: {
          type: Number,
          default: 24,
          min: 0,
        },
      },
    },
    commission: {
      percentage: {
        type: Number,
        default: 10,
        min: 0,
      },
      payoutSchedule: {
        type: String,
        default: "monthly",
        trim: true,
      },
    },
    hotelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      default: null,
      index: true,
    },
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    profile: {
      logo: {
        type: String,
        default: "",
        trim: true,
      },
      coverImage: {
        type: String,
        default: "",
        trim: true,
      },
      tags: {
        type: [String],
        default: [],
      },
    },
  },
  { timestamps: true }
);

supplierSchema.index({ verificationStatus: 1, category: 1, createdAt: -1 });

supplierSchema.pre("validate", function rejectInlineProfileImages() {
  const values = [this.profile?.logo, this.profile?.coverImage];
  const inlineImage = values.find((image) =>
    /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(String(image || ""))
  );

  if (inlineImage) {
    throw new Error("Inline base64 profile images are not allowed. Upload to Cloudinary and save the URL only.");
  }
});

module.exports = mongoose.model("Supplier", supplierSchema);
