const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPublicCatalogFilter, buildAdminServiceFilter } = require("../src/utils/serviceFilters");

test("customer catalog filter uses location, category, and search only", () => {
  const filter = buildPublicCatalogFilter({
    category: "hotel",
    location: "Musanze",
    search: "Kigali",
    providerId: "507f1f77bcf86cd799439011",
    sellerId: "SP123",
  });

  assert.equal(Array.isArray(filter.$and), true);
  assert.equal(String(filter.$and[1].type), String(/hotel/i));
  assert.equal(String(filter.$and[2].$or[0].location), String(/Musanze/i));
  assert.equal(String(filter.$and[3].$or[1].location), String(/Kigali/i));
  assert.equal(JSON.stringify(filter).includes("ownerUserId"), false);
  assert.equal(JSON.stringify(filter).includes("SP123"), false);
});

test("admin service filter can restrict by service provider", () => {
  const ownerUserId = "507f1f77bcf86cd799439011";
  const filter = buildAdminServiceFilter({ category: "tours" }, ownerUserId);
  assert.equal(filter.$and[0].ownerUserId, ownerUserId);
  assert.equal(String(filter.$and[1].type), String(/tours/i));
});
