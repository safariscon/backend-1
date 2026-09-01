const DEFAULT_COMMISSION_PERCENTAGE = 10;

const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getPlatformCommissionPercentage = () => {
  const raw = toFiniteNumber(process.env.PLATFORM_COMMISSION_RATE, NaN);
  if (!Number.isFinite(raw) || raw < 0) return DEFAULT_COMMISSION_PERCENTAGE;
  if (raw > 0 && raw <= 1) return Math.round(raw * 10000) / 100;
  if (raw <= 100) return raw;
  return DEFAULT_COMMISSION_PERCENTAGE;
};

const resolveCommissionPercentage = (business) => {
  const fromBusiness = toFiniteNumber(business?.commissionPercentage, NaN);
  if (Number.isFinite(fromBusiness) && fromBusiness >= 0 && fromBusiness <= 100) {
    return fromBusiness;
  }
  return getPlatformCommissionPercentage();
};

const roundRwf = (amount) => Math.max(0, Math.round(toFiniteNumber(amount, 0)));

const splitCollectedAmount = (collectedAmount, commissionPercentage, totalBookingPrice) => {
  const collected = roundRwf(collectedAmount);
  const percentage = Math.max(0, Math.min(100, toFiniteNumber(commissionPercentage, 0)));
  const totalBase = roundRwf(
    Number.isFinite(Number(totalBookingPrice)) && Number(totalBookingPrice) > 0
      ? totalBookingPrice
      : collected
  );
  const commissionDue = roundRwf((totalBase * percentage) / 100);
  const platformAmount = Math.min(commissionDue, collected);
  const providerAmount = Math.max(0, collected - platformAmount);
  return {
    collectedAmount: collected,
    totalBookingPrice: totalBase,
    commissionDue,
    commissionPercentage: percentage,
    platformAmount,
    providerAmount,
  };
};

module.exports = {
  DEFAULT_COMMISSION_PERCENTAGE,
  getPlatformCommissionPercentage,
  resolveCommissionPercentage,
  roundRwf,
  splitCollectedAmount,
  toFiniteNumber,
};
