const PHOTON_BASE_URL = String(process.env.PHOTON_BASE_URL || "https://photon.komoot.io").replace(/\/+$/, "");
const OSRM_BASE_URL = String(process.env.OSRM_BASE_URL || "https://router.project-osrm.org").replace(/\/+$/, "");
const GOOGLE_MAPS_API_KEY = String(process.env.GOOGLE_MAPS_API_KEY || "").trim();
const GEO_USER_AGENT = String(process.env.GEO_USER_AGENT || "SafarisCon/1.0 (geo-proxy; contact=support@safariscon.com)");
const GEO_TIMEOUT_MS = Math.max(2000, Number(process.env.GEO_TIMEOUT_MS || 8000));
const RWANDA_BIAS = { lat: -1.9441, lon: 30.0619 };
const RWANDA_BBOX = "28.8,-2.9,30.9,-1.0";
const SEARCH_CACHE_TTL_MS = 30 * 1000;
const searchCache = new Map();

const usesGoogle = () =>
  String(process.env.GEO_PROVIDER || "photon").toLowerCase() === "google" && Boolean(GOOGLE_MAPS_API_KEY);

const fetchJson = async (url, { headers } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEO_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": GEO_USER_AGENT,
        ...(headers || {}),
      },
    });
    if (!response.ok) {
      const error = new Error(`Upstream geo request failed (${response.status}).`);
      error.status = response.status >= 500 ? 502 : response.status;
      throw error;
    }
    return response.json();
  } catch (error) {
    if (error.name === "AbortError") {
      const timeout = new Error("Location lookup timed out.");
      timeout.status = 504;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const uniqueParts = (parts = []) =>
  [...new Set(parts.map((part) => String(part || "").trim()).filter(Boolean))];

const formatDistance = (meters) => {
  const value = Math.max(0, Number(meters) || 0);
  if (value < 1000) return `${Math.round(value)} m`;
  return `${(value / 1000).toFixed(1)} km`;
};

const formatDuration = (seconds) => {
  const mins = Math.max(1, Math.round(Math.max(0, Number(seconds) || 0) / 60));
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const remaining = mins % 60;
  return remaining ? `${hours} h ${remaining} min` : `${hours} h`;
};

const decodePolyline = (encoded = "") => {
  const coordinates = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push([lng / 1e5, lat / 1e5]);
  }

  return coordinates;
};

const mapPhotonFeature = (feature = {}) => {
  const [longitude, latitude] = Array.isArray(feature.geometry?.coordinates)
    ? feature.geometry.coordinates
    : [null, null];
  const properties = feature.properties || {};
  const name = String(properties.name || properties.street || "").trim();
  const formattedAddress = uniqueParts([
    properties.housenumber && properties.street
      ? `${properties.housenumber} ${properties.street}`
      : properties.street,
    name,
    properties.locality || properties.district,
    properties.city || properties.county,
    properties.state,
    properties.country,
  ]).join(", ");
  const osmType = String(properties.osm_type || "N").toUpperCase().slice(0, 1);
  const osmId = properties.osm_id != null ? String(properties.osm_id) : "";

  return {
    name,
    formattedAddress,
    latitude: Number.isFinite(Number(latitude)) ? Number(latitude) : null,
    longitude: Number.isFinite(Number(longitude)) ? Number(longitude) : null,
    placeId: osmId ? `osm:${osmType}:${osmId}` : "",
    country: properties.country || "Rwanda",
    province: properties.state || properties.province || "",
    district: properties.county || properties.district || properties.city || "",
    sector: properties.locality || properties.city || properties.district || "",
    cell: properties.suburb || "",
    village: properties.village || properties.name || "",
    locationSource: "search",
  };
};

const mapGooglePlace = (place = {}) => {
  const location = place.geometry?.location || {};
  const components = Array.isArray(place.address_components) ? place.address_components : [];
  const component = (type) =>
    components.find((entry) => Array.isArray(entry.types) && entry.types.includes(type))?.long_name || "";

  return {
    name: String(place.name || "").trim(),
    formattedAddress: String(place.formatted_address || place.vicinity || "").trim(),
    latitude: Number.isFinite(Number(location.lat)) ? Number(location.lat) : null,
    longitude: Number.isFinite(Number(location.lng)) ? Number(location.lng) : null,
    placeId: String(place.place_id || "").trim(),
    country: component("country") || "Rwanda",
    province: component("administrative_area_level_1"),
    district: component("administrative_area_level_2") || component("locality"),
    sector: component("sublocality") || component("administrative_area_level_3") || component("neighborhood"),
    cell: component("sublocality_level_2"),
    village: component("sublocality_level_3"),
    locationSource: "search",
  };
};

const getCachedSearch = (key) => {
  const cached = searchCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt < Date.now()) {
    searchCache.delete(key);
    return null;
  }
  return cached.value;
};

