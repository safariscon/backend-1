const { withPrimaryImage } = require("./serviceImages");

const CATEGORY_LABELS = [
  { match: ["car-rental", "car-rentals"], label: "Car Rental" },
  { match: ["restaurant"], label: "Restaurant" },
  { match: ["tour", "activity-operator"], label: "Tour Guide" },
  { match: ["apartment", "vacation-rental"], label: "Apartment" },
  { match: ["homestay", "guesthouse", "house"], label: "House" },
  { match: ["conference", "event-hall", "wedding-venue", "entertainment-venue"], label: "Event Organizer" },
  { match: ["hotel", "resort", "boutique", "extended-stay", "heritage", "airport"], label: "Hotel" },
  { match: ["motorbike", "scooter"], label: "Motorbike Rental" },
  { match: ["taxi", "ride-service"], label: "Taxi Service" },
  { match: ["bus", "minivan", "transport"], label: "Transport" },
  { match: ["bar", "pub"], label: "Bar" },
  { match: ["coffee", "cafe"], label: "Cafe" },
  { match: ["food-truck", "street-food"], label: "Food Service" },
  { match: ["spa", "wellness"], label: "Wellness Service" },
  { match: ["childcare"], label: "Childcare Service" },
  { match: ["gear-rental"], label: "Gear Rental" },
  { match: ["souvenir", "craft-market"], label: "Local Shop" },
];

const normalizeCategory = (value) =>
  String(value || "service")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[\s_/]+/g, "-");

const getGuestCategoryLabel = (category) => {
  const normalized = normalizeCategory(category);
  const found = CATEGORY_LABELS.find((entry) =>
    entry.match.some((fragment) => normalized.includes(fragment))
  );
  if (found) return found.label;
  return normalized
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Service";
};

const createGuestName = (category, number = 1) =>
  `${getGuestCategoryLabel(category)} ${Math.max(1, Number(number) || 1)}`;

const getDestinationRegion = (location) => {
  const parts = String(location || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return "Rwanda";
  const withoutCountry = parts.filter((part) => part.toLowerCase() !== "rwanda");
  return withoutCountry.at(-1) || "Rwanda";
};

const anonymizeBusiness = (business, guestName) => {
  const { images, primaryImage } = withPrimaryImage(business);
  return {
    _id: business._id,
    id: business._id,
    name: guestName,
    displayName: guestName,
    anonymousName: guestName,
    isAnonymous: true,
    type: business.type || "service",
    category: business.type || "service",
    location: business.locationDetails?.district || getDestinationRegion(business.location),
    destinationLocation: business.locationDetails?.district || getDestinationRegion(business.location),
    description: `Book this verified ${getGuestCategoryLabel(business.type).toLowerCase()} securely. Provider identity and exact details unlock after full payment.`,
    basePrice: 0,
    priceText: "",
    images,
    primaryImage,
    promotion: business.promotion || { enabled: false },
    amenities: [],
    services: [],
    approvalStatus: business.approvalStatus,
    status: business.status,
    availableQuantity: business.availableQuantity,
    quantityRemaining: business.quantityRemaining,
    inventoryStatus: business.inventoryStatus,
    bookingRules: business.bookingRules,
    bookingMode: business.bookingMode || "manual",
    availabilityTable: business.availabilityTable,
    bookingForm: business.bookingForm,
    createdAt: business.createdAt,
    updatedAt: business.updatedAt,
  };
};

const anonymizeBusinessList = (businesses = []) => {
  const counters = new Map();
  return businesses.map((business) => {
    const label = getGuestCategoryLabel(business.type);
    const number = (counters.get(label) || 0) + 1;
    counters.set(label, number);
    return anonymizeBusiness(business, `${label} ${number}`);
  });
};

module.exports = {
  anonymizeBusiness,
  anonymizeBusinessList,
  createGuestName,
  getGuestCategoryLabel,
};
