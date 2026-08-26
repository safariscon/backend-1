const { asInteger, asBoolean, cleanText } = require("./helpers");

const DEFAULT_DEPOSIT_PERCENT = 50;
const DEFAULT_COMMISSION_PERCENT = 10;
const REMAINING_PAYMENT_METHODS = ["PAY_AT_ARRIVAL", "PAY_AT_CHECKOUT", "PAY_AT_BOOKING"];
const CANCELLATION_TYPES = ["flexible", "moderate", "strict", "custom"];

const remainingPaymentDuePhrase = (method, listing = {}) => {
  const code = String(method || "").trim().toUpperCase();
  const slug = String(listing.categorySlug || listing.subtype || listing.type || "").toLowerCase();
  const isRental = listing.domain === "transport"
    || /(car-rental|car-rentals|^cars$|motorbike)/.test(slug);
  if (code === "PAY_AT_BOOKING") return "when booking";
  if (isRental) {
    if (code === "PAY_AT_CHECKOUT") return "at return";
    return "at pickup";
  }
  if (code === "PAY_AT_CHECKOUT") return "at checkout";
  return "on arrival";
};

const clampPercent = (value, fallback) => {
  const parsed = asInteger(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, parsed));
};

const normalizePaymentPolicy = (input = {}, fallback = {}) => {
  const remainingPaymentMethod = REMAINING_PAYMENT_METHODS.includes(input.remainingPaymentMethod)
    ? input.remainingPaymentMethod
    : fallback.remainingPaymentMethod || "PAY_AT_ARRIVAL";

  return {
    depositPercentage: clampPercent(input.depositPercentage ?? fallback.depositPercentage, DEFAULT_DEPOSIT_PERCENT),
    remainingPaymentMethod,
    currency: cleanText(input.currency || fallback.currency || "RWF", 8).toUpperCase() || "RWF",
  };
};

const normalizeCancellationPolicy = (input = {}, fallback = {}) => {
  const type = CANCELLATION_TYPES.includes(input.type) ? input.type : fallback.type || "moderate";
  return {
    type,
    freeCancellationUntilHours: Math.max(
      0,
      Math.min(2160, asInteger(input.freeCancellationUntilHours ?? fallback.freeCancellationUntilHours ?? 24) || 0)
    ),
    depositRefundable: asBoolean(input.depositRefundable ?? fallback.depositRefundable ?? false),
    cancellationFeePercentage: clampPercent(
      input.cancellationFeePercentage ?? fallback.cancellationFeePercentage,
      100
    ),
  };
};

const splitBookingAmounts = ({ totalPrice, depositPercentage, commissionPercentage }) => {
  const total = Math.max(0, Math.round(Number(totalPrice || 0)));
  const depositPercent = clampPercent(depositPercentage, DEFAULT_DEPOSIT_PERCENT);
  const commissionPercent = clampPercent(commissionPercentage, DEFAULT_COMMISSION_PERCENT);
  const depositAmount = Math.round((total * depositPercent) / 100);
  const remainingAmount = Math.max(0, total - depositAmount);
  const platformFee = Math.round((total * commissionPercent) / 100);
  const providerFromDeposit = Math.max(0, depositAmount - platformFee);
  return {
    totalAmount: total,
    depositPercentage: depositPercent,
    depositAmount,
    remainingAmount,
    commissionPercentage: commissionPercent,
    platformFee,
    providerDepositShare: providerFromDeposit,
    currency: "RWF",
  };
};

const policyFromListing = (listing = {}, defaults = {}) => ({
  payment: normalizePaymentPolicy(listing.paymentPolicy, defaults.payment),
  cancellation: normalizeCancellationPolicy(
    listing.cancellationPolicy || listing.bookingRules?.cancellationPolicy,
    defaults.cancellation
  ),
});

module.exports = {
  DEFAULT_DEPOSIT_PERCENT,
  DEFAULT_COMMISSION_PERCENT,
  REMAINING_PAYMENT_METHODS,
  CANCELLATION_TYPES,
  normalizePaymentPolicy,
  normalizeCancellationPolicy,
  splitBookingAmounts,
  policyFromListing,
  remainingPaymentDuePhrase,
};
