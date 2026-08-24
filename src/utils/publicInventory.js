const ServiceOption = require("../models/ServiceOption");
const ServiceAvailability = require("../models/ServiceAvailability");
const { serializeAvailability } = require("../services/availabilityService");

const optionIdKey = (value) => (value ? String(value) : "");

const optionQuantity = (option = {}) =>
  Math.max(1, Math.floor(Number(option.attributes?.quantity || option.capacity || 1) || 1));

const serializePublicOption = (option = {}, availability = null) => {
  const quantity = optionQuantity(option);
  const remaining =
    availability && availability.capacityRemaining != null
      ? Math.max(0, Math.floor(Number(availability.capacityRemaining)))
      : quantity;
  const attributes = option.attributes && typeof option.attributes === "object" ? option.attributes : {};
  return {
    id: option._id,
    _id: option._id,
    optionId: option._id,
    name: option.name || attributes.unitName || "",
    price: Number(option.price || 0),
    currency: option.currency || "RWF",
    priceType: option.priceType || "",
    details: option.details || "",
    capacity: Number(option.capacity || quantity),
    quantity,
    remaining,
    attributes,
    availability: availability ? serializeAvailability(availability) : null,
    isActive: option.isActive !== false,
  };
};

const attachPublicInventory = async (businesses = []) => {
  const list = Array.isArray(businesses) ? businesses.filter(Boolean) : [];
  if (!list.length) return new Map();

  const ids = list.map((item) => item._id || item.id).filter(Boolean);
  const [options, availabilities] = await Promise.all([
    ServiceOption.find({ serviceId: { $in: ids }, isActive: { $ne: false } })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean(),
    ServiceAvailability.find({ serviceId: { $in: ids }, isActive: { $ne: false } }).lean(),
  ]);

  const availabilityByOption = new Map();
  (availabilities || []).forEach((row) => {
    if (row.optionId) availabilityByOption.set(optionIdKey(row.optionId), row);
  });

  const byService = new Map();
  (options || []).forEach((option) => {
    const key = optionIdKey(option.serviceId);
    const serialized = serializePublicOption(option, availabilityByOption.get(optionIdKey(option._id)));
    if (!byService.has(key)) byService.set(key, []);
    byService.get(key).push(serialized);
  });
  return byService;
};

const mergeOptionsIntoAvailabilityTable = (table = {}, options = []) => {
  const optionById = new Map((options || []).map((option) => [optionIdKey(option.id || option._id), option]));
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  const mergedRows = rows.map((row) => {
    const option = optionById.get(optionIdKey(row.optionId || row.id));
    if (!option) return row;
    return {
      ...row,
      optionId: option.id || option._id,
      attributes: option.attributes || row.attributes || {},
      cells: {
        ...(row.cells || {}),
        service: option.name || row.cells?.service,
        price: option.price,
        details: option.details || row.cells?.details || "",
        availability: option.remaining,
        quantity: option.quantity,
        remaining: option.remaining,
        attributes: option.attributes || {},
      },
    };
  });

  if (!mergedRows.length && options.length) {
    return {
      columns: table?.columns || [],
      rows: options.map((option) => ({
        id: String(option.id || option._id),
        optionId: option.id || option._id,
        attributes: option.attributes || {},
        cells: {
          service: option.name,
          price: option.price,
          details: option.details || "",
          availability: option.remaining,
          quantity: option.quantity,
          remaining: option.remaining,
          attributes: option.attributes || {},
        },
      })),
      updatedAt: table?.updatedAt || null,
    };
  }

  return { ...table, rows: mergedRows };
};

module.exports = {
  optionQuantity,
  serializePublicOption,
  attachPublicInventory,
  mergeOptionsIntoAvailabilityTable,
};
