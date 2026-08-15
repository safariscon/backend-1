const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeServiceLocation,
  getPublicLocation,
  getUnlockedServiceLocation,
  isCoordinateInsideRwanda,
} = require("../src/utils/serviceLocation");

test("normalizeServiceLocation stores exact coordinates and search metadata", () => {
  const saved = normalizeServiceLocation({
    name: "Kigali Heights",
    formattedAddress: "KG 7 Ave, Kigali, Rwanda",
    latitude: -1.9497,
    longitude: 30.0919,
    placeId: "osm:N:123",
    locationSource: "search",
    province: "Kigali City",
    district: "Gasabo",
    sector: "Kacyiru",
  });

  assert.equal(saved.name, "Kigali Heights");
  assert.equal(saved.formattedAddress, "KG 7 Ave, Kigali, Rwanda");
  assert.equal(saved.fullAddress, "KG 7 Ave, Kigali, Rwanda");
  assert.equal(saved.latitude, -1.9497);
  assert.equal(saved.longitude, 30.0919);
  assert.equal(saved.placeId, "osm:N:123");
  assert.equal(saved.locationSource, "search");
  assert.equal(saved.isExactLocationVerified, true);
});

test("normalizeServiceLocation accepts map_drag and aliases formattedAddress from fullAddress", () => {
  const saved = normalizeServiceLocation({
    fullAddress: "Dropped pin, Kigali",
    latitude: -1.95,
    longitude: 30.06,
    locationSource: "map_drag",
    isExactLocationVerified: true,
    province: "Kigali City",
    district: "Nyarugenge",
    sector: "Nyamirambo",
  });

  assert.equal(saved.locationSource, "map_drag");
  assert.equal(saved.formattedAddress, "Dropped pin, Kigali");
  assert.equal(saved.fullAddress, "Dropped pin, Kigali");
});

test("Kigali coordinates are inside Rwanda bounds", () => {
  assert.equal(isCoordinateInsideRwanda(-1.9497, 30.0919), true);
  assert.equal(isCoordinateInsideRwanda(0, 0), false);
});

test("public catalog location never includes exact coordinates or place names", () => {
  const publicLocation = getPublicLocation({
    serviceLocation: {
      name: "Kigali Heights",
      formattedAddress: "KG 7 Ave, Kigali, Rwanda",
      latitude: -1.9497,
      longitude: 30.0919,
      placeId: "osm:N:123",
      province: "Kigali City",
      district: "Gasabo",
      sector: "Kacyiru",
    },
  });

  assert.equal(publicLocation.district, "Gasabo");
  assert.equal(publicLocation.latitude, undefined);
  assert.equal(publicLocation.longitude, undefined);
  assert.equal(publicLocation.placeId, undefined);
  assert.equal(publicLocation.name, undefined);
  assert.equal(publicLocation.formattedAddress, undefined);
});

test("unlocked booking location includes coordinates for the customer map", () => {
  const unlocked = getUnlockedServiceLocation({
    serviceLocation: {
      name: "Kigali Heights",
      formattedAddress: "KG 7 Ave, Kigali, Rwanda",
      latitude: -1.9497,
      longitude: 30.0919,
      placeId: "osm:N:123",
      locationSource: "search",
      isExactLocationVerified: true,
      province: "Kigali City",
      district: "Gasabo",
      sector: "Kacyiru",
    },
  });

  assert.equal(unlocked.latitude, -1.9497);
  assert.equal(unlocked.longitude, 30.0919);
  assert.equal(unlocked.placeId, "osm:N:123");
  assert.equal(unlocked.name, "Kigali Heights");
});
