const PRICE_TYPES = new Set([
  "fixed",
  "per-person",
  "per-room",
  "per-night",
  "per-day",
  "per-hour",
  "per-item",
  "per-ticket",
  "per-package",
  "per-session",
]);

const DURATION_UNITS = new Set(["minutes", "hours", "days", "nights", "same-day", "none"]);
const CALCULATION_FIELDS = new Set(["people", "quantity", "duration", "package", "fixed"]);
const FORBIDDEN_CELL_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const WEEKDAY_ORDER = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WEEKDAY_LABELS = {
  sun: "Sunday",
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
};
const DAY_ALIASES = {
  su: "sun",
  sun: "sun",
  sunday: "sun",
  "0": "sun",
  mo: "mon",
  mon: "mon",
  monday: "mon",
  "1": "mon",
  tu: "tue",
  tue: "tue",
  tues: "tue",
  tuesday: "tue",
  "2": "tue",
  we: "wed",
  wed: "wed",
  wednesday: "wed",
  "3": "wed",
  th: "thu",
  thu: "thu",
  thur: "thu",
  thurs: "thu",
  thursday: "thu",
  "4": "thu",
  fr: "fri",
  fri: "fri",
  friday: "fri",
  "5": "fri",
  sa: "sat",
  sat: "sat",
  saturday: "sat",
  "6": "sat",
};

const AVAILABILITY_TABLE_COLUMNS = [
  { id: "service", label: "Option name" },
  { id: "price", label: "Price (RWF)" },
  { id: "priceType", label: "Price type" },
  { id: "calculationField", label: "Calculation field" },
  { id: "durationUnit", label: "Duration unit" },
  { id: "maximumDuration", label: "Maximum duration" },
  { id: "availability", label: "Availability / capacity" },
  { id: "availableFrom", label: "Available from" },
  { id: "availableTo", label: "Available until" },
  { id: "availableDays", label: "Weekdays" },
  { id: "availableStartTime", label: "Opens" },
  { id: "availableEndTime", label: "Closes" },
  { id: "requiresTime", label: "Times required" },
  { id: "details", label: "Details / amenities" },
];

const cleanText = (value, maxLength = 500) =>
  String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLength);

const normalizeIsoDate = (value) => {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const match = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
};

const normalizeClockTime = (value) => {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

const timeToMinutes = (value) => {
  const normalized = normalizeClockTime(value);
  if (!normalized) return null;
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
};

const normalizeRequiresTime = (value) => {
  const normalized = String(value || "auto").trim().toLowerCase();
  if (["yes", "true", "required", "1", "on"].includes(normalized)) return "yes";
  if (["no", "false", "dates-only", "datesonly", "optional", "0", "off"].includes(normalized)) return "no";
  return "auto";
};

const normalizeAvailableDays = (value) => {
  const parts = Array.isArray(value)
    ? value
    : String(value || "").split(/[,|/;]+|\s+/);
  return [...new Set(parts.map((part) => DAY_ALIASES[String(part).trim().toLowerCase()]).filter(Boolean))];
};

const weekdayKey = (isoDate) => {
  const [year, month, day] = String(isoDate).split("-").map(Number);
  if (!year || !month || !day) return "";
  return WEEKDAY_ORDER[new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay()] || "";
};

const dateDiffDays = (startDate, endDate) => {
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  return Math.round((end - start) / 86400000);
};

const eachIsoDate = (startDate, endDate, { exclusiveEnd = false } = {}) => {
  const dates = [];
  let cursor = startDate;
  while (cursor && (!exclusiveEnd || cursor < endDate) && (!exclusiveEnd ? cursor <= endDate : true)) {
    dates.push(cursor);
    if (!exclusiveEnd && cursor === endDate) break;
    const [year, month, day] = cursor.split("-").map(Number);
    const next = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));
    cursor = next.toISOString().slice(0, 10);
    if (dates.length > 400) break;
  }
  return dates;
};

const optionRequiresEndDate = (option = {}) =>
  ["days", "nights"].includes(option.durationUnit) || ["per-day", "per-night"].includes(option.priceType);

