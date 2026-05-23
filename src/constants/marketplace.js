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

const BUSINESS_TYPES = [
  "Hotel",
  "Resort",
  "Apartment",
  "Guesthouse",
  "Tent Rental",
  "Camping Site",
  "Car Rental",
  "Motorbike Rental",
  "Taxi Service",
  "Bus Charter",
  "Restaurant",
  "Bar",
  "Coffee Shop",
  "Food Truck",
  "Event Hall",
  "Wedding Venue",
  "Tour Agency",
  "Entertainment Venue",
  "Gear Rental",
  "Souvenir Shop",
  "Spa",
  "Wellness Center",
  "Childcare Service",
  "Shop",
  "Other",
];

const SERVICE_CATEGORIES = [
  "Accommodation",
  "Transportation",
  "Food & Drinks",
  "Events",
  "Tours",
  "Entertainment",
  "Shopping",
  "Wellness",
  "Childcare",
];

const PRICE_MODELS = ["free", "fixed", "hourly", "per-use"];

const PRICING_UNITS = [
  "per_hour",
  "per_day",
  "per_night",
  "per_week",
  "per_month",
  "per_person",
  "per_plate",
  "per_bottle",
  "per_session",
  "per_event",
  "per_trip",
  "hour",
  "day",
  "person",
  "event",
  "night",
  "trip",
  "order",
  "item",
  "table",
  "vehicle",
  "service",
  "use",
];

const SERVICE_STATUSES = ["available", "unavailable", "fully_booked", "paused"];

const VERIFICATION_STATUSES = ["draft", "pending", "verified", "rejected"];

const BOOKING_STATUSES = ["pending", "confirmed", "active", "cancelled", "completed"];

const BOOKING_ITEM_TYPES = ["service", "transport", "experience", "retail"];

const CANCELLATION_POLICY_TYPES = ["flexible", "moderate", "strict", "custom"];

module.exports = {
  STAR_RATINGS,
  HOTEL_TYPES,
  BUSINESS_TYPES,
  SERVICE_CATEGORIES,
  SUPPLIER_CATEGORIES,
  ACCOMMODATION_SUPPLIER_TYPES,
  PRICE_MODELS,
  PRICING_UNITS,
  SERVICE_STATUSES,
  VERIFICATION_STATUSES,
  BOOKING_STATUSES,
  BOOKING_ITEM_TYPES,
  CANCELLATION_POLICY_TYPES,
};
