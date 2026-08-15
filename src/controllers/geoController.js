const { searchPlaces, reverseGeocode, getDrivingRoute } = require("../services/geoService");

const sendGeoError = (res, error) => {
  const status = Number(error.status || error.statusCode || 502);
  return res.status(status >= 400 && status < 600 ? status : 502).json({
    message: error.message || "Location lookup failed.",
  });
};

const search = async (req, res) => {
  try {
    const payload = await searchPlaces({
      q: req.query.q || req.query.query || "",
      country: String(req.query.country || "rw").trim().toLowerCase() || "rw",
    });
    return res.json(payload);
  } catch (error) {
    return sendGeoError(res, error);
  }
};

const reverse = async (req, res) => {
  try {
    const payload = await reverseGeocode({
      lat: req.query.lat,
      lng: req.query.lng || req.query.lon,
    });
    return res.json(payload);
  } catch (error) {
    return sendGeoError(res, error);
  }
};

const route = async (req, res) => {
  try {
    const payload = await getDrivingRoute({
      fromLat: req.query.fromLat,
      fromLng: req.query.fromLng,
      toLat: req.query.toLat,
      toLng: req.query.toLng,
    });
    return res.json(payload);
  } catch (error) {
    return sendGeoError(res, error);
  }
};

module.exports = { search, reverse, route };
