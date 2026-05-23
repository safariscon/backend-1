const mongoose = require("mongoose");

const businessSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    businessName: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      trim: true,
    },
    businessType: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    type: {
      type: String,
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
      default: "service",
      trim: true,
      index: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      default: "",
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    ownerEmail: {
      type: String,
      lowercase: true,
      trim: true,
    },
    contactInfo: {
      type: String,
      default: "",
      trim: true,
    },
    location: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    latitude: {
      type: Number,
      default: null,
    },
    longitude: {
      type: Number,
      default: null,
    },
    images: {
      type: [String],
      default: [],
    },
    verificationStatus: {
      type: String,
      enum: ["draft", "pending", "verified", "rejected"],
      default: "pending",
      index: true,
    },
    adminReviewMessage: {
      type: String,
      default: "",
      trim: true,
    },
    basePrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    pricingModel: {
      type: String,
      default: "",
      trim: true,
    },
    pricingUnit: {
      type: String,
      default: "",
      trim: true,
    },
    inventoryType: {
      type: String,
      default: "services",
      trim: true,
    },
    assignmentType: {
      type: String,
      default: "service",
      trim: true,
    },
    amenities: {
      type: [String],
      default: [],
    },
    services: {
      type: [String],
      default: [],
    },
    responseTime: {
      type: String,
      default: "Usually replies soon",
      trim: true,
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      default: null,
      index: true,
    },
  },
  { timestamps: true, collection: "businesses" }
);

businessSchema.index({ location: 1, businessType: 1, createdAt: -1 });
businessSchema.index({ basePrice: 1, createdAt: -1 });

businessSchema.pre("validate", function normalizeBusinessFields() {
  this.name = this.name || this.businessName;
  this.businessName = this.businessName || this.name;
  this.type = this.type || this.businessType;
  this.businessType = this.businessType || this.type || "Other";
  this.ownerEmail = this.ownerEmail || this.email;
  this.contactInfo = this.contactInfo || this.phone || this.email;

  const inlineImage = (this.images || []).find((image) =>
    /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(String(image || ""))
  );

  if (inlineImage) {
    throw new Error("Inline base64 images are not allowed. Upload the image and save the URL only.");
  }
});

module.exports = mongoose.model("Business", businessSchema);