const optionIsSameDay = (option = {}) =>
  !optionRequiresEndDate(option) || ["same-day", "none"].includes(option.durationUnit);

const optionRequiresTime = (option = {}) => {
  const override = normalizeRequiresTime(option.requiresTime);
  if (override === "yes") return true;
  if (override === "no") return false;
  const hoursPublished = Boolean(option.availableStartTime || option.availableEndTime);
  const hourly =
    ["minutes", "hours"].includes(option.durationUnit) ||
    ["per-hour", "per-session"].includes(option.priceType);
  return hoursPublished || hourly;
};

const sanitizeUnknownCellValue = (value) => {
  if (value == null) return undefined;
  if (typeof value === "string") return cleanText(value, 2000);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, 60)
      .map((item) => sanitizeUnknownCellValue(item))
      .filter((item) => item !== undefined);
  }
  return undefined;
};

const normalizeAvailabilityCells = (rawCells = {}) => {
  const source = rawCells && typeof rawCells === "object" && !Array.isArray(rawCells) ? rawCells : {};
  let availableDays = normalizeAvailableDays(source.availableDays);
  // Full Mon–Sun was a legacy auto-default, not an intentional restriction.
  if (availableDays.length === WEEKDAY_ORDER.length) availableDays = [];
  const cells = {
    service: String(source.service ?? source.optionName ?? "").trim(),
    price: String(source.price ?? "").replace(/[^0-9]/g, "").trim(),
    priceType: PRICE_TYPES.has(source.priceType) ? source.priceType : "",
    calculationField: CALCULATION_FIELDS.has(source.calculationField) ? source.calculationField : "",
    durationUnit: DURATION_UNITS.has(source.durationUnit) ? source.durationUnit : "",
    maximumDuration: Math.max(0, Number(source.maximumDuration || 0)),
    availability: Math.max(0, Math.floor(Number(source.availability || 0))),
    availableFrom: normalizeIsoDate(source.availableFrom),
    availableTo: normalizeIsoDate(source.availableTo),
    availableDays: availableDays.join(","),
    availableStartTime: normalizeClockTime(source.availableStartTime),
    availableEndTime: normalizeClockTime(source.availableEndTime),
    requiresTime: normalizeRequiresTime(source.requiresTime),
    details: cleanText(source.details, 2000),
  };

  Object.entries(source).forEach(([key, value]) => {
    if (FORBIDDEN_CELL_KEYS.has(key) || Object.prototype.hasOwnProperty.call(cells, key)) return;
    const sanitized = sanitizeUnknownCellValue(value);
    if (sanitized !== undefined) cells[key] = sanitized;
  });

  return cells;
};

const normalizeAvailabilityTable = (table) => {
  const rows = (Array.isArray(table?.rows) ? table.rows : [])
    .map((row, rowIndex) => ({
      id: String(row.id || `row_${rowIndex + 1}`).replace(/[^a-zA-Z0-9_-]/g, "_"),
      cells: normalizeAvailabilityCells(row?.cells),
    }))
    .filter((row) => row.cells.service && row.cells.price)
    .slice(0, 50);

  return {
    columns: AVAILABILITY_TABLE_COLUMNS,
    rows,
    updatedAt: new Date(),
  };
};

const normalizePriceOption = (row = {}) => {
  const cells = normalizeAvailabilityCells(row.cells && typeof row.cells === "object" ? row.cells : {});
  return {
    id: cleanText(row.id, 100),
    name: cleanText(cells.service || cells.optionName, 150),
    price: Math.round(Number(cells.price || 0)),
    priceType: PRICE_TYPES.has(cells.priceType) ? cells.priceType : "",
    calculationField: cleanText(cells.calculationField, 50),
    durationUnit: DURATION_UNITS.has(cells.durationUnit) ? cells.durationUnit : "",
    maximumDuration: Math.max(0, Number(cells.maximumDuration || 0)),
    availability: Math.max(0, Math.floor(Number(cells.availability || 0))),
    availableFrom: cells.availableFrom,
    availableTo: cells.availableTo,
    availableDays: cells.availableDays,
    availableDaysList: normalizeAvailableDays(cells.availableDays),
    availableStartTime: cells.availableStartTime,
    availableEndTime: cells.availableEndTime,
    requiresTime: cells.requiresTime,
    details: cleanText(cells.details, 2000),
    cells,
  };
};

