const STAR_RATINGS = [
  "unrated",
  "1-star",
  "2-star",
  "3-star",
  "4-star",
  "5-star",
  "5-star-deluxe",
];

const HOTEL_TYPES = [
  "boutique",
  "business",
  "resort",
  "all-inclusive-resort",
  "extended-stay",
  "heritage-historic",
  "airport",
  "serviced-apartment",
];

const ROOM_TYPES = [
  "standard",
  "superior",
  "deluxe",
  "junior-suite",
  "executive-suite",
  "presidential-suite",
  "connecting",
  "adjoining",
  "accessible",
  "single",
  "double",
  "twin",
];

const SUPPLIER_CATEGORIES = [
  "accommodation",
  "transport",
  "food-beverage",
  "experiences",
  "retail",
];

const ACCOMMODATION_SUPPLIER_TYPES = [
  "hotel",
  "resort",
  "homestay",
  "camp",
  "apartment",
];

const PRICE_MODELS = ["free", "fixed", "hourly", "per-use"];

const PRICING_UNITS = ["hour", "day", "person", "event", "night", "use"];

const VERIFICATION_STATUSES = ["draft", "pending", "verified", "rejected"];

const BOOKING_STATUSES = ["pending", "reviewing", "confirmed", "cancelled", "completed"];

const BOOKING_ITEM_TYPES = ["room", "service", "transport", "experience", "retail"];

const CANCELLATION_POLICY_TYPES = ["flexible", "moderate", "strict", "custom"];

module.exports = {
  STAR_RATINGS,
  HOTEL_TYPES,
  ROOM_TYPES,
  SUPPLIER_CATEGORIES,
  ACCOMMODATION_SUPPLIER_TYPES,
  PRICE_MODELS,
  PRICING_UNITS,
  VERIFICATION_STATUSES,
  BOOKING_STATUSES,
  BOOKING_ITEM_TYPES,
  CANCELLATION_POLICY_TYPES,
};
