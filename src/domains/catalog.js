const field = (id, label, type, extra = {}) => ({
  id,
  label,
  type,
  required: Boolean(extra.required),
  placeholder: extra.placeholder || "",
  helpText: extra.helpText || "",
  options: extra.options || [],
  validation: extra.validation || { min: null, max: null, pattern: null },
  visibility: extra.visibility || "public",
  appliesTo: extra.appliesTo || "listing",
  sortOrder: extra.sortOrder ?? 0,
});

const MOTORBIKE_CATEGORY_OPTIONS = [
  { value: "scooter", label: "Scooter" },
  { value: "taxi-moto", label: "Taxi-moto style" },
  { value: "safari-adventure", label: "Safari / adventure" },
];

const MOTORBIKE_LICENCE_CLASS_OPTIONS = [
  { value: "A1", label: "Class A1 — automatic scooters under 125cc" },
  { value: "A", label: "Class A — manual motorbikes and taxi-motos over 125cc" },
];

const CAR_LICENCE_CLASS_OPTIONS = [
  { value: "B", label: "Class B — light vehicles and cars" },
  { value: "C", label: "Class C — trucks and heavy goods vehicles" },
  { value: "D", label: "Class D — buses and minibuses" },
  { value: "E", label: "Class E — vehicles with a trailer" },
];

const RWANDA_DISTRICT_OPTIONS = [
  "Bugesera", "Burera", "Gakenke", "Gasabo", "Gatsibo", "Gicumbi", "Gisagara", "Huye", "Kamonyi", "Karongi",
  "Kayonza", "Kicukiro", "Kirehe", "Muhanga", "Musanze", "Ngoma", "Ngororero", "Nyabihu", "Nyagatare", "Nyamagabe",
  "Nyamasheke", "Nyanza", "Nyarugenge", "Nyaruguru", "Rubavu", "Ruhango", "Rulindo", "Rusizi", "Rutsiro", "Rwamagana",
].map((district) => ({ value: district, label: district }));

const DOMAIN_LABELS = {
  accommodation: "Accommodation",
  transport: "Transport",
  experiences: "Experiences",
  dining: "Dining",
  venues: "Venues",
};

const STAY_AVAILABILITY = {
  listingRequiresAvailability: false,
  optionRequiresAvailability: true,
  modes: { dateWindow: true, daysOfWeek: false, timeOfDay: false },
  trackCapacity: true,
};

const STAY_CONSUMPTION = {
  requireConsumptionStartDate: true,
  requireConsumptionEndDate: true,
  requireConsumptionStartTime: false,
  requireConsumptionEndTime: false,
};

const STAY_LISTING_FIELDS = [
  field("propertyKind", "Property kind", "select", { sortOrder: 1 }),
  field("checkInTime", "Check-in from", "time", { required: true, sortOrder: 2 }),
  field("checkOutTime", "Check-out until", "time", { required: true, sortOrder: 3 }),
  field("starRating", "Star rating", "select", {
    options: ["unrated", "1-star", "2-star", "3-star", "4-star", "5-star"],
    sortOrder: 4,
  }),
  field("amenities", "Property amenities", "checkbox", { sortOrder: 5 }),
];

const STAY_INVENTORY_FIELDS = [
  field("maxGuests", "Max guests", "number", { required: true, appliesTo: "option", sortOrder: 1, validation: { min: 1 } }),
  field("unitType", "Unit type", "select", { appliesTo: "option", sortOrder: 2 }),
  field("bedrooms", "Bedrooms", "number", { appliesTo: "option", sortOrder: 3, validation: { min: 0 } }),
  field("quantity", "Units of this type", "number", { appliesTo: "option", sortOrder: 4, validation: { min: 1 } }),
];

const STAY_BOOKING_FIELDS = [
  field("checkIn", "Check-in date", "date", { required: true, appliesTo: "booking", sortOrder: 1 }),
  field("checkOut", "Check-out date", "date", { required: true, appliesTo: "booking", sortOrder: 2 }),
  field("guests", "Guests", "number", { required: true, appliesTo: "booking", sortOrder: 3, validation: { min: 1 } }),
  field("ratePlan", "Rate plan", "select", { appliesTo: "booking", sortOrder: 4 }),
  field("specialRequests", "Special requests", "textarea", { appliesTo: "booking", sortOrder: 5 }),
];

