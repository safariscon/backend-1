const { LOCATION_SOURCES } = require("../constants/locationSources");

const serviceLocationFields = () => ({
  name: { type: String, default: "", trim: true },
  formattedAddress: { type: String, default: "", trim: true },
  country: { type: String, default: "Rwanda", trim: true },
  province: { type: String, default: "", trim: true },
  district: { type: String, default: "", trim: true, index: true },
  sector: { type: String, default: "", trim: true },
  cell: { type: String, default: "", trim: true },
  village: { type: String, default: "", trim: true },
  fullAddress: { type: String, default: "", trim: true },
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  placeId: { type: String, default: "", trim: true },
  locationSource: {
    type: String,
    enum: LOCATION_SOURCES,
    default: "map_click",
  },
  isExactLocationVerified: { type: Boolean, default: false },
});

module.exports = { serviceLocationFields };
