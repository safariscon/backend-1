const mongoose = require("mongoose");

/**
 * Explicit consumption schedule for a booking.
 * Separate from booking submission time (bookedAt) and free-text bookingAttributes.
 * Used to validate against ServiceAvailability and to block overlapping paid bookings.
 */
const bookingConsumptionSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      unique: true,
      index: true,
    },
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      required: true,
      index: true,
    },
    optionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceOption",
      default: null,
      index: true,
    },
    /** When the customer submitted the booking (always set by server = now) */
    bookedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    /** YYYY-MM-DD — first day the customer will consume the service */
    consumptionStartDate: { type: String, required: true, trim: true, index: true },
    /** YYYY-MM-DD — last day of consumption (same as start when single-day) */
    consumptionEndDate: { type: String, required: true, trim: true, index: true },
    /** HH:mm optional */
    consumptionStartTime: { type: String, default: "", trim: true },
    /** HH:mm optional */
    consumptionEndTime: { type: String, default: "", trim: true },
    /** Combined datetimes for overlap queries */
    consumptionStartAt: { type: Date, required: true, index: true },
    consumptionEndAt: { type: Date, required: true, index: true },
    units: { type: Number, default: 1, min: 1 },
    status: {
      type: String,
      enum: ["pending", "paid", "cancelled", "completed", "expired"],
      default: "pending",
      index: true,
    },
  },
  { timestamps: true }
);

bookingConsumptionSchema.index({ serviceId: 1, optionId: 1, status: 1, consumptionStartAt: 1, consumptionEndAt: 1 });

module.exports = mongoose.model("BookingConsumption", bookingConsumptionSchema);