const setCachedSearch = (key, value) => {
  searchCache.set(key, { value, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
  if (searchCache.size > 200) {
    const oldest = searchCache.keys().next().value;
    searchCache.delete(oldest);
  }
};

const searchPhoton = async ({ q, country = "rw" }) => {
  const query = country.toLowerCase() === "rw" && !/rwanda/i.test(q) ? `${q}, Rwanda` : q;
  const params = new URLSearchParams({
    q: query,
    limit: "8",
    lang: "en",
    lat: String(RWANDA_BIAS.lat),
    lon: String(RWANDA_BIAS.lon),
    bbox: RWANDA_BBOX,
  });
  const data = await fetchJson(`${PHOTON_BASE_URL}/api/?${params.toString()}`);
  return (data.features || []).map(mapPhotonFeature).filter((item) => item.latitude != null && item.longitude != null);
};

const reversePhoton = async ({ lat, lng }) => {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    lang: "en",
  });
  const data = await fetchJson(`${PHOTON_BASE_URL}/reverse?${params.toString()}`);
  const feature = Array.isArray(data.features) ? data.features[0] : data.features ? data : null;
  return feature ? mapPhotonFeature(feature) : null;
};

const routeOsrm = async ({ fromLat, fromLng, toLat, toLng }) => {
  const path = `${fromLng},${fromLat};${toLng},${toLat}`;
  const params = new URLSearchParams({
    overview: "full",
    geometries: "geojson",
    alternatives: "false",
    steps: "false",
  });
  const data = await fetchJson(`${OSRM_BASE_URL}/route/v1/driving/${path}?${params.toString()}`);
  if (data.code && data.code !== "Ok") {
    const error = new Error(data.message || "No driving route found.");
    error.status = 404;
    throw error;
  }
  const route = data.routes?.[0];
  if (!route) {
    const error = new Error("No driving route found.");
    error.status = 404;
    throw error;
  }
  return {
    distanceMeters: Math.round(Number(route.distance) || 0),
    durationSeconds: Math.round(Number(route.duration) || 0),
    geometry: route.geometry || { type: "LineString", coordinates: [] },
    provider: "osrm",
  };
};

const searchGoogle = async ({ q, country = "rw" }) => {
  const params = new URLSearchParams({
    query: q,
    region: country,
    key: GOOGLE_MAPS_API_KEY,
  });
  const data = await fetchJson(`https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`);
  if (data.status && !["OK", "ZERO_RESULTS"].includes(data.status)) {
    const error = new Error(data.error_message || `Google Places search failed (${data.status}).`);
    error.status = 502;
    throw error;
  }
  return (data.results || []).slice(0, 8).map(mapGooglePlace);
};

