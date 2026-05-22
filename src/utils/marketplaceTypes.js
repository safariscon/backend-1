const normalizeBusinessType = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[ /]+/g, "-");

  const aliases = {
    hotel: "hotels-and-resorts",
    accommodation: "hotels-and-resorts",
    restaurants: "restaurants",
    restaurant: "restaurants",
    taxi: "taxi-and-ride-services",
    rides: "taxi-and-ride-services",
    tours: "tour-and-activity-operators",
    activities: "tour-and-activity-operators",
    spas: "spas-and-wellness-centers",
    wellness: "spas-and-wellness-centers",
    childcare: "childcare-services",
  };

  return aliases[normalized] || normalized || "hotels-and-resorts";
};

const MARKETPLACE_TYPE_CONFIG = {
  "hotels-and-resorts": {
    serviceCategory: "accommodation",
    bookingModel: "accommodation",
    pricingModel: "per_night",
    pricingUnit: "night",
    inventoryType: "rooms",
    assignmentType: "room",
    supportsRooms: true,
  },
  "homestays-and-guesthouses": {
    serviceCategory: "accommodation",
    bookingModel: "accommodation",
    pricingModel: "per_night",
    pricingUnit: "night",
    inventoryType: "rooms",
    assignmentType: "room",
    supportsRooms: true,
  },
  "tent-rentals-and-camping-sites": {
    serviceCategory: "accommodation",
    bookingModel: "accommodation",
    pricingModel: "per_night",
    pricingUnit: "night",
    inventoryType: "rooms",
    assignmentType: "room",
    supportsRooms: true,
  },
  "vacation-rentals-and-apartments": {
    serviceCategory: "accommodation",
    bookingModel: "accommodation",
    pricingModel: "per_night",
    pricingUnit: "night",
    inventoryType: "rooms",
    assignmentType: "room",
    supportsRooms: true,
  },
  "car-rentals": {
    serviceCategory: "transport",
    bookingModel: "transport",
    pricingModel: "per_day",
    pricingUnit: "day",
    inventoryType: "vehicles",
    assignmentType: "vehicle",
  },
  "motorbike-and-scooter-rentals": {
    serviceCategory: "transport",
    bookingModel: "transport",
    pricingModel: "per_day",
    pricingUnit: "day",
    inventoryType: "vehicles",
    assignmentType: "vehicle",
  },
  "taxi-and-ride-services": {
    serviceCategory: "transport",
    bookingModel: "transport",
    pricingModel: "per_trip",
    pricingUnit: "trip",
    inventoryType: "vehicles",
    assignmentType: "vehicle",
  },
  "bus-and-minivan-charters": {
    serviceCategory: "transport",
    bookingModel: "transport",
    pricingModel: "per_trip",
    pricingUnit: "trip",
    inventoryType: "vehicles",
    assignmentType: "vehicle",
  },
  restaurants: {
    serviceCategory: "food-beverage",
    bookingModel: "restaurant",
    pricingModel: "per_person",
    pricingUnit: "person",
    inventoryType: "tables",
    assignmentType: "table",
  },
  "bars-and-pubs": {
    serviceCategory: "food-beverage",
    bookingModel: "restaurant",
    pricingModel: "per_person",
    pricingUnit: "person",
    inventoryType: "tables",
    assignmentType: "table",
  },
  "coffee-shops-and-cafes": {
    serviceCategory: "food-beverage",
    bookingModel: "restaurant",
    pricingModel: "per_person",
    pricingUnit: "person",
    inventoryType: "tables",
    assignmentType: "table",
  },
  "food-trucks-and-street-food-stalls": {
    serviceCategory: "food-beverage",
    bookingModel: "restaurant",
    pricingModel: "fixed",
    pricingUnit: "order",
    inventoryType: "orders",
    assignmentType: "service",
  },
  "conference-event-halls-mice": {
    serviceCategory: "events",
    bookingModel: "event",
    pricingModel: "fixed",
    pricingUnit: "event",
    inventoryType: "venue-slots",
    assignmentType: "venue",
  },
  "wedding-venues": {
    serviceCategory: "events",
    bookingModel: "event",
    pricingModel: "fixed",
    pricingUnit: "event",
    inventoryType: "venue-slots",
    assignmentType: "venue",
  },
  "tour-and-activity-operators": {
    serviceCategory: "experiences",
    bookingModel: "activity",
    pricingModel: "per_person",
    pricingUnit: "person",
    inventoryType: "activity-slots",
    assignmentType: "guide",
  },
  "entertainment-venues": {
    serviceCategory: "experiences",
    bookingModel: "event",
    pricingModel: "per_person",
    pricingUnit: "person",
    inventoryType: "tickets",
    assignmentType: "service",
  },
  "souvenir-shops-and-craft-markets": {
    serviceCategory: "shopping",
    bookingModel: "shopping",
    pricingModel: "fixed",
    pricingUnit: "item",
    inventoryType: "items",
    assignmentType: "service",
  },
  "gear-rentals": {
    serviceCategory: "experiences",
    bookingModel: "rental",
    pricingModel: "per_day",
    pricingUnit: "day",
    inventoryType: "gear",
    assignmentType: "gear",
  },
  "spas-and-wellness-centers": {
    serviceCategory: "wellness",
    bookingModel: "appointment",
    pricingModel: "per_hour",
    pricingUnit: "hour",
    inventoryType: "appointment-slots",
    assignmentType: "therapist",
  },
  "childcare-services": {
    serviceCategory: "personal-services",
    bookingModel: "childcare",
    pricingModel: "per_hour",
    pricingUnit: "hour",
    inventoryType: "care-slots",
    assignmentType: "caregiver",
  },
  other: {
    serviceCategory: "general",
    bookingModel: "service",
    pricingModel: "fixed",
    pricingUnit: "service",
    inventoryType: "services",
    assignmentType: "service",
  },
};

const getMarketplaceTypeConfig = (type) => {
  const normalizedType = normalizeBusinessType(type);
  return {
    businessType: normalizedType,
    ...(MARKETPLACE_TYPE_CONFIG[normalizedType] || MARKETPLACE_TYPE_CONFIG.other),
  };
};

const decorateBusiness = (business) => {
  if (!business) return business;
  const raw = typeof business.toObject === "function" ? business.toObject() : business;
  const config = getMarketplaceTypeConfig(raw.businessType || raw.type);
  return {
    ...raw,
    type: raw.type || config.businessType,
    businessType: raw.businessType || raw.type || config.businessType,
    serviceCategory: raw.serviceCategory || config.serviceCategory,
    bookingModel: raw.bookingModel || config.bookingModel,
    pricingModel: raw.pricingModel || config.pricingModel,
    pricingUnit: raw.pricingUnit || config.pricingUnit,
    inventoryType: raw.inventoryType || config.inventoryType,
    assignmentType: raw.assignmentType || config.assignmentType,
    supportsRooms: Boolean(raw.supportsRooms ?? config.supportsRooms),
  };
};

module.exports = {
  MARKETPLACE_TYPE_CONFIG,
  decorateBusiness,
  getMarketplaceTypeConfig,
  normalizeBusinessType,
};
