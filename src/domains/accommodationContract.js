const {
  fail,
  ok,
  asObject,
  cleanText,
  asBoolean,
  asInteger,
  asNumber,
  asStringList,
  asDateOnly,
  asTime,
  isPastDate,
  nightsBetween,
  todayDate,
} = require("./shared/helpers");

const STAR_RATINGS = ["unrated", "1-star", "2-star", "3-star", "4-star", "5-star"];
const LISTING_SCALES = ["single", "multiple"];
const PET_POLICIES = ["yes", "upon_request", "no"];
const CHILD_POLICIES = ["yes", "no"];
const FIRST_CHECK_IN_MODES = ["asap", "date"];
const HORIZON_DAYS = [365, 548];
const ID_TYPES = ["national_id", "passport", "company_registration"];
const RATE_PLANS = ["standard", "non_refundable", "weekly"];
const PRICING_MODES = ["unit", "per_guest"];

const PROPERTY_KINDS = [
  { id: "apartment", label: "Apartment", family: "apartment", categorySlug: "apartment" },
  { id: "serviced-apartment", label: "Serviced apartment", family: "apartment", categorySlug: "apartment" },
  { id: "holiday-home", label: "Holiday home", family: "home", categorySlug: "homestay" },
  { id: "villa", label: "Villa", family: "home", categorySlug: "homestay" },
  { id: "homestay", label: "Homestay", family: "home", categorySlug: "homestay" },
  { id: "hotel", label: "Hotel", family: "hotel", categorySlug: "hotel" },
  { id: "guest-house", label: "Guest house", family: "hotel", categorySlug: "guest-house" },
  { id: "bed-and-breakfast", label: "Bed and breakfast", family: "hotel", categorySlug: "bed-and-breakfast" },
  { id: "hostel", label: "Hostel", family: "hotel", categorySlug: "hostel" },
  { id: "aparthotel", label: "Aparthotel", family: "hotel", categorySlug: "hotel" },
  { id: "farm-stay", label: "Farm stay", family: "alternative", categorySlug: "homestay" },
  { id: "country-house", label: "Country house", family: "alternative", categorySlug: "homestay" },
];

const PROPERTY_KIND_IDS = PROPERTY_KINDS.map((item) => item.id);

const PROPERTY_AMENITIES = [
  "wifi",
  "air_conditioning",
  "non_smoking_rooms",
  "family_rooms",
  "front_desk_24h",
  "room_service",
  "bar",
  "restaurant",
  "fitness_centre",
  "sauna",
  "spa",
  "hot_tub",
  "swimming_pool",
  "garden",
  "terrace",
  "beach",
  "airport_shuttle",
  "ev_charging",
  "parking",
];

const ROOM_AMENITIES = [
  "clothes_rack",
  "flat_screen_tv",
  "air_conditioning",
  "linen",
  "desk",
  "wake_up_service",
  "towels",
  "wardrobe",
  "heating",
  "fan",
  "safe",
  "ground_floor",
  "balcony",
  "terrace",
  "view",
  "electric_kettle",
  "tea_coffee_maker",
  "dining_area",
  "dining_table",
  "microwave",
];

const BATHROOM_AMENITIES = [
  "toilet_paper",
  "shower",
  "toilet",
  "hairdryer",
  "bath",
  "toiletries",
  "bidet",
  "slippers",
  "bathrobe",
  "spa_bath",
];

const BED_TYPES = ["single", "double", "king", "super_king", "sofa_bed", "bunk"];

const UNIT_TYPES = ["single", "double", "twin", "triple", "studio", "suite", "family", "dorm"];

const STANDARD_UNIT_NAMES = [
  "Studio",
  "Entire apartment",
  "One-bedroom apartment",
  "Two-bedroom apartment",
  "Three-bedroom apartment",
  "Single Room",
  "Double Room",
  "Twin Room",
  "Deluxe Double Room",
  "Family Room",
  "Suite",
  "Dormitory Room",
];

