const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateListingDetails,
  validateInventoryDetails,
  validateBookingDetails,
  splitBookingAmounts,
  enrichCategory,
} = require("../src/domains");

test("accommodation listing requires check-in and check-out times", () => {
  const failed = validateListingDetails("hotel", { amenities: "wifi" });
  assert.equal(failed.ok, false);

  const passed = validateListingDetails("hotel", {
    checkInTime: "14:00",
    checkOutTime: "11:00",
    starRating: "4-star",
    amenities: "wifi, pool",
  });
  assert.equal(passed.ok, true);
  assert.deepEqual(passed.value.amenities, ["wifi", "pool"]);
});

test("accommodation booking rejects inverted dates and over-capacity guests", () => {
  const inverted = validateBookingDetails({
    categoryOrSlug: "hotel",
    payload: { checkIn: "2026-09-10", checkOut: "2026-09-08", guests: 2 },
    listing: { listingAttributes: { checkInTime: "14:00" } },
    inventory: { attributes: { maxGuests: 3 } },
  });
  assert.equal(inverted.ok, false);

  const overflow = validateBookingDetails({
    categoryOrSlug: "hotel",
    payload: { checkIn: "2026-09-10", checkOut: "2026-09-12", guests: 5 },
    listing: { listingAttributes: {} },
    inventory: { attributes: { maxGuests: 2 } },
  });
  assert.equal(overflow.ok, false);

  const passed = validateBookingDetails({
    categoryOrSlug: "hotel",
    payload: { checkIn: "2026-09-10", checkOut: "2026-09-12", guests: 2, specialRequests: "Late arrival" },
    listing: { listingAttributes: { checkInTime: "14:00", checkOutTime: "11:00" } },
    inventory: { attributes: { maxGuests: 3 } },
  });
  assert.equal(passed.ok, true);
  assert.equal(passed.domain, "accommodation");
  assert.equal(passed.payload.nights, 2);
  assert.equal(passed.schedule.startDate, "2026-09-10");
});

test("car rental booking enforces license, age, and return after pickup", () => {
  const failed = validateBookingDetails({
    categoryOrSlug: "car-rental",
    payload: {
      pickupLocation: "Kigali airport",
      returnLocation: "Kigali airport",
      pickupDateTime: "2026-09-10T10:00:00.000Z",
      returnDateTime: "2026-09-10T08:00:00.000Z",
      driverAge: 20,
      driverLicenseNumber: "RW123",
      numberOfDrivers: 1,
    },
    listing: { listingAttributes: { minimumDriverAge: 21, withDriver: false } },
  });
  assert.equal(failed.ok, false);

  const passed = validateBookingDetails({
    categoryOrSlug: "car-rental",
    payload: {
      pickupLocation: "Kigali airport",
      returnLocation: "Musanze",
      pickupDateTime: "2026-09-10T10:00:00.000Z",
      returnDateTime: "2026-09-12T10:00:00.000Z",
      driverAge: 25,
      driverLicenseNumber: "RW123",
      numberOfDrivers: 1,
    },
    listing: { listingAttributes: { minimumDriverAge: 21, withDriver: false } },
  });
  assert.equal(passed.ok, true);
  assert.equal(passed.domain, "transport");
});

test("tour booking requires adults + children to match participants", () => {
  const failed = validateBookingDetails({
    categoryOrSlug: "tour",
    payload: { preferredDate: "2026-09-10", participants: 4, adults: 2, children: 1 },
    inventory: { capacity: 10 },
  });
  assert.equal(failed.ok, false);

  const passed = validateBookingDetails({
    categoryOrSlug: "tour",
    payload: { preferredDate: "2026-09-10", participants: 3, adults: 2, children: 1, language: "English" },
    inventory: { capacity: 10, attributes: { packageType: "Family" } },
  });
  assert.equal(passed.ok, true);
  assert.equal(passed.payload.participants, 3);
});

test("restaurant booking rejects party larger than seating capacity", () => {
  const failed = validateBookingDetails({
    categoryOrSlug: "restaurant",
    payload: { reservationDateTime: "2026-09-10T19:00:00.000Z", partySize: 12 },
    listing: { listingAttributes: { seatingCapacity: 8 } },
  });
  assert.equal(failed.ok, false);
});

test("venue booking requires end time after start time", () => {
  const failed = validateBookingDetails({
    categoryOrSlug: "conference",
    payload: { eventDate: "2026-09-10", startTime: "16:00", endTime: "15:00", attendees: 20 },
    listing: { listingAttributes: { maxCapacity: 40 } },
  });
  assert.equal(failed.ok, false);
});

