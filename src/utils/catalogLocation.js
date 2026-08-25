const withCatalogGeo = (value = {}) => {
  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    const next = { ...value };
    delete next.geo;
    return next;
  }
  return {
    ...value,
    latitude,
    longitude,
    geo: {
      type: "Point",
      coordinates: [longitude, latitude],
    },
  };
};

const normalizeCatalogLocation = (input = {}) => {
  const latitudeRaw = input.latitudeRaw != null
    ? String(input.latitudeRaw).trim()
    : input.latitude != null
      ? String(input.latitude).trim()
      : "";
  const longitudeRaw = input.longitudeRaw != null
    ? String(input.longitudeRaw).trim()
    : input.longitude != null
      ? String(input.longitude).trim()
      : "";
  const latitude = Number(latitudeRaw);
  const longitude = Number(longitudeRaw);
  const formattedAddress = String(
    input.formattedAddress || input.fullAddress || input.address || ""
  ).trim();
  const country = String(input.country || "Rwanda").trim() || "Rwanda";
  const countryCode = String(input.countryCode || (country.toLowerCase() === "rwanda" ? "RW" : "")).trim().toUpperCase();
  const state = String(input.state || input.province || "").trim();
  const city = String(input.city || input.district || "").trim();
  const area = String(input.area || input.sector || input.locality || "").trim();

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { ok: false, message: "Location latitude and longitude are required from map/search." };
  }
  if (!formattedAddress && !(country && city)) {
    return { ok: false, message: "formattedAddress (or country + city) is required from geocoding." };
  }

  return {
    ok: true,
    value: withCatalogGeo({
      latitude,
      longitude,
      latitudeRaw: latitudeRaw || String(latitude),
      longitudeRaw: longitudeRaw || String(longitude),
      formattedAddress: formattedAddress || [area, city, state, country].filter(Boolean).join(", "),
      country,
      countryCode: countryCode || "RW",
      state,
      city,
      area,
      placeName: String(input.placeName || input.name || "").trim(),
      placeId: String(input.placeId || "").trim(),
      locationSource: String(input.locationSource || "search").trim() || "search",
    }),
  };
};

module.exports = { normalizeCatalogLocation, withCatalogGeo };