const idsFrom = (allowed, value) =>
  asStringList(value).filter((item) => allowed.includes(item));

const kindMeta = (id) => PROPERTY_KINDS.find((item) => item.id === id) || null;

const parseBeds = (rawBeds, fallback = {}) => {
  if (Array.isArray(rawBeds) && rawBeds.length) {
    return rawBeds
      .map((bed) => ({
        type: BED_TYPES.includes(cleanText(bed?.type, 20)) ? cleanText(bed.type, 20) : "",
        count: Math.max(0, asInteger(bed?.count) || 0),
      }))
      .filter((bed) => bed.type && bed.count > 0);
  }
  const bedType = cleanText(fallback.bedType, 80).toLowerCase().replace(/\s+/g, "_");
  const mapped = BED_TYPES.includes(bedType) ? bedType : bedType.includes("king") ? "king" : bedType.includes("double") ? "double" : "";
  const count = asInteger(fallback.numberOfBeds);
  if (mapped && Number.isFinite(count) && count > 0) return [{ type: mapped, count }];
  return [];
};

const parsePricingMode = (raw) => {
  const mode = cleanText(raw, 20);
  return PRICING_MODES.includes(mode) ? mode : "unit";
};

const parseOccupancyPrices = (raw, maxGuests, fallbackPrice) => {
  const source = Array.isArray(raw) ? raw : [];
  const prices = source
    .map((row) => ({
      guests: asInteger(row?.guests),
      price: asNumber(row?.price),
    }))
    .filter((row) => Number.isFinite(row.guests) && row.guests >= 1 && Number.isFinite(row.price) && row.price >= 0)
    .sort((a, b) => a.guests - b.guests);
  if (prices.length) return prices;
  const price = asNumber(fallbackPrice);
  if (Number.isFinite(price) && price >= 0 && Number.isFinite(maxGuests)) {
    return [{ guests: maxGuests, price }];
  }
  return [];
};

const parseRatePlans = (raw = {}) => {
  const source = asObject(raw);
  const nonRefundable = asObject(source.nonRefundable);
  const weekly = asObject(source.weekly);
  return {
    nonRefundable: {
      enabled: asBoolean(nonRefundable.enabled),
      discountPercent: Math.max(1, Math.min(90, asInteger(nonRefundable.discountPercent) || 10)),
    },
    weekly: {
      enabled: asBoolean(weekly.enabled),
      discountPercent: Math.max(1, Math.min(90, asInteger(weekly.discountPercent) || 15)),
      minNights: Math.max(2, Math.min(30, asInteger(weekly.minNights) || 7)),
    },
  };
};

const parseHostIdentity = (raw = {}) => {
  const source = asObject(raw);
  const idType = ID_TYPES.includes(cleanText(source.idType, 40)) ? cleanText(source.idType, 40) : "";
  return {
    legalName: cleanText(source.legalName, 120),
    isCompany: asBoolean(source.isCompany),
    companyName: cleanText(source.companyName, 160),
    idType,
    idNumber: cleanText(source.idNumber, 80),
    billingSameAsProperty: source.billingSameAsProperty === false || source.billingSameAsProperty === "false" ? false : true,
    billingAddress: cleanText(source.billingAddress, 240),
  };
};

const sanitizeListingAttributesForPublic = (attributes = {}) => {
  const source = asObject(attributes);
  const identity = asObject(source.hostIdentity);
  return {
    ...source,
    hostIdentity: {
      legalName: cleanText(identity.legalName, 120),
      isCompany: asBoolean(identity.isCompany),
      companyName: cleanText(identity.companyName, 160),
      billingSameAsProperty: identity.billingSameAsProperty !== false,
      hasIdentityDocument: Boolean(cleanText(identity.idNumber, 80) && identity.idType),
    },
  };
};

const stayNightlyRate = ({ option = {}, guests }) => {
  const attrs = asObject(option.attributes || option);
  const base = Number(option.price || 0);
  const count = Math.max(1, Number(guests) || 1);
  const nightly = parsePricingMode(attrs.pricingMode) === "per_guest" ? base * count : base;
  return Number.isFinite(nightly) && nightly >= 0 ? nightly : 0;
};

