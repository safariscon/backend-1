const test = require("node:test");
const assert = require("node:assert/strict");
const { serializePublicOption, mergeOptionsIntoAvailabilityTable } = require("../src/utils/publicInventory");

test("public option remaining falls back to provider quantity", () => {
  const option = serializePublicOption({
    _id: "opt1",
    name: "Entire apartment",
    price: 80000,
    capacity: 1,
    attributes: { quantity: 4, unitType: "studio", maxGuests: 2 },
  });
  assert.equal(option.quantity, 4);
  assert.equal(option.remaining, 4);
  assert.equal(option.attributes.unitType, "studio");
});

test("live availability remaining is preferred for left count", () => {
  const option = serializePublicOption(
    { _id: "opt1", name: "Deluxe", price: 90000, attributes: { quantity: 7 } },
    { capacityRemaining: 2, capacityTotal: 7, trackCapacity: true }
  );
  assert.equal(option.remaining, 2);
  assert.equal(option.quantity, 7);
});

test("availability table rows receive option attributes and remaining", () => {
  const table = mergeOptionsIntoAvailabilityTable(
    { rows: [{ id: "opt1", cells: { service: "Room", price: 1 } }] },
    [{ id: "opt1", name: "King Room", price: 120000, remaining: 5, quantity: 5, attributes: { beds: [{ type: "king", count: 1 }] } }]
  );
  assert.equal(table.rows[0].cells.remaining, 5);
  assert.equal(table.rows[0].attributes.beds[0].type, "king");
});
