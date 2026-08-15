const { LOCATION_SOURCES } = require("../constants/locationSources");

const RWANDA_COORDINATE_BOUNDS = {
  minLatitude: -2.9,
  maxLatitude: -1.0,
  minLongitude: 28.8,
  maxLongitude: 31.0,
};

const toCoordinate = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const isCoordinateInsideRwanda = (latitude, longitude) =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  latitude >= RWANDA_COORDINATE_BOUNDS.minLatitude &&
  latitude <= RWANDA_COORDINATE_BOUNDS.maxLatitude &&
  longitude >= RWANDA_COORDINATE_BOUNDS.minLongitude &&
  longitude <= RWANDA_COORDINATE_BOUNDS.maxLongitude;

const serviceLocationHasCoordinates = (serviceLocation = {}) =>
  Number.isFinite(serviceLocation.latitude) && Number.isFinite(serviceLocation.longitude);

const normalizeServiceLocation = (input = {}) => {
  const latitude = toCoordinate(input.latitude);
  const longitude = toCoordinate(input.longitude);
  const locationSource = LOCATION_SOURCES.includes(input.locationSource) ? input.locationSource : "map_click";
  const formattedAddress = String(input.formattedAddress || input.fullAddress || "").trim();
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
  const verifiedExplicit = input.isExactLocationVerified;

  return {
    name: String(input.name || "").trim(),
    formattedAddress,
    country: String(input.country || "Rwanda").trim() || "Rwanda",
    province: String(input.province || "").trim(),
    district: String(input.district || "").trim(),
    sector: String(input.sector || "").trim(),
    cell: String(input.cell || "").trim(),
    village: String(input.village || "").trim(),
    fullAddress: formattedAddress,
    latitude,
    longitude,
    placeId: String(input.placeId || "").trim(),
    locationSource,
    isExactLocationVerified:
      verifiedExplicit === undefined || verifiedExplicit === null
        ? hasCoordinates
        : Boolean(verifiedExplicit),
  };
};

const getPublicLocation = (business = {}) => {
  const source = business.serviceLocation || business.locationDetails || {};
  return {
    country: "Rwanda",
    province: source.province || business.locationDetails?.province || "",
    district: source.district || business.locationDetails?.district || "",
    sector: source.sector || business.locationDetails?.sector || "",
    message: "Pay the full booking amount to unlock exact location and directions.",
  };
};

const getUnlockedServiceLocation = (business = {}) => {
  const source = business.serviceLocation || {};
  const contactDetails = business.contactDetails || {};
  const formattedAddress =
    source.formattedAddress ||
    source.fullAddress ||
    contactDetails.exactAddress ||
    business.location ||
    "";

  return {
    name: source.name || "",
    formattedAddress,
    country: source.country || "Rwanda",
    province: source.province || business.locationDetails?.province || "",
    district: source.district || business.locationDetails?.district || "",
    sector: source.sector || business.locationDetails?.sector || "",
    cell: source.cell || business.locationDetails?.cell || "",
    village: source.village || business.locationDetails?.village || "",
    fullAddress: formattedAddress,
    latitude: source.latitude ?? contactDetails.latitude ?? null,
    longitude: source.longitude ?? contactDetails.longitude ?? null,
    placeId: source.placeId || "",
    locationSource: source.locationSource || "admin_manual",
    isExactLocationVerified: Boolean(source.isExactLocationVerified),
  };
};

module.exports = {
  RWANDA_COORDINATE_BOUNDS,
  isCoordinateInsideRwanda,
  serviceLocationHasCoordinates,
  normalizeServiceLocation,
  getPublicLocation,
  getUnlockedServiceLocation,
};