const applyRatePlanDiscount = ({ amount, nights, ratePlan, listingAttributes = {} }) => {
  const plans = parseRatePlans(listingAttributes.ratePlans);
  if (ratePlan === "non_refundable" && plans.nonRefundable.enabled) {
    return Math.round(amount * (1 - plans.nonRefundable.discountPercent / 100));
  }
  if (ratePlan === "weekly" && plans.weekly.enabled && nights >= plans.weekly.minNights) {
    return Math.round(amount * (1 - plans.weekly.discountPercent / 100));
  }
  return Math.round(amount);
};

const calculateStayQuote = ({ option = {}, listing = {}, guests = 1, nights = 1, ratePlan = "standard" } = {}) => {
  const listingDetails = asObject(listing.listingAttributes || listing);
  const attrs = asObject(option.attributes || option);
  const stayNights = Math.max(1, Number(nights) || 1);
  const guestCount = Math.max(1, Number(guests) || 1);
  const pricingMode = parsePricingMode(attrs.pricingMode);
  const unitPrice = Number(option.price || 0);
  const nightly = stayNightlyRate({ option, guests: guestCount });
  const subtotal = nightly * stayNights;
  const total = applyRatePlanDiscount({
    amount: subtotal,
    nights: stayNights,
    ratePlan,
    listingAttributes: listingDetails,
  });
  return {
    pricingMode,
    unitPrice: Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0,
    nightly,
    nights: stayNights,
    guests: guestCount,
    ratePlan: RATE_PLANS.includes(ratePlan) ? ratePlan : "standard",
    subtotal: Math.round(subtotal),
    total: Math.max(0, total),
    childrenStayFree: asBoolean(listingDetails.childrenStayFree),
  };
};

