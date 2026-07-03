const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizePriceOption,
  hasCompleteAutomaticRules,
  resolveBookingMode,
  calculateDuration,
  calculateQuote,
} = require("../src/services/automaticBookingService");
const Hotel = require("../src/models/Hotel");
const Booking = require("../src/models/Booking");
const SiteSetting = require("../src/models/SiteSetting");
const AuditLog = require("../src/models/AuditLog");
const { createBookingRequest } = require("../src/controllers/bookingController");
const { updateServiceBookingMode } = require("../src/controllers/adminController");

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("automatic per-night quote calculates total, 30% deposit, and snapshot values", () => {
  const option = normalizePriceOption({
    id: "room_all_needs",
    cells: {
      service: "Room with all needs",
      price: "99997",
      priceType: "per-night",
      calculationField: "duration",
      durationUnit: "nights",
      maximumDuration: 14,
      availability: 4,
      details: "Wi-Fi, breakfast and private bathroom",
    },
  });
  const duration = calculateDuration({ startDate: "2026-07-02", endDate: "2026-07-04", unit: "nights" });
  const quote = calculateQuote({ option, people: 2, quantity: 1, duration });

  assert.equal(duration, 2);
  assert.equal(quote.total, 199994);
  assert.equal(quote.deposit, 59998);
  assert.equal(quote.remaining, 139996);
  assert.match(quote.reason, /RWF 59,998/);
});

test("automatic per-person quote uses people rather than units", () => {
  const option = normalizePriceOption({
    id: "tour",
    cells: { service: "City tour", price: 10000, priceType: "per-person", calculationField: "people", durationUnit: "same-day", availability: 10 },
  });
  const quote = calculateQuote({ option, people: 3, quantity: 1, duration: 1 });
  assert.equal(quote.total, 30000);
  assert.equal(quote.deposit, 9000);
});

test("service-level mode resolves to the admin-selected service mode", () => {
  assert.equal(resolveBookingMode("service-level", "automatic"), "automatic");
  assert.equal(resolveBookingMode("service-level", "manual"), "manual");
  assert.equal(resolveBookingMode("automatic", "manual"), "automatic");
});

test("automatic rules can be configured before admin approval", () => {
  const option = normalizePriceOption({
    id: "pending_service",
    cells: { service: "Pending service", price: 25000, priceType: "fixed", calculationField: "fixed", durationUnit: "none", availability: 3 },
  });
  assert.equal(hasCompleteAutomaticRules(option), true);
});

test("customer can create an automatic booking and receives a backend quote", async (context) => {
  const originals = {
    readyState: SiteSetting.db._readyState,
    settingFindOne: SiteSetting.findOne,
    hotelFindOne: Hotel.findOne,
    hotelCountDocuments: Hotel.countDocuments,
    hotelFindOneAndUpdate: Hotel.findOneAndUpdate,
    bookingCreate: Booking.create,
    auditInsertMany: AuditLog.insertMany,
  };
  const business = {
    _id: "507f1f77bcf86cd799439022",
    type: "hotel-rooms",
    approvalStatus: "approved",
    status: "available",
    bookingMode: "automatic",
    availabilityTable: {
      rows: [{
        id: "room_option",
        cells: { service: "Room with all needs", price: 99997, priceType: "per-night", calculationField: "duration", durationUnit: "nights", maximumDuration: 10, availability: 4, details: "Wi-Fi" },
      }],
    },
  };

  SiteSetting.db._readyState = 1;
  SiteSetting.findOne = () => ({ lean: async () => ({ value: { bookingMode: "service-level" } }) });
  Hotel.findOne = async () => business;
  Hotel.countDocuments = async () => 1;
  Hotel.findOneAndUpdate = async () => business;
  Booking.create = async (data) => ({ ...data, _id: "507f1f77bcf86cd799439033" });
  AuditLog.insertMany = async () => [];
  context.after(() => {
    SiteSetting.db._readyState = originals.readyState;
    SiteSetting.findOne = originals.settingFindOne;
    Hotel.findOne = originals.hotelFindOne;
    Hotel.countDocuments = originals.hotelCountDocuments;
    Hotel.findOneAndUpdate = originals.hotelFindOneAndUpdate;
    Booking.create = originals.bookingCreate;
    AuditLog.insertMany = originals.auditInsertMany;
  });

  const result = response();
  await createBookingRequest({
    user: { _id: "507f1f77bcf86cd799439011", role: "customer" },
    body: {
      hotelId: business._id,
      destinationPlace: "Hotel room",
      destinationLocation: "Kigali",
      guests: 2,
      quantity: 1,
      bookingDetails: {
        selectedOptionId: "room_option",
        requestedService: "Room with all needs",
        fullName: "Test Customer",
        phone: "+250788000000",
        email: "customer@example.com",
        bookingDate: "2026-07-10",
        endDate: "2026-07-12",
        numberOfPeople: 2,
        quantity: 1,
      },
    },
  }, result);

  assert.equal(result.statusCode, 201);
  assert.equal(result.body.booking.bookingMode, "automatic");
  assert.equal(result.body.booking.status, "waiting-for-payment");
  assert.equal(result.body.quote.total, 199994);
  assert.equal(result.body.quote.deposit, 59998);
});

test("admin can enable automatic mode on a configured pending service", async (context) => {
  const originalFindById = Hotel.findById;
  const originalFindByIdAndUpdate = Hotel.findByIdAndUpdate;
  const originalSettingUpdate = SiteSetting.findOneAndUpdate;
  let savedGlobalMode = null;
  let savedBusinessUpdate = null;
  const configuredService = {
    _id: "507f1f77bcf86cd799439044",
    name: "Configured service",
    type: "hotels-and-resorts",
    approvalStatus: "pending",
    status: "unavailable",
    availabilityTable: {
      rows: [{ id: "option_1", cells: { service: "Hotel room", price: 50000 } }],
    },
  };
  Hotel.findById = async () => configuredService;
  Hotel.findByIdAndUpdate = async (_id, update) => {
    savedBusinessUpdate = update.$set;
    return { ...configuredService, ...update.$set };
  };
  SiteSetting.findOneAndUpdate = async (_filter, update) => {
    savedGlobalMode = update.$set["value.bookingMode"];
    return { value: { bookingMode: savedGlobalMode } };
  };
  context.after(() => {
    Hotel.findById = originalFindById;
    Hotel.findByIdAndUpdate = originalFindByIdAndUpdate;
    SiteSetting.findOneAndUpdate = originalSettingUpdate;
  });

  const result = response();
  await updateServiceBookingMode({
    params: { businessId: configuredService._id },
    body: { bookingMode: "automatic" },
    user: { _id: "507f1f77bcf86cd799439099", role: "admin" },
  }, result);

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.service.bookingMode, "automatic");
  assert.equal(savedGlobalMode, "service-level");
  assert.equal(savedBusinessUpdate.availabilityTable.rows[0].cells.priceType, "per-night");
  assert.equal(savedBusinessUpdate.availabilityTable.rows[0].cells.durationUnit, "nights");
  assert.equal(savedBusinessUpdate.availabilityTable.rows[0].cells.availability, 1);
});
