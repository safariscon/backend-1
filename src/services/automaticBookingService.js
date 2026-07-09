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

const cleanText = (value, maxLength = 500) =>
  String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLength);

const normalizePriceOption = (row = {}) => {
  const cells = row.cells && typeof row.cells === "object" ? row.cells : {};
  return {
    id: cleanText(row.id, 100),
    name: cleanText(cells.service || cells.optionName, 150),
    price: Math.round(Number(cells.price || 0)),
    priceType: PRICE_TYPES.has(cells.priceType) ? cells.priceType : "",
    calculationField: cleanText(cells.calculationField, 50),
    durationUnit: DURATION_UNITS.has(cells.durationUnit) ? cells.durationUnit : "",
    maximumDuration: Math.max(0, Number(cells.maximumDuration || 0)),
    availability: Math.max(0, Math.floor(Number(cells.availability || 0))),
    details: cleanText(cells.details, 2000),
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
  const start = new Date(`${startDate}T${startTime || "00:00"}:00`);
  const resolvedEndTime = ["days", "nights"].includes(unit) ? "00:00" : endTime || "00:00";
  const end = new Date(`${endDate || startDate}T${resolvedEndTime}:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new Error("End time / completion time must be after the booking start.");
  }
  const milliseconds = end - start;
  if (unit === "minutes") return Math.ceil(milliseconds / 60000);
  if (unit === "hours") return Math.ceil(milliseconds / 3600000);
  return Math.ceil(milliseconds / 86400000);
};

const calculateQuote = ({ option, people, quantity, duration }) => {
  const base = option.price;
  const units = Math.max(1, Number(quantity));
  const guests = Math.max(1, Number(people));
  const period = Math.max(1, Number(duration));
  const totals = {
    fixed: base,
    "per-person": base * guests,
    "per-room": base * units,
    "per-night": base * units * period,
    "per-day": base * units * period,
    "per-hour": base * units * period,
    "per-item": base * units,
    "per-ticket": base * units,
    "per-package": base,
    "per-session": base * units,
  };
  const total = Math.round(totals[option.priceType] || 0);
  const deposit = Math.round(total * 0.3);
  const remaining = total - deposit;
  const priceTypeLabel = option.priceType.replace(/-/g, " ");
  const reason = `You will pay RWF ${deposit.toLocaleString("en-US")} now because you selected ${option.name} at RWF ${base.toLocaleString("en-US")} (${priceTypeLabel}) for ${units} unit(s) and ${period} ${option.durationUnit}. The full price is RWF ${total.toLocaleString("en-US")}, and the required deposit is 30%. Provider details will unlock after successful payment.`;
  return { total, deposit, remaining, reason };
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
      depositPercent: 30,
      depositAmount: Math.round(originalPrice * 0.3),
      remaining: originalPrice - Math.round(originalPrice * 0.3),
    };
  }
  const discountAmount = Math.round((originalPrice * activePromotion.percent) / 100);
  const finalPrice = Math.max(0, originalPrice - discountAmount);
  const depositAmount = Math.round(finalPrice * 0.3);
  return {
    ...quote,
    total: finalPrice,
    deposit: depositAmount,
    remaining: finalPrice - depositAmount,
    originalPrice,
    promotionApplied: true,
    promotionTitle: activePromotion.title,
    promotionPercent: activePromotion.percent,
    promotionNote: activePromotion.note,
    promotionStartAt: activePromotion.startAt,
    promotionEndAt: activePromotion.endAt,
    discountAmount,
    finalPrice,
    depositPercent: 30,
    depositAmount,
    reason: `${activePromotion.title}: Save ${activePromotion.percent}% on this service. Valid from ${activePromotion.startAt.toLocaleDateString("en-US")} to ${activePromotion.endAt.toLocaleDateString("en-US")}. The discounted price is RWF ${finalPrice.toLocaleString("en-US")}, and the required 30% deposit is RWF ${depositAmount.toLocaleString("en-US")}.`,
  };
};

module.exports = {
  cleanText,
  normalizePriceOption,
  hasCompleteAutomaticRules,
  isAutomaticReady,
  resolveBookingMode,
  getAutomaticRuleDefaults,
  calculateDuration,
  calculateQuote,
  getActivePromotion,
  applyPromotionToQuote,
};