const validateListing = (input = {}, subtype = "") => {
  const raw = asObject(input);
  const errors = [];

  const checkInFrom = asTime(raw.checkInFrom) || asTime(raw.checkInTime);
  const checkInUntil = asTime(raw.checkInUntil) || checkInFrom;
  const checkOutFrom = asTime(raw.checkOutFrom) || "";
  const checkOutUntil = asTime(raw.checkOutUntil) || asTime(raw.checkOutTime);
  if (!checkInFrom) errors.push("Check-in time is required.");
  if (!checkOutUntil) errors.push("Check-out time is required.");

  const starRating = cleanText(raw.starRating, 20) || "unrated";
  if (!STAR_RATINGS.includes(starRating)) errors.push("Star rating is invalid.");

  const listingScale = LISTING_SCALES.includes(cleanText(raw.listingScale, 20))
    ? cleanText(raw.listingScale, 20)
    : "single";
  const requestedKind = cleanText(raw.propertyKind, 40) || subtype || "";
  const propertyKind = PROPERTY_KIND_IDS.includes(requestedKind) ? requestedKind : subtype || "hotel";

  const allowsChildren = CHILD_POLICIES.includes(cleanText(raw.allowsChildren, 8))
    ? cleanText(raw.allowsChildren, 8)
    : "yes";
  const allowsPets = PET_POLICIES.includes(cleanText(raw.allowsPets, 20))
    ? cleanText(raw.allowsPets, 20)
    : "no";

  const firstCheckInMode = FIRST_CHECK_IN_MODES.includes(cleanText(raw.firstCheckInMode, 12))
    ? cleanText(raw.firstCheckInMode, 12)
    : "asap";
  const firstCheckInDate = asDateOnly(raw.firstCheckInDate);
  if (firstCheckInMode === "date" && !firstCheckInDate) {
    errors.push("Choose the first date guests can check in.");
  }

  const availabilityHorizonDays = HORIZON_DAYS.includes(asInteger(raw.availabilityHorizonDays))
    ? asInteger(raw.availabilityHorizonDays)
    : 365;
  const allowLongStays = asBoolean(raw.allowLongStays);
  const maxStayNights = allowLongStays
    ? Math.max(31, Math.min(90, asInteger(raw.maxStayNights) || 90))
    : Math.max(1, Math.min(30, asInteger(raw.maxStayNights) || 30));

  const identitySource = asObject(raw.hostIdentity);
  const requireHostIdentity =
    asBoolean(raw.requireHostIdentity) || Object.keys(identitySource).some((key) => identitySource[key]);
  const hostIdentity = parseHostIdentity(identitySource);
  if (requireHostIdentity) {
    if (!hostIdentity.legalName) errors.push("Invoice / host legal name is required.");
    if (!hostIdentity.idType || !hostIdentity.idNumber) {
      errors.push("An identity document type and number are required for verification.");
    }
    if (hostIdentity.isCompany && !hostIdentity.companyName) {
      errors.push("Legal company name is required for a business listing.");
    }
    if (!hostIdentity.billingSameAsProperty && !hostIdentity.billingAddress) {
      errors.push("Enter a billing address, or use the same address as the property.");
    }
  }

  if (errors.length) return fail(errors);

  const curatedAmenities = idsFrom(PROPERTY_AMENITIES, raw.amenities);
  const customAmenities = asStringList(raw.amenities).filter((item) => !PROPERTY_AMENITIES.includes(item));
  const amenities = [...curatedAmenities, ...customAmenities];

  return ok({
    propertyKind,
    listingScale,
    isManagementCompany: asBoolean(raw.isManagementCompany),
    starRating,
    checkInTime: checkInFrom,
    checkOutTime: checkOutUntil,
    checkInFrom,
    checkInUntil,
    checkOutFrom,
    checkOutUntil,
    allowsChildren,
    allowsPets,
    childrenStayFree: asBoolean(raw.childrenStayFree),
    excludeInfantsFromOccupancy: asBoolean(raw.excludeInfantsFromOccupancy),
    amenities,
    firstCheckInMode,
    firstCheckInDate: firstCheckInMode === "date" ? firstCheckInDate : "",
    availabilityHorizonDays,
    allowLongStays,
    maxStayNights,
    calendarImportUrl: cleanText(raw.calendarImportUrl, 500),
    ratePlans: parseRatePlans(raw.ratePlans),
    hostIdentity,
  });
};

const validateInventory = (input = {}) => {
  const raw = asObject(input);
  const errors = [];
  const maxGuests = asInteger(raw.maxGuests);
  if (!Number.isFinite(maxGuests) || maxGuests < 1) errors.push("Max guests must be at least 1.");

  const quantity = raw.quantity == null || raw.quantity === "" ? 1 : asInteger(raw.quantity);
  if (!Number.isFinite(quantity) || quantity < 1) errors.push("Room quantity must be at least 1.");

  const bedrooms = raw.bedrooms == null || raw.bedrooms === "" ? null : asInteger(raw.bedrooms);
  if (bedrooms != null && (!Number.isFinite(bedrooms) || bedrooms < 0)) {
    errors.push("Bedrooms cannot be negative.");
  }

  const beds = parseBeds(raw.beds, raw);
  const numberOfBeds = beds.reduce((sum, bed) => sum + bed.count, 0) || (raw.numberOfBeds == null || raw.numberOfBeds === "" ? null : asInteger(raw.numberOfBeds));
  if (numberOfBeds != null && (!Number.isFinite(numberOfBeds) || numberOfBeds < 1)) {
    errors.push("Add at least one bed.");
  }

  const occupancyPrices = parseOccupancyPrices(raw.occupancyPrices, maxGuests, raw.price);
  const pricingMode = parsePricingMode(raw.pricingMode);
  const unitType = UNIT_TYPES.includes(cleanText(raw.unitType, 20)) ? cleanText(raw.unitType, 20) : "double";
  const unitName = cleanText(raw.unitName || raw.name, 80);

  if (errors.length) return fail(errors);

  return ok({
    unitName,
    unitType,
    maxGuests,
    bedrooms,
    beds,
    bedType: beds[0]?.type || cleanText(raw.bedType, 80),
    numberOfBeds: numberOfBeds || beds[0]?.count || 1,
    quantity,
    excludeInfants: asBoolean(raw.excludeInfants),
    bathroomPrivate: raw.bathroomPrivate === false || raw.bathroomPrivate === "false" ? false : true,
    bathroomAmenities: idsFrom(BATHROOM_AMENITIES, raw.bathroomAmenities),
    roomAmenities: idsFrom(ROOM_AMENITIES, raw.roomAmenities),
    occupancyPrices,
    pricingMode,
    breakfastIncluded: asBoolean(raw.breakfastIncluded),
    amenities: asStringList(raw.amenities),
  });
};

