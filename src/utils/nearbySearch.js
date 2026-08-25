const EARTH_RADIUS_KM = 6371;
const DEFAULT_RADIUS_KM = 35;
const MAX_RADIUS_KM = 150;

const toRad = (degrees) => (Number(degrees) * Math.PI) / 180;

const haversineKm = (lat1, lng1, lat2, lng2) => {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const parseNearby = (query = {}) => {
  const lat = Number(query.lat ?? query.latitude);
  const lng = Number(query.lng ?? query.longitude ?? query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const requested = Number(query.radiusKm ?? query.radius ?? DEFAULT_RADIUS_KM);
  const radiusKm = Number.isFinite(requested)
    ? Math.min(MAX_RADIUS_KM, Math.max(1, requested))
    : DEFAULT_RADIUS_KM;
  return { lat, lng, radiusKm };
};

const listingCoordinates = (listing = {}) => {
  const sources = [listing.catalogLocation, listing.serviceLocation, listing.contactDetails];
  for (const source of sources) {
    if (source?.latitude == null || source?.longitude == null || source.latitude === "" || source.longitude === "") {
      continue;
    }
    const lat = Number(source.latitude);
    const lng = Number(source.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }
  return null;
};

const listingSearchText = (listing = {}) =>
  [
    listing.location,
    listing.locationDetails?.province,
    listing.locationDetails?.district,
    listing.locationDetails?.sector,
    listing.locationDetails?.cell,
    listing.serviceLocation?.province,
    listing.serviceLocation?.district,
    listing.serviceLocation?.sector,
    listing.serviceLocation?.formattedAddress,
    listing.serviceLocation?.name,
    listing.catalogLocation?.formattedAddress,
    listing.catalogLocation?.city,
    listing.catalogLocation?.area,
    listing.catalogLocation?.placeName,
    listing.catalogLocation?.state,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const SKIP_TOKENS = new Set(["rwanda", "province", "district", "sector", "city", "area", "the", "and"]);

const listingMatchesLocationText = (listing, location) => {
  const needle = String(location || "").trim().toLowerCase();
  if (!needle) return false;
  const hay = listingSearchText(listing);
  if (!hay) return false;
  if (hay.includes(needle)) return true;
  const tokens = needle
    .split(/[\s,/]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !SKIP_TOKENS.has(token));
  return tokens.some((token) => hay.includes(token));
};

const listingMatchesNearby = (listing, nearby, locationText = "") => {
  if (!nearby) return { match: true, distanceKm: null };
  const coords = listingCoordinates(listing);
  if (coords) {
    const distanceKm = haversineKm(nearby.lat, nearby.lng, coords.lat, coords.lng);
    return {
      match: distanceKm <= nearby.radiusKm,
      distanceKm,
    };
  }
  return {
    match: listingMatchesLocationText(listing, locationText),
    distanceKm: null,
  };
};

const attachProximity = (listings = [], nearby, locationText = "") => {
  if (!nearby) {
    return listings.map((listing) => ({ ...listing, distanceKm: null }));
  }
  return listings
    .map((listing) => {
      const result = listingMatchesNearby(listing, nearby, locationText);
      return {
        ...listing,
        distanceKm: Number.isFinite(result.distanceKm) ? Number(result.distanceKm.toFixed(1)) : null,
        _nearbyMatch: result.match,
      };
    })
    .filter((listing) => listing._nearbyMatch)
    .sort((a, b) => {
      const da = Number.isFinite(a.distanceKm) ? a.distanceKm : Number.POSITIVE_INFINITY;
      const db = Number.isFinite(b.distanceKm) ? b.distanceKm : Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    })
    .map((listing) => {
      const { _nearbyMatch, ...rest } = listing;
      return rest;
    });
};

module.exports = {
  DEFAULT_RADIUS_KM,
  haversineKm,
  parseNearby,
  listingCoordinates,
  listingMatchesLocationText,
  listingMatchesNearby,
  attachProximity,
};
