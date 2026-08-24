const { toFiniteNumber, roundRwf, resolveCommissionPercentage } = require("./commission");

const DEFAULT_CANCEL_WINDOW_HOURS = 6;
const DEFAULT_CANCEL_PENALTY_PERCENT = 20;

const normalizeCancelPolicy = (input = {}, fallback = {}) => {
  const windowHours = Math.max(
    0,
    Math.min(
      2160,
      toFiniteNumber(
        input.windowHours ?? input.cancelWindowHours ?? fallback.windowHours ?? fallback.cancelWindowHours,
        DEFAULT_CANCEL_WINDOW_HOURS
      )
    )
  );
  const penaltyPercent = Math.max(
    0,
    Math.min(
      100,
      toFiniteNumber(
        input.penaltyPercent ?? input.cancelPenaltyPercent ?? fallback.penaltyPercent ?? fallback.cancelPenaltyPercent,
        DEFAULT_CANCEL_PENALTY_PERCENT
      )
    )
  );
  return { windowHours, penaltyPercent };
};

const cancelCommissionPercentOf = (bookingCommissionPercent) => {
  const full = Math.max(0, Math.min(100, toFiniteNumber(bookingCommissionPercent, 0)));
  return Math.round((full / 2) * 100) / 100;
};

const resolveServiceStartAt = (booking) => {
  const details = booking?.bookingDetails || {};
  const value =
    details.bookingDate ||
    details.startDate ||
    details.pickupDate ||
    booking?.bookingDate ||
    booking?.checkIn;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const resolveRefundableUntil = (booking, policy, now = new Date()) => {
  const startAt = resolveServiceStartAt(booking);
  const hours = Math.max(0, Number(policy?.windowHours || DEFAULT_CANCEL_WINDOW_HOURS));
  if (startAt) return new Date(startAt.getTime() - hours * 60 * 60 * 1000);
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
};

const canCustomerCancel = (booking, now = new Date()) => {
  if (!booking) return false;
  if (["cancelled", "completed", "rejected"].includes(booking.status)) return false;
  const until = booking.cancellation?.refundableUntil ? new Date(booking.cancellation.refundableUntil) : null;
  if (!until || Number.isNaN(until.getTime())) return false;
  return now < until;
};

const splitCancelAmounts = ({ paidAmount, penaltyPercent, bookingCommissionPercent }) => {
  const paid = roundRwf(paidAmount);
  const penaltyRate = Math.max(0, Math.min(100, toFiniteNumber(penaltyPercent, DEFAULT_CANCEL_PENALTY_PERCENT)));
  const penaltyAmount = roundRwf((paid * penaltyRate) / 100);
  const refundAmount = Math.max(0, paid - penaltyAmount);
  const cancelCommissionPercent = cancelCommissionPercentOf(bookingCommissionPercent);
  const platformAmount = roundRwf((penaltyAmount * cancelCommissionPercent) / 100);
  const providerAmount = Math.max(0, penaltyAmount - platformAmount);
  return {
    paidAmount: paid,
    penaltyPercent: penaltyRate,
    penaltyAmount,
    refundAmount,
    refundPercent: paid ? Math.round((refundAmount / paid) * 10000) / 100 : 0,
    cancelCommissionPercent,
    platformAmount,
    providerAmount,
  };
};

const policyFromBusiness = (business) => {
  const structured = business?.cancellationPolicy || {};
  const legacy = business?.bookingRules?.cancellationPolicy || business || {};
  const windowHours =
    structured.freeCancellationUntilHours ??
    structured.windowHours ??
    business?.cancelWindowHours ??
    legacy.windowHours ??
    legacy.cancelWindowHours;
  const penaltyPercent = structured.depositRefundable
    ? structured.cancellationFeePercentage ?? 0
    : structured.cancellationFeePercentage ??
      business?.cancelPenaltyPercent ??
      legacy.penaltyPercent ??
      100;
  return normalizeCancelPolicy(
    { windowHours, penaltyPercent },
    { windowHours: DEFAULT_CANCEL_WINDOW_HOURS, penaltyPercent: structured.depositRefundable ? 0 : 100 }
  );
};

module.exports = {
  DEFAULT_CANCEL_WINDOW_HOURS,
  DEFAULT_CANCEL_PENALTY_PERCENT,
  normalizeCancelPolicy,
  cancelCommissionPercentOf,
  resolveServiceStartAt,
  resolveRefundableUntil,
  canCustomerCancel,
  splitCancelAmounts,
  policyFromBusiness,
};