const stayCategory = ({
  slug,
  name,
  subtype,
  sortOrder,
  inventoryLabel = "Room",
  inventoryLabelPlural = "Rooms",
  description,
  cancellation = { type: "moderate", freeCancellationUntilHours: 48, depositRefundable: false },
}) => ({
  slug,
  name,
  domain: "accommodation",
  subtype,
  group: "Accommodation",
  sortOrder,
  supportsOptions: true,
  inventoryKind: "room",
  inventoryLabel,
  inventoryLabelPlural,
  description,
  defaults: {
    suggestedCancelWindowHours: 24,
    payment: { depositPercentage: 50, remainingPaymentMethod: "PAY_AT_ARRIVAL" },
    cancellation,
  },
  availabilityPolicy: STAY_AVAILABILITY,
  consumptionPolicy: STAY_CONSUMPTION,
  listingFields: STAY_LISTING_FIELDS,
  inventoryFields: STAY_INVENTORY_FIELDS,
  bookingFields: STAY_BOOKING_FIELDS,
});

const PLATFORM_CATEGORIES = [
  stayCategory({
    slug: "hotel",
    name: "Hotel",
    subtype: "hotel",
    sortOrder: 10,
    description: "Hotels with nightly rates, rooms, house rules, and occupancy pricing.",
  }),
  stayCategory({
    slug: "apartment",
    name: "Apartment",
    subtype: "apartment",
    sortOrder: 20,
    inventoryLabel: "Unit",
    inventoryLabelPlural: "Units",
    description: "Entire apartments and serviced units for short or extended stays.",
  }),
  stayCategory({
    slug: "homestay",
    name: "Homestay",
    subtype: "homestay",
    sortOrder: 30,
    description: "Hosted rooms, holiday homes, and family stays.",
    cancellation: { type: "flexible", freeCancellationUntilHours: 24, depositRefundable: false },
  }),
  stayCategory({
    slug: "guest-house",
    name: "Guest house",
    subtype: "guest-house",
    sortOrder: 32,
    description: "Private homes with separate living facilities for host and guests.",
  }),
  stayCategory({
    slug: "bed-and-breakfast",
    name: "Bed and breakfast",
    subtype: "bed-and-breakfast",
    sortOrder: 34,
    description: "Private homes offering overnight stays and breakfast.",
  }),
  stayCategory({
    slug: "hostel",
    name: "Hostel",
    subtype: "hostel",
    sortOrder: 36,
    description: "Budget stays with private rooms or dorm-style beds.",
  }),
  {
    slug: "car-rental",
    name: "Car Rental",
    domain: "transport",
    subtype: "car-rental",
    group: "Transport",
    sortOrder: 40,
    supportsOptions: true,
    inventoryKind: "vehicle",
    inventoryLabel: "Vehicle",
    inventoryLabelPlural: "Vehicles",
    description: "Self-drive or chauffeur vehicle hire.",
    defaults: {
      suggestedCancelWindowHours: 6,
      payment: { depositPercentage: 50, remainingPaymentMethod: "PAY_AT_ARRIVAL" },
      cancellation: { type: "moderate", freeCancellationUntilHours: 24, depositRefundable: false },
    },
    availabilityPolicy: {
      listingRequiresAvailability: false,
      optionRequiresAvailability: true,
      modes: { dateWindow: true, daysOfWeek: false, timeOfDay: false },
      trackCapacity: true,
    },
    consumptionPolicy: {
      requireConsumptionStartDate: true,
      requireConsumptionEndDate: true,
      requireConsumptionStartTime: true,
      requireConsumptionEndTime: true,
    },
    listingFields: [
      field("vehicleClass", "Vehicle class", "select", {
        required: true,
        options: ["Economy", "Compact", "SUV", "Van", "Luxury"],
        sortOrder: 1,
      }),
      field("transmission", "Transmission", "select", {
        required: true,
        options: ["Automatic", "Manual"],
        sortOrder: 2,
      }),
      field("withDriver", "With driver?", "boolean", { sortOrder: 3 }),
      field("fuelType", "Fuel type", "select", {
        options: ["Petrol", "Diesel", "Hybrid / Electric"],
        sortOrder: 4,
        helpText: "Petrol for most cars, diesel for efficiency, hybrid or electric for lower emissions.",
      }),
      field("fuelPolicy", "Fuel policy", "select", {
        options: ["Full-to-full", "Same-to-same", "Prepaid"],
        sortOrder: 5,
      }),
      field("insuranceIncluded", "Insurance included?", "boolean", { sortOrder: 6 }),
      field("minimumDriverAge", "Minimum driver age", "number", { required: true, sortOrder: 7, validation: { min: 18 } }),
      field("pickupTime", "Pickup from", "time", { sortOrder: 8 }),
      field("returnTime", "Return by", "time", { sortOrder: 9 }),
      field("minRentalDays", "Minimum rental (days)", "number", { sortOrder: 10, validation: { min: 1 } }),
      field("maxRentalDays", "Maximum rental (days)", "number", { sortOrder: 11, validation: { min: 1 } }),
      field("depositNote", "Security deposit note", "textarea", { sortOrder: 12 }),
      field("allowedLicenceClasses", "Permit classes you accept", "multiselect", {
        required: true,
        sortOrder: 13,
        options: CAR_LICENCE_CLASS_OPTIONS,
        helpText: "Customers must hold one of these classes to book.",
      }),
      field("pickupLocation", "Pickup location", "text", {
        required: true,
        sortOrder: 14,
        helpText: "Where customers collect the vehicle. Shown on the listing and in booking emails.",
      }),
      field("returnLocation", "Return location", "text", {
        required: true,
        sortOrder: 15,
        helpText: "Where customers return the vehicle.",
      }),
      field("requireLicenceUpload", "Require a photo of the permit at booking", "boolean", { sortOrder: 16 }),
    ],
    inventoryFields: [
      field("make", "Make", "text", { appliesTo: "option", sortOrder: 1 }),
      field("model", "Model", "text", { appliesTo: "option", sortOrder: 2 }),
      field("seats", "Seats", "number", { required: true, appliesTo: "option", sortOrder: 3, validation: { min: 1 } }),
      field("luggage", "Luggage capacity", "text", { appliesTo: "option", sortOrder: 4 }),
      field("ac", "Air conditioning", "boolean", { appliesTo: "option", sortOrder: 5 }),
      field("quantity", "Number of cars of this type", "number", { appliesTo: "option", sortOrder: 6, validation: { min: 1 } }),
    ],
    bookingFields: [
      field("pickupDateTime", "Pickup date", "datetime-local", { required: true, appliesTo: "booking", sortOrder: 1 }),
      field("returnDateTime", "Return date", "datetime-local", { required: true, appliesTo: "booking", sortOrder: 2 }),
      field("driverAge", "Driver age", "number", { required: true, appliesTo: "booking", sortOrder: 3, validation: { min: 18 } }),
      field("driverLicenseNumber", "Driver license number", "text", {
        required: true,
        appliesTo: "booking",
        visibility: "after_payment",
        sortOrder: 4,
      }),
      field("numberOfDrivers", "Number of drivers", "number", { required: true, appliesTo: "booking", sortOrder: 5, validation: { min: 1 } }),
      field("licenceClass", "Licence class", "select", { required: true, appliesTo: "booking", sortOrder: 6, options: CAR_LICENCE_CLASS_OPTIONS }),
      field("licenceImageFront", "Licence photo (front)", "image", { required: true, appliesTo: "booking", sortOrder: 7, visibility: "private" }),
      field("licenceImageBack", "Licence photo (back)", "image", { required: true, appliesTo: "booking", sortOrder: 8, visibility: "private" }),
    ],
  },
  {
    slug: "taxi",
    name: "Taxi",
    domain: "transport",
    subtype: "taxi",
    group: "Transport",
    sortOrder: 50,
    supportsOptions: true,
    inventoryKind: "vehicle",
    inventoryLabel: "Vehicle",
    inventoryLabelPlural: "Vehicles",
    description: "Point-to-point taxi transfers.",
    defaults: {
      suggestedCancelWindowHours: 2,
      payment: { depositPercentage: 50, remainingPaymentMethod: "PAY_AT_ARRIVAL" },
      cancellation: { type: "strict", freeCancellationUntilHours: 2, depositRefundable: false },
    },
    availabilityPolicy: {
      listingRequiresAvailability: false,
      optionRequiresAvailability: true,
      modes: { dateWindow: true, daysOfWeek: true, timeOfDay: true },
      trackCapacity: true,
    },
    consumptionPolicy: {
      requireConsumptionStartDate: true,
      requireConsumptionEndDate: false,
      requireConsumptionStartTime: true,
      requireConsumptionEndTime: false,
    },
    listingFields: [
      field("vehicleType", "Vehicle type", "text", { required: true, sortOrder: 1 }),
    ],
    inventoryFields: [
      field("seats", "Seats", "number", { appliesTo: "option", sortOrder: 1, validation: { min: 1 } }),
    ],
    bookingFields: [
      field("pickupLocation", "Pickup location", "text", { required: true, appliesTo: "booking", sortOrder: 1 }),
      field("dropoffLocation", "Drop-off location", "text", { required: true, appliesTo: "booking", sortOrder: 2 }),
      field("pickupDateTime", "Pickup date/time", "datetime-local", { required: true, appliesTo: "booking", sortOrder: 3 }),
    ],
  },
  {
    slug: "motorbike",
    name: "Motorbike",
    domain: "transport",
    subtype: "motorbike",
    group: "Transport",
    sortOrder: 60,
    supportsOptions: true,
    inventoryKind: "vehicle",
    inventoryLabel: "Bike",
    inventoryLabelPlural: "Bikes",
    description: "Motorbike hire.",
    defaults: {
      suggestedCancelWindowHours: 6,
      payment: { depositPercentage: 50, remainingPaymentMethod: "PAY_AT_ARRIVAL" },
      cancellation: { type: "moderate", freeCancellationUntilHours: 12, depositRefundable: false },
    },
    availabilityPolicy: {
      listingRequiresAvailability: false,
      optionRequiresAvailability: true,
      modes: { dateWindow: true, daysOfWeek: false, timeOfDay: false },
      trackCapacity: true,
    },
    consumptionPolicy: {
      requireConsumptionStartDate: true,
      requireConsumptionEndDate: true,
      requireConsumptionStartTime: true,
      requireConsumptionEndTime: true,
    },
    listingFields: [
      field("helmetIncluded", "Helmet included", "boolean", { sortOrder: 1 }),
      field("minimumDriverAge", "Minimum rider age", "number", { sortOrder: 2, validation: { min: 16 } }),
      field("pickupTime", "Pickup from", "time", { sortOrder: 3 }),
      field("returnTime", "Return by", "time", { sortOrder: 4 }),
      field("minRentalDays", "Minimum rental (days)", "number", { sortOrder: 5, validation: { min: 1 } }),
      field("maxRentalDays", "Maximum rental (days)", "number", { sortOrder: 6, validation: { min: 1 } }),
      field("allowedLicenceClasses", "Permit classes you accept", "multiselect", {
        required: true,
        sortOrder: 7,
        options: MOTORBIKE_LICENCE_CLASS_OPTIONS,
        helpText: "Customers must hold one of these classes to book.",
      }),
      field("pickupLocation", "Pickup location", "text", {
        required: true,
        sortOrder: 8,
        helpText: "Where customers collect the bike. Shown on the listing and in booking emails.",
      }),
      field("returnLocation", "Return location", "text", {
        required: true,
        sortOrder: 9,
        helpText: "Where customers return the bike.",
      }),
      field("requireLicenceUpload", "Require a photo of the permit at booking", "boolean", { sortOrder: 10 }),
      field("depositNote", "Security deposit note", "textarea", { sortOrder: 11 }),
    ],
    inventoryFields: [
      field("plateNumber", "Plate number", "text", { required: true, appliesTo: "option", sortOrder: 1, placeholder: "RE 100 A" }),
      field("chassisNumber", "Chassis number (VIN)", "text", { appliesTo: "option", sortOrder: 2 }),
      field("motoCategory", "Bike category", "select", { appliesTo: "option", sortOrder: 3, options: MOTORBIKE_CATEGORY_OPTIONS }),
      field("engineCc", "Engine size (cc)", "number", { required: true, appliesTo: "option", sortOrder: 4, validation: { min: 30 } }),
      field("insuranceExpiry", "Insurance expiry", "date", { required: true, appliesTo: "option", sortOrder: 5 }),
      field("helmetsProvided", "Helmets provided", "number", { appliesTo: "option", sortOrder: 6, validation: { min: 0 } }),
    ],
    bookingFields: [
      field("selectedCategory", "Bike category", "select", { appliesTo: "booking", sortOrder: 1, options: MOTORBIKE_CATEGORY_OPTIONS }),
      field("pickupDateTime", "Pickup date", "datetime-local", { required: true, appliesTo: "booking", sortOrder: 2 }),
      field("returnDateTime", "Return date", "datetime-local", { required: true, appliesTo: "booking", sortOrder: 3 }),
      field("driverAge", "Rider age", "number", { required: true, appliesTo: "booking", sortOrder: 4, validation: { min: 16 } }),
      field("driverLicenseNumber", "Driving licence number", "text", { required: true, appliesTo: "booking", sortOrder: 5 }),
      field("licenceClass", "Licence class", "select", { required: true, appliesTo: "booking", sortOrder: 6, options: MOTORBIKE_LICENCE_CLASS_OPTIONS }),
      field("licenceImageFront", "Licence photo (front)", "image", { required: true, appliesTo: "booking", sortOrder: 7, visibility: "private" }),
      field("licenceImageBack", "Licence photo (back)", "image", { required: true, appliesTo: "booking", sortOrder: 8, visibility: "private" }),
    ],
  },
  {
    slug: "tour",
    name: "Tour",
    domain: "experiences",
    subtype: "tour",
    group: "Experiences",
    sortOrder: 70,
    supportsOptions: true,
    inventoryKind: "package",
    inventoryLabel: "Package",
    inventoryLabelPlural: "Packages",
    description: "Guided tours and destination experiences.",
    defaults: {
      suggestedCancelWindowHours: 24,
      payment: { depositPercentage: 50, remainingPaymentMethod: "PAY_AT_ARRIVAL" },
      cancellation: { type: "moderate", freeCancellationUntilHours: 24, depositRefundable: false },
    },
    availabilityPolicy: {
      listingRequiresAvailability: false,
      optionRequiresAvailability: true,
      modes: { dateWindow: true, daysOfWeek: true, timeOfDay: true },
      trackCapacity: true,
    },
    consumptionPolicy: {
      requireConsumptionStartDate: true,
      requireConsumptionEndDate: false,
      requireConsumptionStartTime: false,
      requireConsumptionEndTime: false,
    },
    listingFields: [
      field("duration", "Duration", "text", { required: true, sortOrder: 1 }),
      field("difficulty", "Difficulty", "select", {
        options: ["Easy", "Moderate", "Challenging"],
        sortOrder: 2,
      }),
      field("meetingPoint", "Meeting point", "text", { required: true, sortOrder: 3 }),
      field("included", "What's included", "textarea", { sortOrder: 4 }),
      field("excluded", "What's excluded", "textarea", { sortOrder: 5 }),
    ],
    inventoryFields: [
      field("packageType", "Package type", "select", {
        options: ["Adult", "Child", "Family"],
        appliesTo: "option",
        sortOrder: 1,
      }),
    ],
    bookingFields: [
      field("preferredDate", "Preferred date", "date", { required: true, appliesTo: "booking", sortOrder: 1 }),
      field("participants", "Participants", "number", { required: true, appliesTo: "booking", sortOrder: 2, validation: { min: 1 } }),
      field("adults", "Adults", "number", { appliesTo: "booking", sortOrder: 3, validation: { min: 0 } }),
      field("children", "Children", "number", { appliesTo: "booking", sortOrder: 4, validation: { min: 0 } }),
      field("language", "Preferred language", "text", { appliesTo: "booking", sortOrder: 5 }),
      field("pickupRequired", "Need pickup?", "boolean", { appliesTo: "booking", sortOrder: 6 }),
      field("specialRequirements", "Special requirements", "textarea", { appliesTo: "booking", sortOrder: 7 }),
    ],
  },
  {
    slug: "activity-operator",
    name: "Activity",
    domain: "experiences",
    subtype: "activity",
    group: "Experiences",
    sortOrder: 80,
    supportsOptions: true,
    inventoryKind: "package",
    inventoryLabel: "Package",
    inventoryLabelPlural: "Packages",
    description: "Adventure and activity operators.",
    defaults: {
      suggestedCancelWindowHours: 12,
      payment: { depositPercentage: 50, remainingPaymentMethod: "PAY_AT_ARRIVAL" },
      cancellation: { type: "strict", freeCancellationUntilHours: 12, depositRefundable: false },
    },
    availabilityPolicy: {
      listingRequiresAvailability: false,
      optionRequiresAvailability: true,
      modes: { dateWindow: true, daysOfWeek: true, timeOfDay: true },
      trackCapacity: true,
    },
    consumptionPolicy: {
      requireConsumptionStartDate: true,
      requireConsumptionEndDate: false,
      requireConsumptionStartTime: false,
      requireConsumptionEndTime: false,
    },
    listingFields: [
      field("duration", "Duration", "text", { required: true, sortOrder: 1 }),
      field("difficulty", "Difficulty", "select", {
        options: ["Easy", "Moderate", "Challenging"],
        sortOrder: 2,
      }),
      field("meetingPoint", "Meeting point", "text", { sortOrder: 3 }),
    ],
    inventoryFields: [
      field("packageType", "Package type", "select", {
        options: ["Adult", "Child", "Family"],
        appliesTo: "option",
        sortOrder: 1,
      }),
    ],
    bookingFields: [
      field("preferredDate", "Preferred date", "date", { required: true, appliesTo: "booking", sortOrder: 1 }),
      field("participants", "Participants", "number", { required: true, appliesTo: "booking", sortOrder: 2, validation: { min: 1 } }),
      field("specialRequirements", "Special requirements", "textarea", { appliesTo: "booking", sortOrder: 3 }),
    ],
  },
  {
    slug: "restaurant",
    name: "Restaurant",
    domain: "dining",
    subtype: "restaurant",
    group: "Dining",
    sortOrder: 110,
    supportsOptions: false,
    inventoryKind: null,
    inventoryLabel: null,
    inventoryLabelPlural: null,
    description: "Restaurant table reservations.",
    defaults: {
      suggestedCancelWindowHours: 4,
      payment: { depositPercentage: 50, remainingPaymentMethod: "PAY_AT_ARRIVAL" },
      cancellation: { type: "flexible", freeCancellationUntilHours: 4, depositRefundable: false },
    },
    availabilityPolicy: {
      listingRequiresAvailability: true,
      optionRequiresAvailability: false,
      modes: { dateWindow: true, daysOfWeek: true, timeOfDay: true },
      trackCapacity: true,
    },
    consumptionPolicy: {
      requireConsumptionStartDate: true,
      requireConsumptionEndDate: false,
      requireConsumptionStartTime: true,
      requireConsumptionEndTime: false,
    },
    listingFields: [
      field("cuisine", "Cuisine", "text", { required: true, sortOrder: 1 }),
      field("dressCode", "Dress code", "text", { sortOrder: 2 }),
      field("averagePrice", "Average price (RWF)", "number", { sortOrder: 3, validation: { min: 0 } }),
      field("seatingCapacity", "Seating capacity", "number", { required: true, sortOrder: 4, validation: { min: 1 } }),
      field("openingHours", "Opening hours", "textarea", { sortOrder: 5 }),
    ],
    inventoryFields: [],
    bookingFields: [
      field("reservationDateTime", "Reservation date/time", "datetime-local", { required: true, appliesTo: "booking", sortOrder: 1 }),
      field("partySize", "Party size", "number", { required: true, appliesTo: "booking", sortOrder: 2, validation: { min: 1 } }),
      field("allergies", "Allergies", "textarea", { appliesTo: "booking", sortOrder: 3 }),
      field("specialRequests", "Special requests", "textarea", { appliesTo: "booking", sortOrder: 4 }),
    ],
  },
  {
    slug: "cafe",
    name: "Cafe",
    domain: "dining",
    subtype: "cafe",
    group: "Dining",
    sortOrder: 120,
    supportsOptions: false,
    inventoryKind: null,
    description: "Cafe reservations.",
    defaults: {
      suggestedCancelWindowHours: 2,
      payment: { depositPercentage: 50, remainingPaymentMethod: "PAY_AT_ARRIVAL" },
      cancellation: { type: "flexible", freeCancellationUntilHours: 2, depositRefundable: false },
    },
    availabilityPolicy: {
      listingRequiresAvailability: true,
      optionRequiresAvailability: false,
      modes: { dateWindow: true, daysOfWeek: true, timeOfDay: true },
      trackCapacity: true,
    },
    consumptionPolicy: {
      requireConsumptionStartDate: true,
      requireConsumptionEndDate: false,
      requireConsumptionStartTime: true,
      requireConsumptionEndTime: false,
    },
    listingFields: [
      field("cuisine", "Cuisine / specialty", "text", { required: true, sortOrder: 1 }),
      field("seatingCapacity", "Seating capacity", "number", { required: true, sortOrder: 2, validation: { min: 1 } }),
    ],
    inventoryFields: [],
    bookingFields: [
      field("reservationDateTime", "Reservation date/time", "datetime-local", { required: true, appliesTo: "booking", sortOrder: 1 }),
      field("partySize", "Party size", "number", { required: true, appliesTo: "booking", sortOrder: 2, validation: { min: 1 } }),
    ],
  },
  {
    slug: "bar",
    name: "Bar",
    domain: "dining",
    subtype: "bar",
    group: "Dining",
    sortOrder: 130,
    supportsOptions: false,
    inventoryKind: null,
    description: "Bar table reservations.",
    defaults: {
      suggestedCancelWindowHours: 2,
      payment: { depositPercentage: 50, remainingPaymentMethod: "PAY_AT_ARRIVAL" },
      cancellation: { type: "flexible", freeCancellationUntilHours: 2, depositRefundable: false },
    },
    availabilityPolicy: {
      listingRequiresAvailability: true,
      optionRequiresAvailability: false,
      modes: { dateWindow: true, daysOfWeek: true, timeOfDay: true },
      trackCapacity: true,
    },
    consumptionPolicy: {
      requireConsumptionStartDate: true,
      requireConsumptionEndDate: false,
      requireConsumptionStartTime: true,
      requireConsumptionEndTime: false,
    },
    listingFields: [
      field("atmosphere", "Atmosphere", "text", { sortOrder: 1 }),
      field("seatingCapacity", "Seating capacity", "number", { required: true, sortOrder: 2, validation: { min: 1 } }),
    ],
    inventoryFields: [],
    bookingFields: [
      field("reservationDateTime", "Reservation date/time", "datetime-local", { required: true, appliesTo: "booking", sortOrder: 1 }),
      field("partySize", "Party size", "number", { required: true, appliesTo: "booking", sortOrder: 2, validation: { min: 1 } }),
    ],
  },
  {
    slug: "conference",
    name: "Conference Room",
    domain: "venues",
    subtype: "conference",
    group: "Venues",
    sortOrder: 90,
    supportsOptions: true,
    inventoryKind: "package",
    inventoryLabel: "Package",
    inventoryLabelPlural: "Packages",
    description: "Meeting and conference rooms.",
    defaults: {
      suggestedCancelWindowHours: 48,
      payment: { depositPercentage: 50, remainingPaymentMethod: "PAY_AT_CHECKOUT" },
      cancellation: { type: "moderate", freeCancellationUntilHours: 48, depositRefundable: false },
    },
    availabilityPolicy: {
      listingRequiresAvailability: false,
      optionRequiresAvailability: true,
      modes: { dateWindow: true, daysOfWeek: true, timeOfDay: true },
      trackCapacity: true,
    },
    consumptionPolicy: {
      requireConsumptionStartDate: true,
      requireConsumptionEndDate: false,
      requireConsumptionStartTime: true,
      requireConsumptionEndTime: true,
    },
    listingFields: [
      field("maxCapacity", "Max capacity", "number", { required: true, sortOrder: 1, validation: { min: 1 } }),
      field("amenities", "Amenities", "textarea", { sortOrder: 2 }),
      field("cateringAvailable", "Catering available?", "boolean", { sortOrder: 3 }),
    ],
    inventoryFields: [
      field("packageName", "Package name", "text", { appliesTo: "option", sortOrder: 1 }),
    ],
    bookingFields: [
      field("eventDate", "Event date", "date", { required: true, appliesTo: "booking", sortOrder: 1 }),
      field("startTime", "Start time", "time", { required: true, appliesTo: "booking", sortOrder: 2 }),
      field("endTime", "End time", "time", { required: true, appliesTo: "booking", sortOrder: 3 }),
      field("attendees", "Attendees", "number", { required: true, appliesTo: "booking", sortOrder: 4, validation: { min: 1 } }),
      field("setupStyle", "Setup style", "text", { appliesTo: "booking", sortOrder: 5 }),
      field("avNeeds", "AV needs", "textarea", { appliesTo: "booking", sortOrder: 6 }),
    ],
  },
  {
    slug: "event-hall",
    name: "Event Hall",
    domain: "venues",
    subtype: "event-hall",
    group: "Venues",
    sortOrder: 100,
    supportsOptions: true,
    inventoryKind: "package",
    inventoryLabel: "Package",
    inventoryLabelPlural: "Packages",
    description: "Event halls and celebration venues.",
    defaults: {
      suggestedCancelWindowHours: 72,
      payment: { depositPercentage: 50, remainingPaymentMethod: "PAY_AT_CHECKOUT" },
      cancellation: { type: "strict", freeCancellationUntilHours: 72, depositRefundable: false },
    },
    availabilityPolicy: {
      listingRequiresAvailability: false,
      optionRequiresAvailability: true,
      modes: { dateWindow: true, daysOfWeek: true, timeOfDay: true },
      trackCapacity: true,
    },
    consumptionPolicy: {
      requireConsumptionStartDate: true,
      requireConsumptionEndDate: false,
      requireConsumptionStartTime: true,
      requireConsumptionEndTime: true,
    },
    listingFields: [
      field("maxCapacity", "Max capacity", "number", { required: true, sortOrder: 1, validation: { min: 1 } }),
      field("amenities", "Amenities", "textarea", { sortOrder: 2 }),
      field("cateringAvailable", "Catering available?", "boolean", { sortOrder: 3 }),
    ],
    inventoryFields: [
      field("packageName", "Package name", "text", { appliesTo: "option", sortOrder: 1 }),
    ],
    bookingFields: [
      field("eventDate", "Event date", "date", { required: true, appliesTo: "booking", sortOrder: 1 }),
      field("startTime", "Start time", "time", { required: true, appliesTo: "booking", sortOrder: 2 }),
      field("endTime", "End time", "time", { required: true, appliesTo: "booking", sortOrder: 3 }),
      field("attendees", "Attendees", "number", { required: true, appliesTo: "booking", sortOrder: 4, validation: { min: 1 } }),
      field("setupStyle", "Setup style", "text", { appliesTo: "booking", sortOrder: 5 }),
      field("catering", "Catering notes", "textarea", { appliesTo: "booking", sortOrder: 6 }),
    ],
  },
];