const failSchedule = (message) => ({ ok: false, status: 400, message });

const dateOutsideWindow = (isoDate, option) => {
  if (option.availableFrom && isoDate < option.availableFrom) return true;
  if (option.availableTo && isoDate > option.availableTo) return true;
  return false;
};

const windowMessage = (option) => {
  if (option.availableFrom && option.availableTo) {
    return `This date is outside the option's available window (${option.availableFrom} to ${option.availableTo}).`;
  }
  if (option.availableFrom) return `This date is before the option's available-from date (${option.availableFrom}).`;
  return `This date is after the option's available-until date (${option.availableTo}).`;
};

const weekdayMessage = (isoDate, option) => {
  const day = WEEKDAY_LABELS[weekdayKey(isoDate)] || isoDate;
  const allowedKeys = normalizeAvailableDays(option.availableDaysList || option.availableDays);
  const allowed = allowedKeys.map((key) => WEEKDAY_LABELS[key] || key).join(", ");
  return `This option is not available on ${day}. Available days: ${allowed}.`;
};

const validateBookingSchedule = ({ option, startDate, endDate, startTime, endTime } = {}) => {
  const resolvedStart = normalizeIsoDate(startDate);
  if (!resolvedStart) {
    return failSchedule("Booking date is required.");
  }

  const needsEndDate = optionRequiresEndDate(option);
  let resolvedEnd = normalizeIsoDate(endDate);
  if (resolvedEnd && resolvedEnd < resolvedStart) {
    return failSchedule("End booking date cannot be before booking date.");
  }
  if (needsEndDate && !resolvedEnd) {
    return failSchedule("End date is required for this per-day / per-night option.");
  }
  if (!needsEndDate) {
    resolvedEnd = resolvedStart;
  }

  // Only enforce date windows when the seller/admin explicitly configured them.
  const hasDateWindow = Boolean(option?.availableFrom || option?.availableTo);
  if (hasDateWindow) {
    if (option?.availableFrom && option?.availableTo && option.availableFrom > option.availableTo) {
      // Ignore inverted windows so older/bad data does not block bookings.
    } else if (dateOutsideWindow(resolvedStart, option) || dateOutsideWindow(resolvedEnd, option)) {
      return failSchedule(windowMessage(option));
    }
  }

  const allowedDays = Array.isArray(option?.availableDaysList)
    ? normalizeAvailableDays(option.availableDaysList)
    : normalizeAvailableDays(option?.availableDays);
  // Empty = unrestricted. Full Mon–Sun auto-defaults also count as unrestricted
  // (sellers no longer configure weekdays unless admin adds them as custom attributes).
  const hasExplicitDayRestriction = allowedDays.length > 0 && allowedDays.length < WEEKDAY_ORDER.length;
  if (hasExplicitDayRestriction) {
    const occupiedDates =
      option?.durationUnit === "nights" && resolvedEnd > resolvedStart
        ? eachIsoDate(resolvedStart, resolvedEnd, { exclusiveEnd: true })
        : eachIsoDate(resolvedStart, resolvedEnd);
    const invalidDate = occupiedDates.find((isoDate) => !allowedDays.includes(weekdayKey(isoDate)));
    if (invalidDate) return failSchedule(weekdayMessage(invalidDate, { ...option, availableDaysList: allowedDays }));
  }

  const resolvedStartTime = normalizeClockTime(startTime);
  const resolvedEndTime = normalizeClockTime(endTime);
  const timesRequired = optionRequiresTime(option);
  if (timesRequired && (!resolvedStartTime || !resolvedEndTime)) {
    return failSchedule("Start and end times are required for this option.");
  }
  if ((resolvedStartTime && !resolvedEndTime) || (!resolvedStartTime && resolvedEndTime)) {
    return failSchedule("Provide both start time and end time, or leave both empty for an all-day booking.");
  }

  // Opening-hours checks only when explicit open/close times were configured.
  const hasOpenHours = Boolean(option?.availableStartTime || option?.availableEndTime);
  if (hasOpenHours && resolvedStartTime && resolvedEndTime) {
    const open = timeToMinutes(option?.availableStartTime);
    const close = timeToMinutes(option?.availableEndTime);
    const startMinutes = timeToMinutes(resolvedStartTime);
    const endMinutes = timeToMinutes(resolvedEndTime);
    if (open != null && startMinutes < open) {
      return failSchedule(
        `This time is outside opening hours (${option.availableStartTime}${option.availableEndTime ? `–${option.availableEndTime}` : ""}).`
      );
    }
    if (close != null && endMinutes > close) {
      return failSchedule(
        `This time is outside opening hours (${option.availableStartTime ? `${option.availableStartTime}–` : ""}${option.availableEndTime}).`
      );
    }
    if (resolvedStart === resolvedEnd && endMinutes <= startMinutes) {
      return failSchedule("End time must be after start time.");
    }
  } else if (resolvedStartTime && resolvedEndTime && resolvedStart === resolvedEnd) {
    const startMinutes = timeToMinutes(resolvedStartTime);
    const endMinutes = timeToMinutes(resolvedEndTime);
    if (endMinutes <= startMinutes) {
      return failSchedule("End time must be after start time.");
    }
  }

  return {
    ok: true,
    startDate: resolvedStart,
    endDate: resolvedEnd,
    startTime: resolvedStartTime,
    endTime: resolvedEndTime,
  };
};

