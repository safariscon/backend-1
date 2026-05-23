const {
  PRICE_MODELS,
  PRICING_UNITS,
  VERIFICATION_STATUSES,
  SUPPLIER_CATEGORIES,
} = require("../constants/marketplace");

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeCapacity = (capacity = {}) => ({
  adults: Math.max(1, toNumber(capacity.adults, 2)),
  children: Math.max(0, toNumber(capacity.children, 0)),
});

const normalizeAvailabilityCalendar = (calendar = []) =>
  Array.isArray(calendar)
    ? calendar
        .filter((entry) => entry && (entry.date || entry.startDate || entry.endDate))
        .map((entry) => ({
          date: entry.date || null,
          startDate: entry.startDate || null,
          endDate: entry.endDate || null,
          isAvailable:
            entry.isAvailable === undefined ? true : Boolean(entry.isAvailable),
          inventory: Math.max(0, toNumber(entry.inventory, 1)),
          note: String(entry.note || "").trim(),
        }))
    : [];

const normalizeBookingRules = (rules = {}) => ({
  minStay: Math.max(0, toNumber(rules.minStay, 0)),
  maxStay: Math.max(0, toNumber(rules.maxStay, 0)),
  cancellationPolicy: {
    type: rules.cancellationPolicy?.type || "moderate",
    description: String(rules.cancellationPolicy?.description || "").trim(),
    refundWindowHours: Math.max(
      0,
      toNumber(rules.cancellationPolicy?.refundWindowHours, 24)
    ),
  },
});

const normalizeCommission = (commission = {}) => ({
  percentage: Math.max(0, toNumber(commission.percentage, 10)),
  payoutSchedule: String(commission.payoutSchedule || "monthly").trim(),
});

const normalizePriceModel = (value = {}) => ({
  type: PRICE_MODELS.includes(value.type) ? value.type : "fixed",
  amount: Math.max(0, toNumber(value.amount, 0)),
  currency: String(value.currency || "USD").trim().toUpperCase(),
  unit: PRICING_UNITS.includes(value.unit) ? value.unit : "use",
});

const normalizeServiceSchedule = (schedule = {}) => ({
  timezone: String(schedule.timezone || "Africa/Kigali").trim(),
  alwaysAvailable: Boolean(schedule.alwaysAvailable),
  inventory: Math.max(0, toNumber(schedule.inventory, 1)),
  notes: String(schedule.notes || "").trim(),
  windows: Array.isArray(schedule.windows)
    ? schedule.windows.map((window) => ({
        day: String(window.day || "").trim(),
        startTime: String(window.startTime || "").trim(),
        endTime: String(window.endTime || "").trim(),
      }))
    : [],
});

const buildSupplierPayload = (payload = {}) => ({
  name: String(payload.name || payload.hotelName || "").trim(),
  slug: String(payload.slug || "").trim(),
  category: SUPPLIER_CATEGORIES.includes(payload.category)
    ? payload.category
    : "accommodation",
  supplierType: String(payload.supplierType || "hotel").trim(),
  description: String(payload.description || "").trim(),
  contact: {
    email: String(payload.contact?.email || payload.ownerEmail || "").trim().toLowerCase(),
    phone: String(payload.contact?.phone || "").trim(),
    website: String(payload.contact?.website || "").trim(),
  },
  address: {
    country: String(payload.address?.country || "Rwanda").trim(),
    city: String(payload.address?.city || payload.location || "").trim(),
    line1: String(payload.address?.line1 || "").trim(),
    line2: String(payload.address?.line2 || "").trim(),
  },
  verificationStatus: VERIFICATION_STATUSES.includes(payload.verificationStatus)
    ? payload.verificationStatus
    : "pending",
  pricing: {
    model: normalizePriceModel(payload.pricing || {}),
  },
  availabilityCalendar: normalizeAvailabilityCalendar(payload.availabilityCalendar),
  bookingRules: normalizeBookingRules(payload.bookingRules),
  commission: normalizeCommission(payload.commission),
  profile: {
    logo: String(payload.profile?.logo || "").trim(),
    coverImage: String(payload.profile?.coverImage || "").trim(),
    tags: Array.isArray(payload.profile?.tags) ? payload.profile.tags : [],
  },
});

const buildAnalyticsSummary = ({
  suppliers = [],
  bookings = [],
  services = [],
}) => {
  const confirmedBookings = bookings.filter((booking) =>
    ["confirmed", "completed"].includes(booking.status)
  );
  const revenue = confirmedBookings.reduce(
    (sum, booking) => sum + Number(booking.totalPrice || 0),
    0
  );
  const commissionRevenue = confirmedBookings.reduce((sum, booking) => {
    const itemCommission = Array.isArray(booking.items)
      ? booking.items.reduce(
          (itemSum, item) =>
            itemSum +
            ((Number(item.commission?.percentage || 0) / 100) *
              Number(item.total || 0)),
          0
        )
      : 0;
    return sum + itemCommission;
  }, 0);

  const activeServiceCount = services.filter((service) => service.isActive !== false).length;
  const availableQuantity = services.reduce(
    (sum, service) => sum + Number(service.availableQuantity || service.availabilitySchedule?.inventory || 0),
    0
  );

  return {
    supplierCount: suppliers.length,
    verifiedSuppliers: suppliers.filter(
      (supplier) => supplier.verificationStatus === "verified"
    ).length,
    pendingSuppliers: suppliers.filter(
      (supplier) => supplier.verificationStatus === "pending"
    ).length,
    serviceCount: services.length,
    activeServiceCount,
    availableQuantity,
    bookingCount: bookings.length,
    confirmedBookingCount: confirmedBookings.length,
    revenue,
    commissionRevenue,
  };
};

module.exports = {
  toNumber,
  normalizeCapacity,
  normalizeAvailabilityCalendar,
  normalizeBookingRules,
  normalizeCommission,
  normalizePriceModel,
  normalizeServiceSchedule,
  buildSupplierPayload,
  buildAnalyticsSummary,
};