const validateBooking = ({ payload = {}, listing = {}, inventory = {} } = {}) => {
  const raw = asObject(payload);
  const listingDetails = asObject(listing.listingAttributes || listing);
  const inventoryDetails = asObject(inventory.attributes || inventory);
  const errors = [];

  const checkIn = asDateOnly(raw.checkIn);
  const checkOut = asDateOnly(raw.checkOut);
  const guests = asInteger(raw.guests);
  const ratePlan = RATE_PLANS.includes(cleanText(raw.ratePlan, 20)) ? cleanText(raw.ratePlan, 20) : "standard";

  if (!checkIn) errors.push("Check-in date is required.");
  if (!checkOut) errors.push("Check-out date is required.");
  if (!Number.isFinite(guests) || guests < 1) errors.push("Number of guests must be at least 1.");
  if (checkIn && isPastDate(checkIn)) errors.push("Check-in cannot be in the past.");
  if (checkIn && checkOut && checkOut <= checkIn) errors.push("Check-out must be after check-in.");

  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0;
  const maxStayNights = asInteger(listingDetails.maxStayNights) || (asBoolean(listingDetails.allowLongStays) ? 90 : 30);
  if (nights > maxStayNights) {
    errors.push(`This stay allows a maximum of ${maxStayNights} nights.`);
  }

  const firstDate =
    listingDetails.firstCheckInMode === "date" ? asDateOnly(listingDetails.firstCheckInDate) : todayDate();
  if (checkIn && firstDate && checkIn < firstDate) {
    errors.push(`Guests can check in from ${firstDate}.`);
  }

  if (listingDetails.allowsChildren === "no" && asInteger(raw.children) > 0) {
    errors.push("This property does not allow children.");
  }

  const maxGuests = asInteger(inventoryDetails.maxGuests);
  if (Number.isFinite(maxGuests) && Number.isFinite(guests) && guests > maxGuests) {
    errors.push(`This room allows a maximum of ${maxGuests} guests.`);
  }

  const weekly = parseRatePlans(listingDetails.ratePlans).weekly;
  if (ratePlan === "weekly" && weekly.enabled && nights < weekly.minNights) {
    errors.push(`The weekly rate requires at least ${weekly.minNights} nights.`);
  }

  if (errors.length) return fail(errors);

  return ok({
    payload: {
      checkIn,
      checkOut,
      guests,
      nights,
      ratePlan,
      specialRequests: cleanText(raw.specialRequests, 1000),
    },
    schedule: {
      startDate: checkIn,
      endDate: checkOut,
      startTime: "",
      endTime: "",
      guests,
      numberOfPeople: guests,
      quantity: 1,
    },
  });
};

module.exports = {
  STAR_RATINGS,
  LISTING_SCALES,
  PET_POLICIES,
  CHILD_POLICIES,
  PROPERTY_KINDS,
  PROPERTY_AMENITIES,
  ROOM_AMENITIES,
  BATHROOM_AMENITIES,
  BED_TYPES,
  UNIT_TYPES,
  STANDARD_UNIT_NAMES,
  RATE_PLANS,
  PRICING_MODES,
  kindMeta,
  sanitizeListingAttributesForPublic,
  calculateStayQuote,
  validateListing,
  validateInventory,
  validateBooking,
};