const hasCompleteAutomaticRules = (option) => Boolean(
  option?.id &&
  option.name &&
  option.price > 0 &&
  option.priceType &&
  option.calculationField &&
  option.durationUnit &&
  option.availability > 0
);

const isAutomaticReady = (business, option) => Boolean(
  business &&
  business.approvalStatus === "approved" &&
  business.status === "available" &&
  hasCompleteAutomaticRules(option)
);

const resolveBookingMode = (globalMode, serviceMode) => {
  const normalizedGlobal = ["manual", "automatic", "service-level"].includes(globalMode) ? globalMode : "manual";
  if (normalizedGlobal === "service-level") return serviceMode === "automatic" ? "automatic" : "manual";
  return normalizedGlobal;
};

const getAutomaticRuleDefaults = (category) => {
  const value = String(category || "").toLowerCase();
  if (/(hotel|room|resort|motel|hostel|inn|apartment|villa|chalet|cabin|lodge|camp|homestay|guesthouse|pension|b-and-b)/.test(value)) {
    return { priceType: "per-night", calculationField: "duration", durationUnit: "nights", maximumDuration: 30 };
  }
  if (/(car|motorbike|scooter|campervan|rv-rental|vehicle-rental)/.test(value)) {
    return { priceType: "per-day", calculationField: "duration", durationUnit: "days", maximumDuration: 30 };
  }
  if (/(airline|jet|shuttle|taxi|bus|train|ferry|hydrofoil|boat-taxi)/.test(value)) {
    return { priceType: "per-ticket", calculationField: "quantity", durationUnit: "same-day", maximumDuration: 1 };
  }
  if (/(venue|hall|center|terrace|estate|castle|meeting|ballroom|retreat)/.test(value)) {
    return { priceType: "per-day", calculationField: "duration", durationUnit: "days", maximumDuration: 7 };
  }
  if (/(tour|experience|museum|gallery|safari|park|diving|hiking|walk|tasting|brewery|theater|restaurant|food|bar|cafe)/.test(value)) {
    return { priceType: "per-person", calculationField: "people", durationUnit: "same-day", maximumDuration: 1 };
  }
  return { priceType: "fixed", calculationField: "fixed", durationUnit: "none", maximumDuration: 1 };
};

