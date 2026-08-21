const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildConsumptionFromInput,
  validateConsumptionAgainstAvailability,
  normalizeAvailabilityPolicy,
  normalizeConsumptionPolicy,
} = require("../src/services/availabilityService");

test("consumption policy requires start date by default", () => {
  const result = buildConsumptionFromInput({
    consumptionPolicy: normalizeConsumptionPolicy({}),
    input: {},
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /start date/i);
});

test("buildConsumptionFromInput sets bookedAt to now and normalizes range", () => {
  const before = Date.now();
  const result = buildConsumptionFromInput({
    consumptionPolicy: normalizeConsumptionPolicy({
      requireConsumptionStartDate: true,
      requireConsumptionEndDate: true,
    }),
    input: {
      consumptionStartDate: "2026-09-01",
      consumptionEndDate: "2026-09-03",
      consumptionStartTime: "10:00",
      consumptionEndTime: "12:00",
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.consumption.consumptionStartDate, "2026-09-01");
  assert.equal(result.consumption.consumptionEndDate, "2026-09-03");
  assert.ok(result.consumption.bookedAt.getTime() >= before);
});

test("validateConsumptionAgainstAvailability rejects outside window", () => {
  const availability = {
    isAnytime: false,
    windowStartDate: "2026-09-01",
    windowEndDate: "2026-09-10",
    daysOfWeek: [],
    dayStartTime: "",
    dayEndTime: "",
    trackCapacity: true,
    capacityRemaining: 2,
  };
  const bad = validateConsumptionAgainstAvailability(availability, {
    consumptionStartDate: "2026-08-30",
    consumptionEndDate: "2026-08-30",
    units: 1,
  });
  assert.equal(bad.ok, false);

  const good = validateConsumptionAgainstAvailability(availability, {
    consumptionStartDate: "2026-09-05",
    consumptionEndDate: "2026-09-05",
    units: 1,
  });
  assert.equal(good.ok, true);
});

test("anytime availability still enforces capacity", () => {
  const result = validateConsumptionAgainstAvailability(
    { isAnytime: true, trackCapacity: true, capacityRemaining: 1 },
    { units: 2 }
  );
  assert.equal(result.ok, false);
  assert.match(result.message, /capacity/i);
});

test("availabilityPolicy defaults are stable", () => {
  const policy = normalizeAvailabilityPolicy({});
  assert.equal(policy.listingRequiresAvailability, false);
  assert.equal(policy.optionRequiresAvailability, false);
  assert.equal(policy.trackCapacity, true);
  assert.equal(policy.modes.dateWindow, true);
});
