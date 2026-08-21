const ServiceAvailability = require("../models/ServiceAvailability");
const BookingConsumption = require("../models/BookingConsumption");

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const normalizeIsoDate = (value) => {
  const text = String(value || "").trim().slice(0, 10);
  return ISO_DATE.test(text) ? text : "";
};

const normalizeClockTime = (value) => {
  const text = String(value || "").trim();
  if (!text) return "";
  if (HH_MM.test(text)) return text;
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const normalizeDaysOfWeek = (days = []) => {
  const allowed = new Set(WEEKDAY_KEYS);
  const list = Array.isArray(days) ? days : String(days || "").split(",");
  return [...new Set(
    list
      .map((day) => String(day || "").trim().toLowerCase().slice(0, 3))
      .map((day) => {
        if (allowed.has(day)) return day;
        const map = { monday: "mon", tuesday: "tue", wednesday: "wed", thursday: "thu", friday: "fri", saturday: "sat", sunday: "sun" };
        return map[String(day).toLowerCase()] || "";
      })
      .filter(Boolean)
  )];
};

const weekdayKeyFromIso = (isoDate) => {
  const date = new Date(`${isoDate}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  return WEEKDAY_KEYS[date.getUTCDay()];
};

const eachIsoDate = (startIso, endIso) => {
  const out = [];
  let cursor = startIso;
  while (cursor && cursor <= endIso) {
    out.push(cursor);
    const next = new Date(`${cursor}T12:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = next.toISOString().slice(0, 10);
  }
  return out;
};

const combineDateTime = (isoDate, time, { endOfDay = false } = {}) => {
  const clock = normalizeClockTime(time) || (endOfDay ? "23:59" : "00:00");
  return new Date(`${isoDate}T${clock}:00.000Z`);
};

const defaultAvailabilityPolicy = () => ({
  listingRequiresAvailability: false,
  optionRequiresAvailability: false,
  modes: {
    dateWindow: true,
    daysOfWeek: true,
    timeOfDay: true,
  },
  trackCapacity: true,
});

const defaultConsumptionPolicy = () => ({
  requireConsumptionStartDate: true,
  requireConsumptionEndDate: false,
  requireConsumptionStartTime: false,
  requireConsumptionEndTime: false,
});

const normalizeAvailabilityPolicy = (raw = {}) => {
  const defaults = defaultAvailabilityPolicy();
  return {
    listingRequiresAvailability: Boolean(raw.listingRequiresAvailability ?? defaults.listingRequiresAvailability),
    optionRequiresAvailability: Boolean(raw.optionRequiresAvailability ?? defaults.optionRequiresAvailability),
    modes: {
      dateWindow: raw.modes?.dateWindow !== false,
      daysOfWeek: raw.modes?.daysOfWeek !== false,
      timeOfDay: raw.modes?.timeOfDay !== false,
    },
    trackCapacity: raw.trackCapacity !== false,
  };
};

const normalizeConsumptionPolicy = (raw = {}) => {
  const defaults = defaultConsumptionPolicy();
  return {
    requireConsumptionStartDate: raw.requireConsumptionStartDate !== false,
    requireConsumptionEndDate: Boolean(raw.requireConsumptionEndDate ?? defaults.requireConsumptionEndDate),
    requireConsumptionStartTime: Boolean(raw.requireConsumptionStartTime ?? defaults.requireConsumptionStartTime),
    requireConsumptionEndTime: Boolean(raw.requireConsumptionEndTime ?? defaults.requireConsumptionEndTime),
  };
};

const serializeAvailability = (doc) => {
  if (!doc) return null;
  const data = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  return {
    id: data._id,
    _id: data._id,
    serviceId: data.serviceId,
    optionId: data.optionId || null,
    scope: data.scope,
    isAnytime: Boolean(data.isAnytime),
    windowStartDate: data.windowStartDate || "",
    windowEndDate: data.windowEndDate || "",
    daysOfWeek: Array.isArray(data.daysOfWeek) ? data.daysOfWeek : [],
    dayStartTime: data.dayStartTime || "",
    dayEndTime: data.dayEndTime || "",
    capacityTotal: Number(data.capacityTotal || 0),
    capacityRemaining: Number(data.capacityRemaining || 0),
    trackCapacity: data.trackCapacity !== false,
    timezone: data.timezone || "Africa/Kigali",
    isActive: data.isActive !== false,
    updatedAt: data.updatedAt || null,
  };
};

const normalizeAvailabilityPayload = (body = {}, { scope = "service", trackCapacity = true } = {}) => {
  const isAnytime = Boolean(body.isAnytime);
  const capacityTotal = Math.max(0, Math.floor(Number(body.capacityTotal ?? body.capacity ?? 1) || 1));
  const capacityRemainingRaw = body.capacityRemaining;
  const capacityRemaining = Number.isFinite(Number(capacityRemainingRaw))
    ? Math.max(0, Math.floor(Number(capacityRemainingRaw)))
    : capacityTotal;

  return {
    scope,
    isAnytime,
    windowStartDate: isAnytime ? "" : normalizeIsoDate(body.windowStartDate || body.availableFrom),
    windowEndDate: isAnytime ? "" : normalizeIsoDate(body.windowEndDate || body.availableTo),
    daysOfWeek: isAnytime ? [] : normalizeDaysOfWeek(body.daysOfWeek || body.availableDays),
    dayStartTime: isAnytime ? "" : normalizeClockTime(body.dayStartTime || body.availableStartTime),
    dayEndTime: isAnytime ? "" : normalizeClockTime(body.dayEndTime || body.availableEndTime),
    capacityTotal,
    capacityRemaining,
    trackCapacity: body.trackCapacity != null ? Boolean(body.trackCapacity) : trackCapacity,
    timezone: String(body.timezone || "Africa/Kigali").trim() || "Africa/Kigali",
    isActive: body.isActive !== false,
  };
};

const findAvailability = async ({ serviceId, optionId = null }) => {
  if (optionId) {
    return ServiceAvailability.findOne({ serviceId, optionId, scope: "option", isActive: { $ne: false } });
  }
  return ServiceAvailability.findOne({ serviceId, optionId: null, scope: "service", isActive: { $ne: false } });
};

const upsertAvailability = async ({ serviceId, optionId = null, payload, trackCapacity = true }) => {
  const scope = optionId ? "option" : "service";
  const normalized = normalizeAvailabilityPayload(payload, { scope, trackCapacity });
  const filter = optionId
    ? { serviceId, optionId, scope: "option" }
    : { serviceId, optionId: null, scope: "service" };

  const existing = await ServiceAvailability.findOne(filter);
  if (existing && payload.capacityRemaining == null && payload.capacity == null) {
    // Keep remaining in sync with total when total shrinks; otherwise preserve remaining.
    if (normalized.capacityTotal < existing.capacityRemaining) {
      normalized.capacityRemaining = normalized.capacityTotal;
    } else {
      normalized.capacityRemaining = existing.capacityRemaining;
    }
  }

  const doc = await ServiceAvailability.findOneAndUpdate(
    filter,
    {
      $set: {
        serviceId,
        optionId: optionId || null,
        ...normalized,
      },
    },
    { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true }
  );
  return doc;
};

const buildConsumptionFromInput = ({
  consumptionPolicy,
  input = {},
  fallbackStartDate = "",
  fallbackEndDate = "",
  fallbackStartTime = "",
  fallbackEndTime = "",
  units = 1,
} = {}) => {
  const policy = normalizeConsumptionPolicy(consumptionPolicy);
  const errors = [];

  let consumptionStartDate = normalizeIsoDate(
    input.consumptionStartDate || input.startDate || fallbackStartDate
  );
  let consumptionEndDate = normalizeIsoDate(
    input.consumptionEndDate || input.endDate || fallbackEndDate || consumptionStartDate
  );
  let consumptionStartTime = normalizeClockTime(
    input.consumptionStartTime || input.startTime || fallbackStartTime
  );
  let consumptionEndTime = normalizeClockTime(
    input.consumptionEndTime || input.endTime || fallbackEndTime
  );

  if (policy.requireConsumptionStartDate && !consumptionStartDate) {
    errors.push("Consumption start date is required.");
  }
  if (policy.requireConsumptionEndDate && !consumptionEndDate) {
    errors.push("Consumption end date is required.");
  }
  if (!policy.requireConsumptionEndDate && !consumptionEndDate) {
    consumptionEndDate = consumptionStartDate;
  }
  if (policy.requireConsumptionStartTime && !consumptionStartTime) {
    errors.push("Consumption start time is required.");
  }
  if (policy.requireConsumptionEndTime && !consumptionEndTime) {
    errors.push("Consumption end time is required.");
  }

  if (consumptionStartDate && consumptionEndDate && consumptionEndDate < consumptionStartDate) {
    errors.push("Consumption end date cannot be before start date.");
  }

  if (errors.length) {
    return { ok: false, message: errors[0], errors };
  }

  if (!consumptionStartDate) {
    return { ok: false, message: "Consumption start date is required.", errors: ["Consumption start date is required."] };
  }

  const consumptionStartAt = combineDateTime(consumptionStartDate, consumptionStartTime, { endOfDay: false });
  const consumptionEndAt = combineDateTime(
    consumptionEndDate || consumptionStartDate,
    consumptionEndTime,
    { endOfDay: !consumptionEndTime }
  );

  if (consumptionEndAt < consumptionStartAt) {
    return { ok: false, message: "Consumption end must be after consumption start.", errors: ["Consumption end must be after consumption start."] };
  }

  return {
    ok: true,
    consumption: {
      bookedAt: new Date(),
      consumptionStartDate,
      consumptionEndDate: consumptionEndDate || consumptionStartDate,
      consumptionStartTime,
      consumptionEndTime,
      consumptionStartAt,
      consumptionEndAt,
      units: Math.max(1, Math.floor(Number(units) || 1)),
    },
  };
};

const validateConsumptionAgainstAvailability = (availability, consumption) => {
  if (!availability) {
    return { ok: false, message: "Availability is not configured for this service or option." };
  }
  if (availability.isAnytime) {
    if (availability.trackCapacity && Number(availability.capacityRemaining) < Number(consumption.units || 1)) {
      return { ok: false, message: "Not enough remaining capacity for this booking." };
    }
    return { ok: true };
  }

  const start = consumption.consumptionStartDate;
  const end = consumption.consumptionEndDate || start;
  if (availability.windowStartDate && start < availability.windowStartDate) {
    return { ok: false, message: `Consumption starts before availability window (${availability.windowStartDate}).` };
  }
  if (availability.windowEndDate && end > availability.windowEndDate) {
    return { ok: false, message: `Consumption ends after availability window (${availability.windowEndDate}).` };
  }

  const days = normalizeDaysOfWeek(availability.daysOfWeek);
  if (days.length && days.length < 7) {
    const occupied = eachIsoDate(start, end);
    const bad = occupied.find((iso) => !days.includes(weekdayKeyFromIso(iso)));
    if (bad) {
      return { ok: false, message: `This service/option is not available on ${bad}.` };
    }
  }

  const open = normalizeClockTime(availability.dayStartTime);
  const close = normalizeClockTime(availability.dayEndTime);
  if (open || close) {
    const startTime = normalizeClockTime(consumption.consumptionStartTime);
    const endTime = normalizeClockTime(consumption.consumptionEndTime);
    if (open && startTime && startTime < open) {
      return { ok: false, message: `Consumption start time must be at or after ${open}.` };
    }
    if (close && endTime && endTime > close) {
      return { ok: false, message: `Consumption end time must be at or before ${close}.` };
    }
    if (open && close && !startTime && !endTime) {
      // Date-only booking on a timed availability is allowed for full-day use within the window.
    }
  }

  if (availability.trackCapacity && Number(availability.capacityRemaining) < Number(consumption.units || 1)) {
    return { ok: false, message: "Not enough remaining capacity for this booking." };
  }

  return { ok: true };
};

const findOverlappingPaidConsumptions = async ({
  serviceId,
  optionId = null,
  consumptionStartAt,
  consumptionEndAt,
  excludeBookingId = null,
}) => {
  const filter = {
    serviceId,
    status: "paid",
    consumptionStartAt: { $lt: consumptionEndAt },
    consumptionEndAt: { $gt: consumptionStartAt },
  };
  if (optionId) filter.optionId = optionId;
  else filter.optionId = null;
  if (excludeBookingId) filter.bookingId = { $ne: excludeBookingId };

  return BookingConsumption.find(filter).select("bookingId consumptionStartDate consumptionEndDate units").lean();
};

const createBookingConsumption = async ({
  bookingId,
  serviceId,
  optionId = null,
  consumption,
  status = "pending",
}) => {
  return BookingConsumption.findOneAndUpdate(
    { bookingId },
    {
      $set: {
        bookingId,
        serviceId,
        optionId: optionId || null,
        ...consumption,
        status,
      },
    },
    { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true }
  );
};

const markConsumptionPaidAndCaptureCapacity = async ({ bookingId, units = 1 }) => {
  const consumption = await BookingConsumption.findOne({ bookingId });
  if (!consumption) return { ok: true, skipped: true };

  consumption.status = "paid";
  await consumption.save();

  const availability = await findAvailability({
    serviceId: consumption.serviceId,
    optionId: consumption.optionId,
  });
  if (!availability || !availability.trackCapacity) {
    return { ok: true, consumption, availability: serializeAvailability(availability) };
  }

  const needed = Math.max(1, Math.floor(Number(units || consumption.units || 1)));
  const updated = await ServiceAvailability.findOneAndUpdate(
    {
      _id: availability._id,
      capacityRemaining: { $gte: needed },
    },
    { $inc: { capacityRemaining: -needed } },
    { returnDocument: "after" }
  );

  if (!updated) {
    return {
      ok: false,
      message: "Capacity was already taken for this availability window.",
      consumption,
      availability: serializeAvailability(availability),
    };
  }

  return { ok: true, consumption, availability: serializeAvailability(updated) };
};

const releaseConsumptionCapacity = async ({ bookingId }) => {
  const consumption = await BookingConsumption.findOne({ bookingId });
  if (!consumption || consumption.status !== "paid") {
    if (consumption) {
      consumption.status = "cancelled";
      await consumption.save();
    }
    return { ok: true };
  }

  const availability = await findAvailability({
    serviceId: consumption.serviceId,
    optionId: consumption.optionId,
  });
  if (availability?.trackCapacity) {
    const units = Math.max(1, Math.floor(Number(consumption.units || 1)));
    const restored = Math.min(
      Number(availability.capacityTotal || 0),
      Number(availability.capacityRemaining || 0) + units
    );
    await ServiceAvailability.updateOne(
      { _id: availability._id },
      { $set: { capacityRemaining: restored } }
    );
  }

  consumption.status = "cancelled";
  await consumption.save();
  return { ok: true };
};

module.exports = {
  WEEKDAY_KEYS,
  normalizeIsoDate,
  normalizeClockTime,
  normalizeDaysOfWeek,
  defaultAvailabilityPolicy,
  defaultConsumptionPolicy,
  normalizeAvailabilityPolicy,
  normalizeConsumptionPolicy,
  serializeAvailability,
  normalizeAvailabilityPayload,
  findAvailability,
  upsertAvailability,
  buildConsumptionFromInput,
  validateConsumptionAgainstAvailability,
  findOverlappingPaidConsumptions,
  createBookingConsumption,
  markConsumptionPaidAndCaptureCapacity,
  releaseConsumptionCapacity,
};
