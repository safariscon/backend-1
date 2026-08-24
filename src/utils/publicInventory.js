const ServiceOption = require("../models/ServiceOption");
const ServiceAvailability = require("../models/ServiceAvailability");
const { serializeAvailability, normalizeIsoDate } = require("../services/availabilityService");
const {
  isStayLike,
  occupancyKey,
  optionQuantity,
  remainingForStay,
  loadStayOccupancyForServices,
  windowAllowsStay,
} = require("../services/occupancyService");

const optionIdKey = (value) => (value ? String(value) : "");

const stayDatesFromQuery = (query = {}) => {
  const checkIn = normalizeIsoDate(query.checkIn || query.startDate);
  const checkOut = normalizeIsoDate(query.checkOut || query.endDate);
  if (!checkIn || !checkOut || checkOut <= checkIn) return { checkIn: "", checkOut: "" };
  return { checkIn, checkOut };
};

const serializePublicOption = (option = {}, availability = null, context = {}) => {
  const quantity = optionQuantity(option);
  const listing = context.listing || {};
  const stayLike = isStayLike({ listing, option });
  const checkIn = context.checkIn || "";
  const checkOut = context.checkOut || "";
  let remaining = quantity;
  let availableForDates = true;

  if (stayLike && checkIn && checkOut) {
    const window = windowAllowsStay(availability, checkIn, checkOut);
    if (!window.ok) {
      remaining = 0;
      availableForDates = false;
    } else {
      remaining = remainingForStay({
        quantity,
        consumptions: context.consumptions || [],
        blocks: context.blocks || [],
        checkIn,
        checkOut,
      });
      availableForDates = remaining > 0;
    }
  } else if (!stayLike && availability && availability.capacityRemaining != null) {
    remaining = Math.max(0, Math.floor(Number(availability.capacityRemaining)));
  }

  const attributes = option.attributes && typeof option.attributes === "object" ? option.attributes : {};
  return {
    id: option._id,
    _id: option._id,
    optionId: option._id,
    name: option.name || attributes.unitName || "",
    price: Number(option.price || 0),
    currency: option.currency || "RWF",
    priceType: option.priceType || "",
    durationUnit: option.durationUnit || "",
    details: option.details || "",
    capacity: Number(option.capacity || quantity),
    quantity,
    remaining,
    availableForDates,
    availableFrom: option.availableFrom || availability?.windowStartDate || "",
    availableTo: option.availableTo || availability?.windowEndDate || "",
    attributes,
    availability: availability ? serializeAvailability(availability) : null,
    isActive: option.isActive !== false,
  };
};

const attachPublicInventory = async (businesses = [], query = {}) => {
  const list = Array.isArray(businesses) ? businesses.filter(Boolean) : [];
  if (!list.length) return new Map();

  const ids = list.map((item) => item._id || item.id).filter(Boolean);
  const { checkIn, checkOut } = stayDatesFromQuery(query);
  const [options, availabilities, occupancy] = await Promise.all([
    ServiceOption.find({ serviceId: { $in: ids }, isActive: { $ne: false } })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean(),
    ServiceAvailability.find({ serviceId: { $in: ids }, isActive: { $ne: false } }).lean(),
    checkIn && checkOut ? loadStayOccupancyForServices(ids) : Promise.resolve({
      consumptionsByOption: new Map(),
      blocksByOption: new Map(),
    }),
  ]);

  const availabilityByOption = new Map();
  (availabilities || []).forEach((row) => {
    if (row.optionId) availabilityByOption.set(optionIdKey(row.optionId), row);
  });

  const listingById = new Map(list.map((item) => [optionIdKey(item._id || item.id), item]));
  const byService = new Map();
  (options || []).forEach((option) => {
    const key = optionIdKey(option.serviceId);
    const occKey = occupancyKey(option.serviceId, option._id);
    const serialized = serializePublicOption(option, availabilityByOption.get(optionIdKey(option._id)), {
      listing: listingById.get(key) || {},
      checkIn,
      checkOut,
      consumptions: occupancy.consumptionsByOption.get(occKey) || [],
      blocks: occupancy.blocksByOption.get(occKey) || [],
    });
    if (!byService.has(key)) byService.set(key, []);
    byService.get(key).push(serialized);
  });
  return byService;
};

const listingHasStayAvailability = (listing = {}, options = [], query = {}) => {
  const { checkIn, checkOut } = stayDatesFromQuery(query);
  if (!checkIn || !checkOut) return true;
  const stayOptions = (options || []).filter((option) => isStayLike({ listing, option }));
  if (!stayOptions.length) return true;
  return stayOptions.some((option) => Number(option.remaining) > 0);
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
        availableFrom: option.availableFrom,
        availableTo: option.availableTo,
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
          availableFrom: option.availableFrom,
          availableTo: option.availableTo,
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
  stayDatesFromQuery,
  serializePublicOption,
  attachPublicInventory,
  listingHasStayAvailability,
  mergeOptionsIntoAvailabilityTable,
};
