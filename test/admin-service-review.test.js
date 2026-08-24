const test = require("node:test");
const assert = require("node:assert/strict");
const Hotel = require("../src/models/Hotel");
const ServiceOption = require("../src/models/ServiceOption");
const Room = require("../src/models/Room");
const HotelService = require("../src/models/HotelService");
const ServiceAvailability = require("../src/models/ServiceAvailability");
const { updateBusinessVerification, getServiceDetail } = require("../src/controllers/adminController");
const {
  serializeAdminServiceDetail,
  serializeAdminServiceListItem,
  resolveApprovalStatus,
} = require("../src/utils/adminServiceView");

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const chainLean = (value) => ({
  sort() {
    return this;
  },
  lean: async () => value,
});

const listing = {
  _id: "6a801e8b33074243a4c093f2",
  name: "Theoneste Hotel service",
  type: "hotel-rooms",
  categorySlug: "hotel",
  domain: "accommodation",
  subtype: "hotel",
  description: "Rooms in Kigali",
  approvalStatus: "pending",
  status: "available",
  images: ["https://cdn.example.com/one.jpg", "https://cdn.example.com/two.jpg"],
  location: "Gasabo, Kigali",
  locationDetails: { province: "Kigali City", district: "Gasabo", sector: "Kacyiru" },
  listingAttributes: {
    propertyKind: "hotel",
    starRating: "3-star",
    amenities: ["wifi", "parking"],
    checkInFrom: "14:00",
    checkOutUntil: "11:00",
    hostIdentity: {
      legalName: "Theoneste Ltd",
      idType: "company_registration",
      idNumber: "123456789",
    },
  },
  paymentPolicy: { depositPercentage: 50, remainingPaymentMethod: "PAY_AT_ARRIVAL" },
  cancellationPolicy: { type: "moderate", freeCancellationUntilHours: 48 },
  serviceLocation: {
    name: "Kigali Heights",
    formattedAddress: "KG 7 Ave, Kigali, Rwanda",
    latitude: -1.9497,
    longitude: 30.0919,
    placeId: "osm:N:123",
    locationSource: "search",
    isExactLocationVerified: true,
    province: "Kigali City",
    district: "Gasabo",
    sector: "Kacyiru",
  },
  ownerUserId: {
    _id: "provider-1",
    name: "Theoneste Provider",
    email: "provider@example.com",
    phone: "0780000000",
    sellerId: "SP123",
  },
  sellerContactEmail: "provider@example.com",
};

const deluxeOption = {
  _id: "opt-deluxe",
  serviceId: listing._id,
  name: "Deluxe Double Room",
  price: 85000,
  currency: "RWF",
  capacity: 3,
  attributes: {
    unitType: "double",
    maxGuests: 2,
    bedrooms: 1,
    quantity: 3,
    occupancyPrices: [{ guests: 2, price: 85000 }],
    roomAmenities: ["air_conditioning"],
  },
};

const deluxeAvailability = {
  _id: "av-deluxe",
  serviceId: listing._id,
  optionId: "opt-deluxe",
  scope: "option",
  isAnytime: false,
  windowStartDate: "2026-08-24",
  windowEndDate: "2027-08-24",
  daysOfWeek: [],
  capacityTotal: 3,
  capacityRemaining: 3,
  timezone: "Africa/Kigali",
};

test("admin list item exposes provider name for the services table", () => {
  const row = serializeAdminServiceListItem(listing, listing.ownerUserId);
  assert.equal(row.providerName, "Theoneste Provider");
  assert.equal(row.provider.sellerId, "SP123");
  assert.equal(row.providerEmail, "provider@example.com");
});

test("admin service detail includes images, map pin, and provider", () => {
  const detail = serializeAdminServiceDetail(listing, { provider: listing.ownerUserId });
  assert.equal(detail.images.length, 2);
  assert.equal(detail.images[0].url, "https://cdn.example.com/one.jpg");
  assert.equal(detail.map.hasPin, true);
  assert.equal(detail.map.latitude, -1.9497);
  assert.match(detail.map.googleMapsUrl, /google\.com\/maps/);
  assert.equal(detail.provider.name, "Theoneste Provider");
  assert.equal(detail.review.hasExactCoordinates, true);
  assert.equal(detail.listingAttributes.hostIdentity.idNumber, "123456789");
  assert.equal(detail.paymentPolicy.depositPercentage, 50);
});