const bySlug = new Map(PLATFORM_CATEGORIES.map((item) => [item.slug, item]));

const SLUG_ALIASES = {
  "car-rentals": "car-rental",
  cars: "car-rental",
  "motorbike-and-scooter-rentals": "motorbike",
  "taxi-and-ride-services": "taxi",
  "bus-and-minivan-charters": "taxi",
};

const getCategoryDefinition = (slug) => {
  const key = String(slug || "").trim().toLowerCase();
  return bySlug.get(key) || bySlug.get(SLUG_ALIASES[key] || "") || null;
};

const listCategoryDefinitions = () => PLATFORM_CATEGORIES.slice();

const toSeedDocument = (definition) => ({
  slug: definition.slug,
  name: definition.name,
  domain: definition.domain,
  subtype: definition.subtype,
  group: definition.group,
  description: definition.description || "",
  sortOrder: definition.sortOrder,
  supportsOptions: Boolean(definition.supportsOptions),
  isActive: true,
  availabilityPolicy: definition.availabilityPolicy,
  consumptionPolicy: definition.consumptionPolicy,
  listingFieldSchema: definition.listingFields || [],
  optionFieldSchema: definition.inventoryFields || [],
  bookingFieldSchema: definition.bookingFields || [],
  defaults: {
    suggestedCancelWindowHours: definition.defaults?.suggestedCancelWindowHours ?? 6,
  },
});

module.exports = {
  DOMAIN_LABELS,
  PLATFORM_CATEGORIES,
  getCategoryDefinition,
  listCategoryDefinitions,
  toSeedDocument,
  field,
};
