const mongoose = require("mongoose");

/**
 * Separate availability document for a service (option-less) or a service option.
 * Providers fill this when the category requires availability.
 * Empty windows / days / times mean "anytime" within that dimension.
 */
const serviceAvailabilitySchema = new mongoose.Schema(
  {
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      required: true,
      index: true,
    },
    /** null = listing/service-level availability (option-less services) */
    optionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceOption",
      default: null,
      index: true,
    },
    scope: {
      type: String,
      enum: ["service", "option"],
      required: true,
      index: true,
    },
    /** true = no date/day/time limits (always available) */
    isAnytime: {
      type: Boolean,
      default: false,
    },
    /** YYYY-MM-DD inclusive window start (empty = no start bound) */
    windowStartDate: { type: String, default: "", trim: true },
    /** YYYY-MM-DD inclusive window end (empty = no end bound) */
    windowEndDate: { type: String, default: "", trim: true },
    /** empty = every day; values: mon..sun */
    daysOfWeek: { type: [String], default: [] },
    /** HH:mm open time (empty = no time restriction) */
    dayStartTime: { type: String, default: "", trim: true },
    /** HH:mm close time */
    dayEndTime: { type: String, default: "", trim: true },
    /** Total bookable units (rooms, seats, etc.) */
    capacityTotal: { type: Number, default: 1, min: 0 },
    /** Remaining units after paid bookings */
    capacityRemaining: { type: Number, default: 1, min: 0 },
    trackCapacity: { type: Boolean, default: true },
    timezone: { type: String, default: "Africa/Kigali", trim: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

serviceAvailabilitySchema.index(
  { serviceId: 1, optionId: 1 },
  { unique: true, partialFilterExpression: { optionId: { $type: "objectId" } } }
);
serviceAvailabilitySchema.index(
  { serviceId: 1, scope: 1 },
  { unique: true, partialFilterExpression: { scope: "service", optionId: null } }
);

module.exports = mongoose.model("ServiceAvailability", serviceAvailabilitySchema);