test("admin service detail includes rooms, units, options, and availability", () => {
  const detail = serializeAdminServiceDetail(listing, {
    provider: listing.ownerUserId,
    options: [deluxeOption],
    availabilities: [deluxeAvailability],
    rooms: [
      {
        _id: "room-12",
        roomNumber: "12",
        type: "deluxe",
        price: 85000,
        capacity: { adults: 2, children: 0 },
      },
    ],
  });

  assert.equal(detail.inventoryLabel, "rooms");
  assert.equal(detail.options.length, 1);
  assert.equal(detail.units.length, 1);
  assert.equal(detail.options[0].name, "Deluxe Double Room");
  assert.equal(detail.options[0].attributes.unitType, "double");
  assert.equal(detail.options[0].availability.windowStartDate, "2026-08-24");
  assert.equal(detail.options[0].availability.capacityTotal, 3);
  assert.equal(detail.rooms[0].roomNumber, "12");
  assert.equal(detail.review.hasOptions, true);
  assert.equal(detail.review.optionCount, 1);
});

test("approval status is read from body, action, or /approve path", () => {
  assert.equal(resolveApprovalStatus({ body: { status: "approved" } }), "approved");
  assert.equal(resolveApprovalStatus({ body: { action: "reject" } }), "rejected");
  assert.equal(
    resolveApprovalStatus({ body: {}, path: "/api/admin/services/abc/approve" }),
    "approved"
  );
});

test("PUT /api/admin/services/:serviceId/approval updates the listing", async (context) => {
  const originalFindById = Hotel.findById;
  const originalOptionCount = ServiceOption.countDocuments;
  const originalOptionFind = ServiceOption.find;
  const originalRoomFind = Room.find;
  const originalHotelServiceFind = HotelService.find;
  const originalAvailabilityFind = ServiceAvailability.find;

  const business = {
    ...listing,
    supportsOptions: true,
    commissionPercentage: 5,
    cancelPenaltyPercent: 20,
    cancelWindowHours: 6,
    bookingRules: {},
    async populate() {
      this.ownerUserId = listing.ownerUserId;
      return this;
    },
    async save() {
      return this;
    },
  };

  Hotel.findById = async () => business;
  ServiceOption.countDocuments = async () => 1;
  ServiceOption.find = () => chainLean([]);
  Room.find = () => chainLean([]);
  HotelService.find = () => chainLean([]);
  ServiceAvailability.find = () => chainLean([]);

  context.after(() => {
    Hotel.findById = originalFindById;
    ServiceOption.countDocuments = originalOptionCount;
    ServiceOption.find = originalOptionFind;
    Room.find = originalRoomFind;
    HotelService.find = originalHotelServiceFind;
    ServiceAvailability.find = originalAvailabilityFind;
  });

  const result = response();
  await updateBusinessVerification(
    {
      params: { serviceId: listing._id },
      body: {
        status: "approved",
        cancelPenaltyPercent: 20,
        platformCommissionPercent: 5,
      },
      path: `/api/admin/services/${listing._id}/approval`,
      user: { _id: "admin-1", role: "admin" },
    },
    result
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.service.approvalStatus, "approved");
  assert.equal(result.body.business.provider.name, "Theoneste Provider");
  assert.deepEqual(result.body.service.options, []);
});

test("GET service detail returns rooms, options, and availability", async (context) => {
  const originalFindById = Hotel.findById;
  const originalOptionFind = ServiceOption.find;
  const originalRoomFind = Room.find;
  const originalHotelServiceFind = HotelService.find;
  const originalAvailabilityFind = ServiceAvailability.find;

  Hotel.findById = () => ({
    lean: async () => listing,
  });
  ServiceOption.find = () => chainLean([deluxeOption]);
  Room.find = () => chainLean([{ _id: "room-12", roomNumber: "12", type: "deluxe", price: 85000 }]);
  HotelService.find = () => chainLean([]);
  ServiceAvailability.find = () => chainLean([deluxeAvailability]);

  context.after(() => {
    Hotel.findById = originalFindById;
    ServiceOption.find = originalOptionFind;
    Room.find = originalRoomFind;
    HotelService.find = originalHotelServiceFind;
    ServiceAvailability.find = originalAvailabilityFind;
  });

  const result = response();
  await getServiceDetail({ params: { serviceId: listing._id } }, result);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.service.options[0].name, "Deluxe Double Room");
  assert.equal(result.body.service.options[0].availability.windowStartDate, "2026-08-24");
  assert.equal(result.body.service.rooms[0].roomNumber, "12");
  assert.equal(result.body.service.listingAttributes.hostIdentity.idNumber, "123456789");
});

test("GET service detail returns 404 when the listing is missing", async (context) => {
  const originalFindById = Hotel.findById;
  Hotel.findById = () => ({
    lean: async () => null,
  });
  context.after(() => {
    Hotel.findById = originalFindById;
  });

  const result = response();
  await getServiceDetail({ params: { serviceId: listing._id } }, result);
  assert.equal(result.statusCode, 404);
});
