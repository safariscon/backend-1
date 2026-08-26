const test = require("node:test");
const assert = require("node:assert/strict");
const {
  unpaidHoldExpiresAt,
  shouldExpireUnpaidHold,
  UNPAID_HOLD_MS,
} = require("../src/services/bookingHoldService");

test("automatic quote hold expires at the reservation deadline", () => {
  const expiresAt = new Date("2026-08-24T10:00:00.000Z");
  const booking = {
    bookingMode: "automatic",
    paymentStatus: "pending",
    status: "waiting-for-payment",
    availabilityReservation: { status: "reserved", expiresAt },
  };
  assert.equal(unpaidHoldExpiresAt(booking).toISOString(), expiresAt.toISOString());
  assert.equal(shouldExpireUnpaidHold(booking, new Date("2026-08-24T09:59:00.000Z")), false);
  assert.equal(shouldExpireUnpaidHold(booking, new Date("2026-08-24T10:00:00.000Z")), true);
});

test("failed payment does not keep nights after the unpaid hold window", () => {
  const createdAt = new Date("2026-08-24T09:40:00.000Z");
  const booking = {
    bookingMode: "automatic",
    paymentStatus: "failed",
    status: "waiting-for-payment",
    createdAt,
  };
  const expiresAt = unpaidHoldExpiresAt(booking);
  assert.equal(expiresAt.getTime(), createdAt.getTime() + UNPAID_HOLD_MS);
  assert.equal(shouldExpireUnpaidHold(booking, new Date("2026-08-24T09:50:00.000Z")), false);
  assert.equal(shouldExpireUnpaidHold(booking, new Date("2026-08-24T09:56:00.000Z")), true);
});

test("paid bookings are never auto-expired by the unpaid hold timer", () => {
  const booking = {
    bookingMode: "automatic",
    paymentStatus: "deposit_paid",
    detailsUnlocked: true,
    status: "provider-details-unlocked",
    availabilityReservation: { status: "paid", expiresAt: new Date("2026-08-24T10:00:00.000Z") },
  };
  assert.equal(unpaidHoldExpiresAt(booking), null);
  assert.equal(shouldExpireUnpaidHold(booking, new Date("2026-08-24T11:00:00.000Z")), false);
});

test("manual pending bookings waiting for seller approval are not auto-expired", () => {
  const booking = {
    bookingMode: "manual",
    paymentStatus: "unpaid",
    status: "pending",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
  };
  assert.equal(unpaidHoldExpiresAt(booking), null);
  assert.equal(shouldExpireUnpaidHold(booking, new Date("2026-08-24T11:00:00.000Z")), false);
});
