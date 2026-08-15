const test = require("node:test");
const assert = require("node:assert/strict");
const {
  mapPhotonFeature,
  formatDistance,
  formatDuration,
  searchPlaces,
  reverseGeocode,
  getDrivingRoute,
} = require("../src/services/geoService");
const { search, reverse, route } = require("../src/controllers/geoController");

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const photonFeature = {
  geometry: { coordinates: [30.0919, -1.9497], type: "Point" },
  properties: {
    osm_id: 12345,
    osm_type: "N",
    name: "Kigali Heights",
    street: "KG 7 Ave",
    city: "Kigali",
    state: "Kigali City",
    country: "Rwanda",
    county: "Gasabo",
  },
};

test("Photon features map to the frontend serviceLocation shape", () => {
  const mapped = mapPhotonFeature(photonFeature);
  assert.equal(mapped.name, "Kigali Heights");
  assert.equal(mapped.latitude, -1.9497);
  assert.equal(mapped.longitude, 30.0919);
  assert.equal(mapped.placeId, "osm:N:12345");
  assert.equal(mapped.locationSource, "search");
  assert.match(mapped.formattedAddress, /Kigali Heights/);
});

test("route summaries use km and minutes", () => {
  assert.equal(formatDistance(4700), "4.7 km");
  assert.equal(formatDuration(780), "13 min");
});

test("searchPlaces rejects short queries without calling Photon", async () => {
  await assert.rejects(() => searchPlaces({ q: "K" }), (error) => error.status === 400);
});

test("searchPlaces proxies Photon and returns coordinates", async (context) => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.match(String(url), /photon\.komoot\.io\/api\//);
    assert.doesNotMatch(String(url), /nominatim/i);
    return {
      ok: true,
      json: async () => ({ features: [photonFeature] }),
    };
  };
  context.after(() => {
    global.fetch = originalFetch;
  });

  const payload = await searchPlaces({ q: "Kigali Heights", country: "rw" });
  assert.equal(payload.provider, "photon");
  assert.equal(payload.results[0].latitude, -1.9497);
  assert.equal(payload.results[0].placeId, "osm:N:12345");
});

test("reverseGeocode proxies Photon reverse", async (context) => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.match(String(url), /photon\.komoot\.io\/reverse/);
    return {
      ok: true,
      json: async () => ({ features: [photonFeature] }),
    };
  };
  context.after(() => {
    global.fetch = originalFetch;
  });

  const payload = await reverseGeocode({ lat: -1.9497, lng: 30.0919 });
  assert.equal(payload.result.name, "Kigali Heights");
});

test("getDrivingRoute proxies OSRM and returns distance, time, and geometry", async (context) => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.match(String(url), /router\.project-osrm\.org\/route\/v1\/driving\//);
    return {
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [
          {
            distance: 4700,
            duration: 780,
            geometry: { type: "LineString", coordinates: [[30.06, -1.94], [30.09, -1.95]] },
          },
        ],
      }),
    };
  };
  context.after(() => {
    global.fetch = originalFetch;
  });

  const payload = await getDrivingRoute({
    fromLat: -1.944,
    fromLng: 30.061,
    toLat: -1.9497,
    toLng: 30.0919,
  });
  assert.equal(payload.distanceMeters, 4700);
  assert.equal(payload.durationSeconds, 780);
  assert.equal(payload.summary, "4.7 km · 13 min");
  assert.equal(payload.geometry.type, "LineString");
  assert.ok(payload.mapsUrl.includes("google.com/maps/dir"));
});

test("geo controllers expose the frontend contract", async (context) => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/api/?")) {
      return { ok: true, json: async () => ({ features: [photonFeature] }) };
    }
    if (target.includes("/reverse")) {
      return { ok: true, json: async () => ({ features: [photonFeature] }) };
    }
    return {
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [{ distance: 1200, duration: 240, geometry: { type: "LineString", coordinates: [] } }],
      }),
    };
  };
  context.after(() => {
    global.fetch = originalFetch;
  });

  const searchRes = response();
  await search({ query: { q: "Kigali Heights", country: "rw" } }, searchRes);
  assert.equal(searchRes.statusCode, 200);
  assert.equal(searchRes.body.results[0].longitude, 30.0919);

  const reverseRes = response();
  await reverse({ query: { lat: "-1.9497", lng: "30.0919" } }, reverseRes);
  assert.equal(reverseRes.statusCode, 200);
  assert.equal(reverseRes.body.result.placeId, "osm:N:12345");

  const routeRes = response();
  await route(
    { query: { fromLat: "-1.94", fromLng: "30.06", toLat: "-1.95", toLng: "30.09" } },
    routeRes
  );
  assert.equal(routeRes.statusCode, 200);
  assert.equal(routeRes.body.durationText, "4 min");
});
