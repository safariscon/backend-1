const serializeSellerOption = (option = {}) => {
  const data = typeof option.toObject === "function" ? option.toObject() : { ...option };
  return {
    _id: data._id,
    id: data._id,
    serviceId: data.serviceId,
    name: data.name || "",
    price: Number(data.price || 0),
    currency: data.currency || "RWF",
    attributes: data.attributes && typeof data.attributes === "object" ? data.attributes : {},
    sortOrder: Number(data.sortOrder || 0),
    isActive: data.isActive !== false,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
  };
};

const buildOptionEngineDefaults = () => ({
  // Internal defaults for booking/pay engine only — not seller-facing fields.
  priceType: "fixed",
  calculationField: "quantity",
  durationUnit: "",
  maximumDuration: null,
  capacity: 1,
  availableFrom: "",
  availableTo: "",
  availableDays: [],
  availableStartTime: "",
  availableEndTime: "",
  requiresTime: false,
  details: "",
});

module.exports = {
  serializeSellerOption,
  buildOptionEngineDefaults,
};
