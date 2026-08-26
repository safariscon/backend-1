const Booking = require("../models/Booking");
const Hotel = require("../models/Hotel");
const BookingConsumption = require("../models/BookingConsumption");
const { releaseConsumptionCapacity } = require("./availabilityService");

const DEPOSIT_PAID_STATUSES = ["deposit_paid", "deposit-paid", "paid", "completed"];
const TERMINAL_BOOKING_STATUSES = ["cancelled", "rejected", "expired", "completed"];
const UNPAID_HOLD_MS = 15 * 60 * 1000;

const hasDepositPaid = (booking) =>
  Boolean(booking?.detailsUnlocked) || DEPOSIT_PAID_STATUSES.includes(String(booking?.paymentStatus || "").toLowerCase());

const restoreReservedAvailabilityTable = async (booking) => {
  if (booking?.availabilityReservation?.status !== "reserved") return false;
  const quantity = Number(booking.availabilityReservation.quantity || 0);
  const optionId = booking.serviceOptionId;
  const businessId = booking.hotelId || booking.preferredHotelId;
  if (!(quantity > 0) || !optionId || !businessId) return false;
  await Hotel.updateOne(
    { _id: businessId },
    { $inc: { "availabilityTable.rows.$[option].cells.availability": quantity } },
    { arrayFilters: [{ "option.id": optionId }] }
  ).catch(() => {});
  return true;
};

const releaseBookingHold = async (booking, { reservationStatus = "released" } = {}) => {
  if (!booking?._id) return { ok: true, skipped: true };
  await releaseConsumptionCapacity({ bookingId: booking._id });
  if (await restoreReservedAvailabilityTable(booking)) {
    booking.availabilityReservation = {
      ...(typeof booking.availabilityReservation?.toObject === "function"
        ? booking.availabilityReservation.toObject()
        : booking.availabilityReservation || {}),
      status: reservationStatus,
    };
  }
  return { ok: true };
};

const unpaidHoldExpiresAt = (booking, now = new Date()) => {
  if (!booking || hasDepositPaid(booking)) return null;
  const reservationExpires = booking.availabilityReservation?.expiresAt
    ? new Date(booking.availabilityReservation.expiresAt)
    : null;
  const validReservationExpires =
    reservationExpires && !Number.isNaN(reservationExpires.getTime()) ? reservationExpires : null;

  if (booking.availabilityReservation?.status === "reserved" && validReservationExpires) {
    return validReservationExpires;
  }

  if (booking.paymentDeadlineAt) {
    const deadline = new Date(booking.paymentDeadlineAt);
    if (!Number.isNaN(deadline.getTime())) return deadline;
  }

  if (booking.paymentStatus === "failed" || booking.bookingMode === "automatic") {
    if (validReservationExpires) return validReservationExpires;
    const created = new Date(booking.createdAt || now);
    if (Number.isNaN(created.getTime())) return new Date(now.getTime() + UNPAID_HOLD_MS);
    return new Date(created.getTime() + UNPAID_HOLD_MS);
  }

  return null;
};

const shouldExpireUnpaidHold = (booking, now = new Date()) => {
  const expiresAt = unpaidHoldExpiresAt(booking, now);
  return Boolean(expiresAt && expiresAt.getTime() <= now.getTime());
};

const expireUnpaidBookingHold = async (booking, { now = new Date(), reason } = {}) => {
  if (!booking?._id || hasDepositPaid(booking)) return null;

  await releaseBookingHold(booking, { reservationStatus: "expired" });

  const updated = await Booking.findOneAndUpdate(
    {
      _id: booking._id,
      status: { $nin: TERMINAL_BOOKING_STATUSES },
      paymentStatus: { $nin: DEPOSIT_PAID_STATUSES },
    },
    {
      $set: {
        status: "cancelled",
        paymentStatus: "failed",
        ...(booking.availabilityReservation
          ? { "availabilityReservation.status": booking.availabilityReservation.status || "expired" }
          : {}),
        ...(booking.sellerApproval?.status === "pending" ? { "sellerApproval.status": "expired" } : {}),
        adminResponseMessage:
          reason ||
          "Payment was not completed in time. The dates were released. Please make a new booking.",
      },
    },
    { returnDocument: "after" }
  );

  return updated || booking;
};

const runUnpaidBookingHoldCleanup = async ({ now = new Date() } = {}) => {
  const summary = { releasedOrphans: 0, expiredUnpaid: 0 };

  const activeConsumptions = await BookingConsumption.find({
    status: { $in: ["pending", "paid"] },
  })
    .select("bookingId")
    .lean();

  const consumptionBookingIds = [...new Set(activeConsumptions.map((row) => row.bookingId).filter(Boolean))];
  if (consumptionBookingIds.length) {
    const liveBookings = await Booking.find({ _id: { $in: consumptionBookingIds } })
      .select("_id status paymentStatus detailsUnlocked")
      .lean();
    const byId = new Map(liveBookings.map((row) => [String(row._id), row]));
    const seen = new Set();
    for (const row of activeConsumptions) {
      const bookingId = String(row.bookingId || "");
      if (!bookingId || seen.has(bookingId)) continue;
      seen.add(bookingId);
      const booking = byId.get(bookingId);
      if (!booking || TERMINAL_BOOKING_STATUSES.includes(String(booking.status || "").toLowerCase())) {
        await releaseConsumptionCapacity({ bookingId: row.bookingId });
        summary.releasedOrphans += 1;
      }
    }
  }

  const candidates = await Booking.find({
    status: { $nin: TERMINAL_BOOKING_STATUSES },
    paymentStatus: { $nin: DEPOSIT_PAID_STATUSES },
    $or: [
      { "availabilityReservation.status": "reserved", "availabilityReservation.expiresAt": { $lte: now } },
      { paymentDeadlineAt: { $ne: null, $lte: now } },
      { paymentStatus: "failed" },
      { bookingMode: "automatic", createdAt: { $lte: new Date(now.getTime() - UNPAID_HOLD_MS) } },
    ],
  }).limit(100);

  for (const booking of candidates) {
    if (hasDepositPaid(booking) || !shouldExpireUnpaidHold(booking, now)) continue;
    await expireUnpaidBookingHold(booking, { now });
    summary.expiredUnpaid += 1;
  }

  return summary;
};

module.exports = {
  DEPOSIT_PAID_STATUSES,
  TERMINAL_BOOKING_STATUSES,
  UNPAID_HOLD_MS,
  hasDepositPaid,
  releaseBookingHold,
  unpaidHoldExpiresAt,
  shouldExpireUnpaidHold,
  expireUnpaidBookingHold,
  runUnpaidBookingHoldCleanup,
};
