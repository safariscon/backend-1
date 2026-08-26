const AvailabilityBlock = require("../models/AvailabilityBlock");
const Booking = require("../models/Booking");
const BookingConsumption = require("../models/BookingConsumption");
const { normalizeIsoDate } = require("./availabilityService");

const ACTIVE_CONSUMPTION_STATUSES = ["pending", "paid"];
const TERMINAL_BOOKING_STATUSES = ["cancelled", "rejected", "expired"];

const consumptionCountsTowardOccupancy = (consumption = {}, booking = null) => {
  if (!booking) return false;
  const bookingStatus = String(booking.status || "").toLowerCase();
  if (TERMINAL_BOOKING_STATUSES.includes(bookingStatus)) return false;
  return ACTIVE_CONSUMPTION_STATUSES.includes(String(consumption.status || "").toLowerCase());
};

const consumptionsHeldByLiveBookings = async (consumptions = []) => {
  const ids = [...new Set((consumptions || []).map((row) => row.bookingId).filter(Boolean))];
  if (!ids.length) return [];
  const live = await Booking.find({
    _id: { $in: ids },
    status: { $nin: TERMINAL_BOOKING_STATUSES },
  })
    .select("_id")
    .lean();
  const liveIds = new Set(live.map((row) => String(row._id)));
  return (consumptions || []).filter((row) => liveIds.has(String(row.bookingId)));
};