test("payment split uses 50% deposit and 10% platform fee", () => {
  const split = splitBookingAmounts({
    totalPrice: 100000,
    depositPercentage: 50,
    commissionPercentage: 10,
  });
  assert.equal(split.depositAmount, 50000);
  assert.equal(split.remainingAmount, 50000);
  assert.equal(split.platformFee, 10000);
  assert.equal(split.providerDepositShare, 40000);
});

test("platform categories expose domain metadata", () => {
  const hotel = enrichCategory({ slug: "hotel" });
  assert.equal(hotel.domain, "accommodation");
  assert.equal(hotel.inventoryLabel, "Room");
  assert.equal(hotel.formMode, "domain");
});

test("car-rentals slug alias maps to transport", () => {
  const category = enrichCategory({ slug: "car-rentals" });
  assert.equal(category.domain, "transport");
  assert.equal(category.subtype, "car-rental");
});

test("car rental booking enforces max rental days", () => {
  const failed = validateBookingDetails({
    categoryOrSlug: "car-rental",
    payload: {
      pickupLocation: "Kigali airport",
      returnLocation: "Kigali airport",
      pickupDateTime: "2026-09-10T10:00:00.000Z",
      returnDateTime: "2026-09-20T10:00:00.000Z",
      driverAge: 25,
      driverLicenseNumber: "RW123",
      numberOfDrivers: 1,
    },
    listing: { listingAttributes: { minimumDriverAge: 21, withDriver: false, minRentalDays: 1, maxRentalDays: 7 } },
  });
  assert.equal(failed.ok, false);
});
test("car rental inventory accepts vehicle specs", () => {
  const result = validateInventoryDetails("car-rental", {
    make: "Toyota",
    model: "RAV4",
    seats: 5,
    ac: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.seats, 5);
});

test("accommodation inventory stores beds, bathroom, and occupancy prices", () => {
  const result = validateInventoryDetails("apartment", {
    maxGuests: 4,
    quantity: 2,
    bedrooms: 2,
    unitType: "studio",
    beds: [
      { type: "double", count: 1 },
      { type: "single", count: 2 },
    ],
    bathroomPrivate: true,
    bathroomAmenities: ["shower", "toilet"],
    occupancyPrices: [
      { guests: 2, price: 45000 },
      { guests: 4, price: 60000 },
    ],
    pricingMode: "unit",
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.numberOfBeds, 3);
  assert.equal(result.value.occupancyPrices[1].price, 60000);
  assert.equal(result.value.pricingMode, "unit");
});

test("accommodation booking enforces max stay nights", () => {
  const result = validateBookingDetails({
    categoryOrSlug: "apartment",
    payload: { checkIn: "2026-09-10", checkOut: "2026-10-20", guests: 2 },
    listing: { listingAttributes: { checkInTime: "14:00", checkOutTime: "11:00", allowLongStays: false, maxStayNights: 30 } },
    inventory: { attributes: { maxGuests: 4 } },
  });
  assert.equal(result.ok, false);
});

test("stay quote uses the option price times nights for the whole unit", () => {
  const { calculateStayQuote } = require("../src/domains");
  const quote = calculateStayQuote({
    option: { price: 60000, attributes: { occupancyPrices: [{ guests: 1, price: 40000 }, { guests: 2, price: 60000 }] } },
    listing: { listingAttributes: { ratePlans: { weekly: { enabled: true, discountPercent: 15, minNights: 7 } } } },
    guests: 2,
    nights: 7,
    ratePlan: "weekly",
  });
  assert.equal(quote.pricingMode, "unit");
  assert.equal(quote.nightly, 60000);
  assert.equal(quote.subtotal, 420000);
  assert.equal(quote.total, 357000);
});

test("stay quote multiplies the option price by guests when priced per guest", () => {
  const { calculateStayQuote } = require("../src/domains");
  const quote = calculateStayQuote({
    option: { price: 40000, attributes: { pricingMode: "per_guest" } },
    listing: {},
    guests: 2,
    nights: 3,
    ratePlan: "standard",
  });
  assert.equal(quote.pricingMode, "per_guest");
  assert.equal(quote.nightly, 80000);
  assert.equal(quote.subtotal, 240000);
  assert.equal(quote.total, 240000);
});

test("public listing attributes hide identity document numbers", () => {
  const { sanitizeListingAttributesForPublic } = require("../src/domains");
  const publicAttrs = sanitizeListingAttributesForPublic({
    amenities: ["wifi"],
    hostIdentity: { legalName: "Ada", idType: "national_id", idNumber: "1199SECRET" },
  });
  assert.equal(publicAttrs.hostIdentity.idNumber, undefined);
  assert.equal(publicAttrs.hostIdentity.hasIdentityDocument, true);
});

test("guest-house is an accommodation category", () => {
  const category = enrichCategory({ slug: "guest-house" });
  assert.equal(category.domain, "accommodation");
  assert.equal(category.subtype, "guest-house");
});