const calculateDuration = ({ startDate, endDate, startTime, endTime, unit }) => {
  if (["none", "same-day"].includes(unit)) return 1;
  const resolvedStart = normalizeIsoDate(startDate);
  const resolvedEnd = normalizeIsoDate(endDate) || resolvedStart;
  if (["days", "nights"].includes(unit)) {
    if (!resolvedStart) throw new Error("Booking date is required.");
    const days = Math.max(0, dateDiffDays(resolvedStart, resolvedEnd));
    if (unit === "nights") return Math.max(1, days);
    return Math.max(1, days || 1);
  }
  const start = new Date(`${resolvedStart}T${normalizeClockTime(startTime) || "00:00"}:00`);
  const end = new Date(`${resolvedEnd}T${normalizeClockTime(endTime) || "00:00"}:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new Error("End time / completion time must be after the booking start.");
  }
  const milliseconds = end - start;
  if (unit === "minutes") return Math.ceil(milliseconds / 60000);
  if (unit === "hours") return Math.ceil(milliseconds / 3600000);
  return Math.ceil(milliseconds / 86400000);
};

const calculateQuote = ({ option, people, quantity }) => {
  const base = option.price;
  const units = Math.max(1, Number(quantity));
  const guests = Math.max(1, Number(people));
  const totalConsumptionUnits = Math.max(1, Math.floor(guests * units));
  const total = Math.round(base * totalConsumptionUnits);
  const reason = `You will pay the full amount of RWF ${total.toLocaleString("en-US")} now. Provider details unlock after successful payment. You may cancel until a few hours before the service starts; a cancellation fee then stays in the SafarisCon wallet.`;
  return { total, deposit: total, remaining: 0, reason, totalConsumptionUnits };
};

const getActivePromotion = (promotion, now = new Date()) => {
  if (!promotion?.enabled) return null;
  const percent = Number(promotion.percent ?? promotion.promotionPercent ?? 0);
  const startAt = promotion.startAt ? new Date(promotion.startAt) : null;
  const endAt = promotion.endAt ? new Date(promotion.endAt) : null;
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return null;
  if (!startAt || !endAt || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return null;
  if (startAt >= endAt || startAt > now || endAt < now) return null;
  return {
    title: cleanText(promotion.title, 100),
    percent,
    note: cleanText(promotion.note || promotion.description, 500),
    startAt,
    endAt,
  };
};

const applyPromotionToQuote = ({ quote, promotion, now = new Date() }) => {
  const activePromotion = getActivePromotion(promotion, now);
  const originalPrice = Math.max(0, Number(quote.total || 0));
  if (!activePromotion) {
    return {
      ...quote,
      originalPrice,
      promotionApplied: false,
      promotionTitle: "",
      promotionPercent: 0,
      discountAmount: 0,
      finalPrice: originalPrice,
      depositPercent: 100,
      depositAmount: originalPrice,
      remaining: 0,
    };
  }
  const discountAmount = Math.round((originalPrice * activePromotion.percent) / 100);
  const finalPrice = Math.max(0, originalPrice - discountAmount);
  const depositAmount = finalPrice;
  return {
    ...quote,
    total: finalPrice,
    deposit: depositAmount,
    remaining: 0,
    originalPrice,
    promotionApplied: true,
    promotionTitle: activePromotion.title,
    promotionPercent: activePromotion.percent,
    promotionNote: activePromotion.note,
    promotionStartAt: activePromotion.startAt,
    promotionEndAt: activePromotion.endAt,
    discountAmount,
    finalPrice,
    depositPercent: 100,
    depositAmount,
    reason: `${activePromotion.title}: Save ${activePromotion.percent}% on this service. Valid from ${activePromotion.startAt.toLocaleDateString("en-US")} to ${activePromotion.endAt.toLocaleDateString("en-US")}. Pay the full discounted price of RWF ${finalPrice.toLocaleString("en-US")} now.`,
  };
};

module.exports = {
  cleanText,
  AVAILABILITY_TABLE_COLUMNS,
  normalizeIsoDate,
  normalizeClockTime,
  normalizeAvailableDays,
  normalizeRequiresTime,
  normalizeAvailabilityCells,
  normalizeAvailabilityTable,
  normalizePriceOption,
  optionRequiresEndDate,
  optionRequiresTime,
  optionIsSameDay,
  validateBookingSchedule,
  hasCompleteAutomaticRules,
  isAutomaticReady,
  resolveBookingMode,
  getAutomaticRuleDefaults,
  calculateDuration,
  calculateQuote,
  getActivePromotion,
  applyPromotionToQuote,
};
