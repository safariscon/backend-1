const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveBookingFieldSchema,
  filterBookingFieldSchema,
  validateAttributesAgainstSchema,
} = require("../src/utils/fieldSchema");

const checkInRequired = {
  id: "checkIn",
  label: "Check-in date",
  type: "date",
  required: true,
  appliesTo: "booking",
  sortOrder: 1,
  options: [],
  validation: {},
};

const guestsOptional = {
  id: "guests",
  label: "Number of guests",
  type: "number",
  required: false,
  appliesTo: "booking",
  sortOrder: 2,
  options: [],
  validation: {},
};

const listingOnly = {
  id: "starRating",
  label: "Star rating",
  type: "select",
  required: true,
  appliesTo: "listing",
  sortOrder: 1,
  options: ["3-star"],
  validation: {},
};

test("resolveBookingFieldSchema prefers live category over stale snapshot with required check-in", () => {
  const schema = resolveBookingFieldSchema({
    liveBookingFieldSchema: [guestsOptional],
    snapshotBookingFieldSchema: [checkInRequired, guestsOptional],
    hasLiveCategory: true,
  });

  assert.equal(schema.length, 1);
  assert.equal(schema[0].id, "guests");
  assert.equal(schema.some((field) => field.id === "checkIn"), false);
});

test("resolveBookingFieldSchema allows empty live category schema (no booking attributes required)", () => {
  const schema = resolveBookingFieldSchema({
    liveBookingFieldSchema: [],
    snapshotBookingFieldSchema: [checkInRequired],
    hasLiveCategory: true,
  });

  assert.deepEqual(schema, []);
});

test("resolveBookingFieldSchema falls back to snapshot when live category is unavailable", () => {
  const schema = resolveBookingFieldSchema({
    liveBookingFieldSchema: undefined,
    snapshotBookingFieldSchema: [checkInRequired],
    hasLiveCategory: false,
  });

  assert.equal(schema.length, 1);
  assert.equal(schema[0].id, "checkIn");
});

test("filterBookingFieldSchema ignores listing/option fields", () => {
  const schema = filterBookingFieldSchema([checkInRequired, listingOnly]);
  assert.equal(schema.length, 1);
  assert.equal(schema[0].id, "checkIn");
});

test("validateAttributesAgainstSchema does not require check-in when it is not configured", () => {
  const result = validateAttributesAgainstSchema(
    {},
    [guestsOptional],
    { label: "bookingAttributes" }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.attributes, {});
});

test("validateAttributesAgainstSchema requires check-in only when configured as required", () => {
  const missing = validateAttributesAgainstSchema(
    {},
    [checkInRequired],
    { label: "bookingAttributes" }
  );
  assert.equal(missing.ok, false);
  assert.match(missing.message, /Check-in date is required/);

  const present = validateAttributesAgainstSchema(
    { checkIn: "2026-08-21" },
    [checkInRequired],
    { label: "bookingAttributes" }
  );
  assert.equal(present.ok, true);
  assert.equal(present.attributes.checkIn, "2026-08-21");
});

test("stale snapshot check-in is ignored when live category no longer includes it", () => {
  const bookingSchema = resolveBookingFieldSchema({
    liveBookingFieldSchema: [],
    snapshotBookingFieldSchema: [checkInRequired],
    hasLiveCategory: true,
  });
  const result = validateAttributesAgainstSchema(
    {},
    bookingSchema,
    { label: "bookingAttributes" }
  );

  assert.equal(result.ok, true);
});