const addDays = (iso, days) => {
  const date = new Date(`${iso}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
};

const eachNight = (checkIn, checkOut) => {
  const start = normalizeIsoDate(checkIn);
  const end = normalizeIsoDate(checkOut);
  if (!start || !end || end <= start) return [];
  const nights = [];
  let cursor = start;
  while (cursor < end) {
    nights.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return nights;
};

const optionQuantity = (option = {}) =>
  Math.max(1, Math.floor(Number(option.attributes?.quantity || option.capacity || option.quantity || 1) || 1));

const isStayLike = ({ listing = {}, option = {}, domain } = {}) => {
  if (domain === "accommodation") return true;
  if (listing.domain === "accommodation") return true;
  const slug = String(listing.categorySlug || listing.type || listing.subtype || "").toLowerCase();
  if (/(hotel|apartment|homestay|guest-house|hostel|villa|lodge)/.test(slug)) return true;
  if (domain === "transport" || listing.domain === "transport") {
    if (/(car-rental|car-rentals|^cars$|motorbike)/.test(slug)) return true;
  }
  if (/(car-rental|car-rentals)/.test(slug) || slug === "motorbike" || slug === "motorbike-and-scooter-rentals") {
    return true;
  }
  const unit = String(option.durationUnit || "").toLowerCase();
  const priceType = String(option.priceType || "").toLowerCase();
  return unit === "nights" || priceType === "per-night";
};

const rangeOverlapsStay = (itemStart, itemEnd, checkIn, checkOut) => {
  const start = normalizeIsoDate(itemStart);
  const end = normalizeIsoDate(itemEnd) || start;
  if (!start || !checkIn || !checkOut) return false;
  return start < checkOut && end > checkIn;
};

const unitsOnNight = (items, night) =>
  (items || []).reduce((sum, item) => {
    const start = normalizeIsoDate(item.startDate || item.consumptionStartDate);
    const end = normalizeIsoDate(item.endDate || item.consumptionEndDate) || start;
    if (start && end && start <= night && night < end) {
      return sum + Math.max(1, Math.floor(Number(item.units || 1) || 1));
    }
    return sum;
  }, 0);

const peakUnitsInStay = (items, checkIn, checkOut) => {
  const nights = eachNight(checkIn, checkOut);
  if (!nights.length) return 0;
  return nights.reduce((peak, night) => Math.max(peak, unitsOnNight(items, night)), 0);
};

const windowAllowsStay = (availability, checkIn, checkOut) => {
  if (!availability || availability.isAnytime) return { ok: true };
  const start = normalizeIsoDate(checkIn);
  const end = normalizeIsoDate(checkOut);
  if (!start || !end) return { ok: false, message: "Choose check-in and check-out dates." };
  if (availability.windowStartDate && start < availability.windowStartDate) {
    return { ok: false, message: `Guests can check in from ${availability.windowStartDate}.` };
  }
  if (availability.windowEndDate && end > availability.windowEndDate) {
    return { ok: false, message: `This option is available until ${availability.windowEndDate}.` };
  }
  return { ok: true };
};

const remainingForStay = ({ quantity, consumptions = [], blocks = [], checkIn, checkOut }) => {
  const cap = Math.max(1, Math.floor(Number(quantity) || 1));
  const used = peakUnitsInStay(consumptions, checkIn, checkOut);
  const closed = peakUnitsInStay(blocks, checkIn, checkOut);
  return Math.max(0, cap - used - closed);
};

const occupancyKey = (serviceId, optionId) => `${String(serviceId || "")}:${optionId ? String(optionId) : ""}`;

const loadStayOccupancy = async ({ serviceId, optionId = null }) => {
  const filter = { serviceId };
  if (optionId) filter.optionId = optionId;
  else filter.optionId = null;
  const [consumptions, blocks] = await Promise.all([
    BookingConsumption.find({
      ...filter,
      status: { $in: ACTIVE_CONSUMPTION_STATUSES },
    })
      .select("bookingId serviceId optionId consumptionStartDate consumptionEndDate units status")
      .lean(),
    AvailabilityBlock.find({
      ...filter,
      isActive: { $ne: false },
    })
      .select("serviceId optionId startDate endDate units note source")
      .lean(),
  ]);
  return { consumptions: await consumptionsHeldByLiveBookings(consumptions), blocks };
};

const loadStayOccupancyForServices = async (serviceIds = []) => {
  const ids = (serviceIds || []).filter(Boolean);
  if (!ids.length) return { consumptionsByOption: new Map(), blocksByOption: new Map() };
  const [consumptions, blocks] = await Promise.all([
    BookingConsumption.find({
      serviceId: { $in: ids },
      status: { $in: ACTIVE_CONSUMPTION_STATUSES },
    })
      .select("bookingId serviceId optionId consumptionStartDate consumptionEndDate units status")
      .lean(),
    AvailabilityBlock.find({
      serviceId: { $in: ids },
      isActive: { $ne: false },
    })
      .select("serviceId optionId startDate endDate units note source")
      .lean(),
  ]);
  const consumptionsByOption = new Map();
  const blocksByOption = new Map();
  const liveConsumptions = await consumptionsHeldByLiveBookings(consumptions);
  liveConsumptions.forEach((row) => {
    const key = occupancyKey(row.serviceId, row.optionId);
    if (!consumptionsByOption.has(key)) consumptionsByOption.set(key, []);
    consumptionsByOption.get(key).push(row);
  });
  (blocks || []).forEach((row) => {
    const key = occupancyKey(row.serviceId, row.optionId);
    if (!blocksByOption.has(key)) blocksByOption.set(key, []);
    blocksByOption.get(key).push(row);
  });
  return { consumptionsByOption, blocksByOption };
};

const evaluateStayAvailability = async ({
  listing = {},
  option = {},
  availability = null,
  checkIn,
  checkOut,
  units = 1,
  domain,
} = {}) => {
  const start = normalizeIsoDate(checkIn);
  const end = normalizeIsoDate(checkOut);
  if (!start || !end || end <= start) {
    return { ok: false, remaining: 0, message: "Check-out must be after check-in." };
  }
  const window = windowAllowsStay(availability, start, end);
  if (!window.ok) return { ok: false, remaining: 0, message: window.message };

  const optionId = option.id || option._id || option.optionId || null;
  const occupancy = await loadStayOccupancy({
    serviceId: listing._id || listing.id,
    optionId: optionId && /^[a-f\d]{24}$/i.test(String(optionId)) ? optionId : null,
  });
  const quantity = optionQuantity(option);
  const remaining = remainingForStay({
    quantity,
    consumptions: occupancy.consumptions,
    blocks: occupancy.blocks,
    checkIn: start,
    checkOut: end,
  });
  const needed = Math.max(1, Math.floor(Number(units) || 1));
  if (remaining < needed) {
    return {
      ok: false,
      remaining,
      quantity,
      message:
        remaining <= 0
          ? "This option is fully booked or closed for those dates. Choose other dates."
          : `Only ${remaining} of this option left for those dates.`,
    };
  }
  return { ok: true, remaining, quantity, stayLike: isStayLike({ listing, option, domain }) };
};

const serializeBlock = (doc) => {
  if (!doc) return null;
  const data = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  return {
    id: data._id,
    _id: data._id,
    serviceId: data.serviceId,
    optionId: data.optionId || null,
    startDate: data.startDate,
    endDate: data.endDate,
    units: Number(data.units || 1),
    note: data.note || "",
    source: data.source || "provider",
  };
};

module.exports = {
  ACTIVE_CONSUMPTION_STATUSES,
  TERMINAL_BOOKING_STATUSES,
  consumptionCountsTowardOccupancy,
  addDays,
  eachNight,
  occupancyKey,
  optionQuantity,
  isStayLike,
  rangeOverlapsStay,
  remainingForStay,
  windowAllowsStay,
  loadStayOccupancy,
  loadStayOccupancyForServices,
  evaluateStayAvailability,
  serializeBlock,
};
