const test = require("node:test");
const assert = require("node:assert/strict");
const {
  eachNight,
  remainingForStay,
  windowAllowsStay,
  isStayLike,
} = require("../src/services/occupancyService");
const { serializePublicOption, listingHasStayAvailability } = require("../src/utils/publicInventory");

test("stay nights are check-in inclusive and check-out exclusive", () => {
  assert.deepEqual(eachNight("2026-08-25", "2026-08-29"), [
    "2026-08-25",
    "2026-08-26",
    "2026-08-27",
    "2026-08-28",
  ]);
});

test("one booked stay does not consume remaining on later dates", () => {
  const consumptions = [{ consumptionStartDate: "2026-08-25", consumptionEndDate: "2026-08-29", units: 1 }];
  assert.equal(
    remainingForStay({ quantity: 1, consumptions, checkIn: "2026-08-25", checkOut: "2026-08-29" }),
    0
  );
  assert.equal(
    remainingForStay({ quantity: 1, consumptions, checkIn: "2026-08-29", checkOut: "2026-09-02" }),
    1
  );
  assert.equal(
    remainingForStay({ quantity: 1, consumptions, checkIn: "2026-08-20", checkOut: "2026-08-25" }),
    1
  );
});

test("quantity of identical units leaves remaining after one overlapping booking", () => {
  const remaining = remainingForStay({
    quantity: 3,
    consumptions: [{ consumptionStartDate: "2026-08-25", consumptionEndDate: "2026-08-29", units: 1 }],
    checkIn: "2026-08-25",
    checkOut: "2026-08-29",
  });
  assert.equal(remaining, 2);
});

test("provider closed dates reduce remaining for overlapping nights only", () => {
  const blocks = [{ startDate: "2026-08-26", endDate: "2026-08-28", units: 1 }];
  assert.equal(
    remainingForStay({ quantity: 1, blocks, checkIn: "2026-08-26", checkOut: "2026-08-27" }),
    0
  );
  assert.equal(
    remainingForStay({ quantity: 1, blocks, checkIn: "2026-08-28", checkOut: "2026-08-30" }),
    1
  );
});

test("stay window allows checkout on the available-until date", () => {
  const availability = { isAnytime: false, windowStartDate: "2026-08-01", windowEndDate: "2026-08-31" };
  assert.equal(windowAllowsStay(availability, "2026-08-25", "2026-08-31").ok, true);
  assert.equal(windowAllowsStay(availability, "2026-08-25", "2026-09-01").ok, false);
});

test("apartments are stay-like even without nights duration unit", () => {
  assert.equal(isStayLike({ listing: { type: "apartment" }, option: {} }), true);
  assert.equal(isStayLike({ listing: { domain: "accommodation" }, option: {} }), true);
  assert.equal(isStayLike({ option: { durationUnit: "nights" } }), true);
});

test("stay options ignore global leftover remaining without requested dates", () => {
  const option = serializePublicOption(
    { _id: "opt1", name: "Entire apartment", price: 80000, attributes: { quantity: 1 }, durationUnit: "nights" },
    { capacityRemaining: 0, capacityTotal: 1, trackCapacity: true },
    { listing: { domain: "accommodation" } }
  );
  assert.equal(option.remaining, 1);
});

test("stay listing is hidden when requested dates have no remaining options", () => {
  const listing = { domain: "accommodation", type: "apartment" };
  const sold = [{ remaining: 0, durationUnit: "nights" }];
  assert.equal(
    listingHasStayAvailability(listing, sold, { checkIn: "2026-08-25", checkOut: "2026-08-29" }),
    false
  );
  assert.equal(
    listingHasStayAvailability(listing, [{ remaining: 1, durationUnit: "nights" }], {
      checkIn: "2026-08-25",
      checkOut: "2026-08-29",
    }),
    true
  );
});
