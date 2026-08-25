const test = require("node:test");
const assert = require("node:assert/strict");
const {
  haversineKm,
  parseNearby,
  listingMatchesNearby,
  attachProximity,
} = require("../src/utils/nearbySearch");
const { buildPublicCatalogFilter } = require("../src/utils/serviceFilters");

test("haversine is about 0 for the same point", () => {
  assert.ok(haversineKm(-1.9441, 30.0619, -1.9441, 30.0619) < 0.01);
});

test("haversine puts Kigali and Musanze more than 50km apart", () => {
  const km = haversineKm(-1.9441, 30.0619, -1.4983, 29.635);
  assert.ok(km > 50);
  assert.ok(km < 120);
});

test("parseNearby reads lat, lng, and radius", () => {
  const nearby = parseNearby({ lat: "-1.95", lng: "30.06", radiusKm: "20" });
  assert.equal(nearby.lat, -1.95);
  assert.equal(nearby.lng, 30.06);
  assert.equal(nearby.radiusKm, 20);
  assert.equal(parseNearby({ location: "Kigali" }), null);
});

test("nearby matching uses coordinates even when district text differs", () => {
  const nearby = { lat: -1.7, lng: 29.26, radiusKm: 35 };
  const listing = {
    locationDetails: { district: "Rubavu" },
    catalogLocation: { latitude: -1.7, longitude: 29.26 },
  };
  const result = listingMatchesNearby(listing, nearby, "Gisenyi");
  assert.equal(result.match, true);
  assert.ok(result.distanceKm < 1);
});

test("unpinned listings still match by place name", () => {
  const nearby = { lat: -1.5, lng: 29.63, radiusKm: 35 };
  const listing = {
    locationDetails: { district: "Musanze" },
    catalogLocation: { city: "Musanze", latitude: null, longitude: null },
  };
  assert.equal(listingMatchesNearby(listing, nearby, "Musanze").match, true);
});

test("listings far from the pin are excluded even if names overlap", () => {
  const nearby = { lat: -1.9441, lng: 30.0619, radiusKm: 35 };
  const listing = {
    location: "Kigali mention only",
    catalogLocation: { latitude: -2.4843, longitude: 28.9075, city: "Rusizi" },
  };
  assert.equal(listingMatchesNearby(listing, nearby, "Kigali").match, false);
});

test("attachProximity sorts closer listings first", () => {
  const nearby = { lat: -1.9441, lng: 30.0619, radiusKm: 40 };
  const ranked = attachProximity(
    [
      { _id: "far", catalogLocation: { latitude: -1.98, longitude: 30.12 } },
      { _id: "near", catalogLocation: { latitude: -1.945, longitude: 30.062 } },
    ],
    nearby,
    "Kigali"
  );
  assert.equal(ranked[0]._id, "near");
  assert.ok(ranked[0].distanceKm < ranked[1].distanceKm);
});

test("public catalog skips text location when lat/lng are present", () => {
  const withGeo = buildPublicCatalogFilter({ location: "Musanze", lat: "-1.5", lng: "29.63" });
  assert.equal(JSON.stringify(withGeo).includes("Musanze"), false);

  const textOnly = buildPublicCatalogFilter({ location: "Musanze" });
  assert.equal(String(textOnly.$and[1].$or[0].location), String(/Musanze/i));
});