const reverseGoogle = async ({ lat, lng }) => {
  const params = new URLSearchParams({
    latlng: `${lat},${lng}`,
    key: GOOGLE_MAPS_API_KEY,
  });
  const data = await fetchJson(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`);
  if (data.status && !["OK", "ZERO_RESULTS"].includes(data.status)) {
    const error = new Error(data.error_message || `Google reverse geocode failed (${data.status}).`);
    error.status = 502;
    throw error;
  }
  const place = data.results?.[0];
  return place ? mapGooglePlace({ ...place, name: place.address_components?.[0]?.long_name || place.formatted_address }) : null;
};

const routeGoogle = async ({ fromLat, fromLng, toLat, toLng }) => {
  const params = new URLSearchParams({
    origin: `${fromLat},${fromLng}`,
    destination: `${toLat},${toLng}`,
    mode: "driving",
    key: GOOGLE_MAPS_API_KEY,
  });
  const data = await fetchJson(`https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`);
  if (data.status && data.status !== "OK") {
    const error = new Error(data.error_message || `Google Directions failed (${data.status}).`);
    error.status = data.status === "ZERO_RESULTS" ? 404 : 502;
    throw error;
  }
  const route = data.routes?.[0];
  const leg = route?.legs?.[0];
  if (!route || !leg) {
    const error = new Error("No driving route found.");
    error.status = 404;
    throw error;
  }
  const coordinates = decodePolyline(route.overview_polyline?.points || "");
  return {
    distanceMeters: Math.round(Number(leg.distance?.value) || 0),
    durationSeconds: Math.round(Number(leg.duration?.value) || 0),
    geometry: { type: "LineString", coordinates },
    provider: "google",
  };
};

const withFallback = async (primary, fallback) => {
  try {
    return await primary();
  } catch (error) {
    if (!usesGoogle()) throw error;
    return fallback();
  }
};

const searchPlaces = async ({ q, country = "rw" }) => {
  const query = String(q || "").trim();
  if (query.length < 2) {
    const error = new Error("Enter at least 2 characters to search.");
    error.status = 400;
    throw error;
  }
  const cacheKey = `${usesGoogle() ? "google" : "photon"}:${country}:${query.toLowerCase()}`;
  const cached = getCachedSearch(cacheKey);
  if (cached) return cached;

  const results = usesGoogle()
    ? await withFallback(() => searchGoogle({ q: query, country }), () => searchPhoton({ q: query, country }))
    : await searchPhoton({ q: query, country });
  const payload = {
    query,
    country,
    provider: usesGoogle() ? "google" : "photon",
    results,
  };
  setCachedSearch(cacheKey, payload);
  return payload;
};

const reverseGeocode = async ({ lat, lng }) => {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    const error = new Error("Latitude and longitude are required.");
    error.status = 400;
    throw error;
  }
  const result = usesGoogle()
    ? await withFallback(() => reverseGoogle({ lat: latitude, lng: longitude }), () => reversePhoton({ lat: latitude, lng: longitude }))
    : await reversePhoton({ lat: latitude, lng: longitude });
  return {
    latitude,
    longitude,
    provider: usesGoogle() ? "google" : "photon",
    result,
  };
};

const getDrivingRoute = async ({ fromLat, fromLng, toLat, toLng }) => {
  const originLat = Number(fromLat);
  const originLng = Number(fromLng);
  const destLat = Number(toLat);
  const destLng = Number(toLng);
  if (![originLat, originLng, destLat, destLng].every(Number.isFinite)) {
    const error = new Error("fromLat, fromLng, toLat, and toLng are required.");
    error.status = 400;
    throw error;
  }

  const routed = usesGoogle()
    ? await withFallback(
        () => routeGoogle({ fromLat: originLat, fromLng: originLng, toLat: destLat, toLng: destLng }),
        () => routeOsrm({ fromLat: originLat, fromLng: originLng, toLat: destLat, toLng: destLng })
      )
    : await routeOsrm({ fromLat: originLat, fromLng: originLng, toLat: destLat, toLng: destLng });

  return {
    from: { latitude: originLat, longitude: originLng },
    to: { latitude: destLat, longitude: destLng },
    distanceMeters: routed.distanceMeters,
    durationSeconds: routed.durationSeconds,
    distanceKm: Number((routed.distanceMeters / 1000).toFixed(1)),
    distanceText: formatDistance(routed.distanceMeters),
    durationText: formatDuration(routed.durationSeconds),
    summary: `${formatDistance(routed.distanceMeters)} · ${formatDuration(routed.durationSeconds)}`,
    geometry: routed.geometry,
    provider: routed.provider,
    mapsUrl: `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${destLat},${destLng}&travelmode=driving`,
    osmUrl: `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${originLat}%2C${originLng}%3B${destLat}%2C${destLng}`,
  };
};

module.exports = {
  mapPhotonFeature,
  mapGooglePlace,
  formatDistance,
  formatDuration,
  decodePolyline,
  searchPlaces,
  reverseGeocode,
  getDrivingRoute,
};
