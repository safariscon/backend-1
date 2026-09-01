const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizePriceOption,
  hasCompleteAutomaticRules,
  resolveBookingMode,
  calculateDuration,
  calculateQuote,
  applyPromotionToQuote,
  normalizeAvailabilityTable,
  validateBookingSchedule,
  optionRequiresTime,
  optionRequiresEndDate,
} = require("../src/services/automaticBookingService");
const Hotel = require("../src/models/Hotel");
const Booking = require("../src/models/Booking");
const SiteSetting = require("../src/models/SiteSetting");
const AuditLog = require("../src/models/AuditLog");
const { createBookingRequest } = require("../src/controllers/bookingController");
const { updateServiceBookingMode } = require("../src/controllers/adminController");
const { upsertMyService } = require("../src/controllers/hotelController");

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const customerLocationDetails = {
  province: "Kigali City",
  district: "Gasabo",
  sector: "Kimironko",
  cell: "Bibare",
  village: "Umucyo",
};

const bookingSchedule = {
  bookingDate: "2026-07-10",
  endBookingDate: "2026-07-12",
  startTime: "09:00",
  endTime: "17:00",
};

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
  const quote = calculateQuote({ option, people: 2, quantity: 2, duration });

  assert.equal(duration, 2);
  assert.equal(quote.totalConsumptionUnits, 4);
  assert.equal(quote.total, 399988);
  assert.equal(quote.deposit, 119996);
  assert.equal(quote.remaining, 279992);
  assert.match(quote.reason, /total consumption units are 4/i);
});

test("automatic quote multiplies people by quantity for consumption units", () => {
  const option = normalizePriceOption({
    id: "tour",
    cells: { service: "City tour", price: 10000, priceType: "per-person", calculationField: "people", durationUnit: "same-day", availability: 10 },
  });
  const quote = calculateQuote({ option, people: 3, quantity: 2, duration: 1 });
  assert.equal(quote.totalConsumptionUnits, 6);
  assert.equal(quote.total, 60000);
  assert.equal(quote.deposit, 18000);
});

test("active promotion applies discount and calculates deposit from final price", () => {
  const quote = applyPromotionToQuote({
    quote: { total: 100000, deposit: 30000, remaining: 70000, reason: "Base quote" },
    promotion: {
      enabled: true,
      title: "Summer Deal",
      percent: 25,
      startAt: "2026-07-01T00:00:00.000Z",
      endAt: "2026-07-31T23:59:59.999Z",
    },
    now: new Date("2026-07-07T00:00:00.000Z"),
  });

  assert.equal(quote.originalPrice, 100000);
  assert.equal(quote.promotionApplied, true);
  assert.equal(quote.discountAmount, 25000);
  assert.equal(quote.finalPrice, 75000);
  assert.equal(quote.depositAmount, 22500);
  assert.equal(quote.deposit, 22500);
});

test("expired and disabled promotions do not reduce price", () => {
  const expired = applyPromotionToQuote({
    quote: { total: 100000, deposit: 30000, remaining: 70000, reason: "Base quote" },
    promotion: { enabled: true, title: "Old Deal", percent: 25, startAt: "2026-06-01", endAt: "2026-06-30" },
    now: new Date("2026-07-07T00:00:00.000Z"),
  });
  const disabled = applyPromotionToQuote({
    quote: { total: 100000, deposit: 30000, remaining: 70000, reason: "Base quote" },
    promotion: { enabled: false, title: "Off Deal", percent: 25, startAt: "2026-07-01", endAt: "2026-07-31" },
    now: new Date("2026-07-07T00:00:00.000Z"),
  });

  assert.equal(expired.promotionApplied, false);
  assert.equal(expired.finalPrice, 100000);
  assert.equal(expired.depositAmount, 30000);
  assert.equal(disabled.promotionApplied, false);
  assert.equal(disabled.finalPrice, 100000);
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
      numberOfPeople: 2,
      quantity: 2,
      customerLocationDetails,
      ...bookingSchedule,
      bookingDetails: {
        customerLocationDetails,
        ...bookingSchedule,
        selectedOptionId: "room_option",
        requestedService: "Room with all needs",
        fullName: "Test Customer",
        phone: "+250788000000",
        email: "customer@example.com",
        numberOfPeople: 2,
        quantity: 2,
      },
    },
  }, result);

  assert.equal(result.statusCode, 201);
  assert.equal(result.body.booking.bookingMode, "automatic");
  assert.equal(result.body.booking.status, "waiting-for-payment");
  assert.equal(result.body.quote.totalConsumptionUnits, 4);
  assert.equal(result.body.booking.numberOfPeople, 2);
  assert.equal(result.body.booking.quantity, 2);
  assert.equal(result.body.booking.totalConsumptionUnits, 4);
  assert.equal(result.body.quote.total, 399988);
  assert.equal(result.body.quote.deposit, 119996);
});

test("booking creation rejects an end booking date before the booking date", async (context) => {
  const originals = {
    readyState: SiteSetting.db._readyState,
    settingFindOne: SiteSetting.findOne,
    hotelFindOne: Hotel.findOne,
    hotelCountDocuments: Hotel.countDocuments,
  };
  const business = {
    _id: "507f1f77bcf86cd799439022",
    type: "hotel-rooms",
    approvalStatus: "approved",
    status: "available",
    bookingMode: "manual",
  };

  SiteSetting.db._readyState = 1;
  SiteSetting.findOne = () => ({ lean: async () => ({ value: { bookingMode: "service-level" } }) });
  Hotel.findOne = async () => business;
  Hotel.countDocuments = async () => 1;
  context.after(() => {
    SiteSetting.db._readyState = originals.readyState;
    SiteSetting.findOne = originals.settingFindOne;
    Hotel.findOne = originals.hotelFindOne;
    Hotel.countDocuments = originals.hotelCountDocuments;
  });

  const result = response();
  await createBookingRequest({
    user: { _id: "507f1f77bcf86cd799439011", role: "customer" },
    body: {
      hotelId: business._id,
      destinationPlace: "Hotel room",
      destinationLocation: "Kigali",
      customerLocationDetails,
      bookingDate: "2026-07-12",
      endBookingDate: "2026-07-10",
      startTime: "09:00",
      endTime: "17:00",
      bookingDetails: {
        customerLocationDetails,
        bookingDate: "2026-07-12",
        endBookingDate: "2026-07-10",
        startTime: "09:00",
        endTime: "17:00",
      },
    },
  }, result);

  assert.equal(result.statusCode, 400);
  assert.match(result.body.message, /End booking date cannot be before booking date/i);
});

test("automatic booking saves active promotion price snapshot", async (context) => {
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
    type: "experiences",
    approvalStatus: "approved",
    status: "available",
    bookingMode: "automatic",
    promotion: {
      enabled: true,
      title: "Summer Deal",
      percent: 25,
      note: "Limited time",
      startAt: "2026-07-01T00:00:00.000Z",
      endAt: "2099-07-31T23:59:59.999Z",
    },
    availabilityTable: {
      rows: [{
        id: "tour_option",
        cells: { service: "City tour", price: 100000, priceType: "fixed", calculationField: "fixed", durationUnit: "none", availability: 10, details: "Tour" },
      }],
    },
  };
  let createdBooking = null;

  SiteSetting.db._readyState = 1;
  SiteSetting.findOne = () => ({ lean: async () => ({ value: { bookingMode: "service-level" } }) });
  Hotel.findOne = async () => business;
  Hotel.countDocuments = async () => 1;
  Hotel.findOneAndUpdate = async () => business;
  Booking.create = async (data) => {
    createdBooking = { ...data, _id: "507f1f77bcf86cd799439033" };
    return createdBooking;
  };
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
      destinationPlace: "City tour",
      destinationLocation: "Kigali",
      guests: 2,
      numberOfPeople: 2,
      quantity: 3,
      customerLocationDetails,
      ...bookingSchedule,
      bookingDetails: {
        customerLocationDetails,
        ...bookingSchedule,
        selectedOptionId: "tour_option",
        requestedService: "City tour",
        fullName: "Test Customer",
        phone: "+250788000000",
        email: "customer@example.com",
        numberOfPeople: 2,
        quantity: 3,
      },
    },
  }, result);

  assert.equal(result.statusCode, 201);
  assert.equal(result.body.quote.totalConsumptionUnits, 6);
  assert.equal(result.body.quote.originalPrice, 600000);
  assert.equal(result.body.quote.discountAmount, 150000);
  assert.equal(result.body.quote.total, 450000);
  assert.equal(result.body.quote.deposit, 135000);
  assert.equal(createdBooking.numberOfPeople, 2);
  assert.equal(createdBooking.quantity, 3);
  assert.equal(createdBooking.totalConsumptionUnits, 6);
  assert.equal(createdBooking.priceSnapshot.originalPrice, 600000);
  assert.equal(createdBooking.priceSnapshot.promotionApplied, true);
  assert.equal(createdBooking.priceSnapshot.promotionTitle, "Summer Deal");
  assert.equal(createdBooking.priceSnapshot.promotionPercent, 25);
  assert.equal(createdBooking.priceSnapshot.discountAmount, 150000);
  assert.equal(createdBooking.priceSnapshot.finalPrice, 450000);
  assert.equal(createdBooking.priceSnapshot.depositPercent, 30);
  assert.equal(createdBooking.priceSnapshot.depositAmount, 135000);
});

test("seller service save rejects invalid promotion percent", async () => {
  const result = response();
  await upsertMyService({
    user: { _id: "507f1f77bcf86cd799439011", role: "hotel", email: "seller@example.com" },
    params: {},
    body: {
      title: "Promo service",
      category: "tours",
      description: "Service",
      locationDetails: { district: "Gasabo", sector: "Kimironko", cell: "A", village: "B" },
      payoutDetails: { method: "mobile-money", accountName: "Seller", accountNumber: "0780000000" },
      promotion: { enabled: true, title: "Bad deal", percent: 101, startAt: "2026-07-01", endAt: "2026-07-31" },
      availabilityTable: { rows: [{ id: "row_1", cells: { service: "Tour", price: "100000" } }] },
      bookingForm: { isPublished: true, fields: [] },
    },
  }, result);

  assert.equal(result.statusCode, 400);
  assert.match(result.body.message, /Promotion percent/i);
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

test("seller availability table keeps published window, weekdays, hours, and extra cells keys", () => {
  const table = normalizeAvailabilityTable({
    rows: [{
      id: "room_option",
      cells: {
        service: "Lake room",
        price: "80000",
        priceType: "per-night",
        calculationField: "duration",
        durationUnit: "nights",
        maximumDuration: 14,
        availability: 8,
        availableFrom: "2026-08-20",
        availableTo: "2026-12-31",
        availableDays: "mon,tue,fri",
        availableStartTime: "09:00",
        availableEndTime: "17:00",
        requiresTime: "no",
        details: "Wi-Fi, breakfast",
        customNote: "Lake view",
      },
    }],
  });

  const cells = table.rows[0].cells;
  assert.equal(cells.availableFrom, "2026-08-20");
  assert.equal(cells.availableTo, "2026-12-31");
  assert.equal(cells.availableDays, "mon,tue,fri");
  assert.equal(cells.availableStartTime, "09:00");
  assert.equal(cells.availableEndTime, "17:00");
  assert.equal(cells.requiresTime, "no");
  assert.equal(cells.customNote, "Lake view");
});

test("older listings without hours keep dates required and times optional", () => {
  const option = normalizePriceOption({
    id: "legacy",
    cells: { service: "Legacy stay", price: 50000, priceType: "per-night", calculationField: "duration", durationUnit: "nights", availability: 3 },
  });
  assert.equal(optionRequiresEndDate(option), true);
  assert.equal(optionRequiresTime(option), false);

  const missingDate = validateBookingSchedule({ option, endDate: "2026-08-22" });
  assert.equal(missingDate.ok, false);
  assert.match(missingDate.message, /Booking date is required/i);

  const missingEnd = validateBookingSchedule({ option, startDate: "2026-08-20" });
  assert.equal(missingEnd.ok, false);
  assert.match(missingEnd.message, /End date is required/i);

  const allDay = validateBookingSchedule({ option, startDate: "2026-08-20", endDate: "2026-08-22" });
  assert.equal(allDay.ok, true);
  assert.equal(allDay.startTime, "");
  assert.equal(allDay.endTime, "");
});

test("transport rental schedule keeps return date even when option has no duration unit", () => {
  const option = normalizePriceOption({
    id: "moto-1",
    cells: {
      service: "Crypton 125",
      price: 15000,
      priceType: "fixed",
      calculationField: "quantity",
      durationUnit: "",
      availability: 2,
    },
  });
  const collapsed = validateBookingSchedule({
    option,
    startDate: "2026-09-02",
    endDate: "2026-09-03",
    startTime: "08:00",
    endTime: "18:00",
  });
  assert.equal(collapsed.endDate, collapsed.startDate);

  const rental = validateBookingSchedule({
    option,
    startDate: "2026-09-02",
    endDate: "2026-09-03",
    startTime: "08:00",
    endTime: "18:00",
    domain: "transport",
    subtype: "motorbike",
  });
  assert.equal(rental.ok, true);
  assert.equal(rental.startDate, "2026-09-02");
  assert.equal(rental.endDate, "2026-09-03");
});

test("booking schedule rejects dates outside the published window and unavailable weekdays", () => {
  const option = normalizePriceOption({
    id: "windowed",
    cells: {
      service: "Weekday stay",
      price: 40000,
      priceType: "per-night",
      calculationField: "duration",
      durationUnit: "nights",
      availability: 2,
      availableFrom: "2026-08-20",
      availableTo: "2026-08-30",
      availableDays: "mon,tue,wed,thu,fri",
    },
  });

  const outside = validateBookingSchedule({ option, startDate: "2026-08-10", endDate: "2026-08-12" });
  assert.equal(outside.ok, false);
  assert.match(outside.message, /outside the option's available window/i);

  const weekend = validateBookingSchedule({ option, startDate: "2026-08-22", endDate: "2026-08-23" });
  assert.equal(weekend.ok, false);
  assert.match(weekend.message, /not available on Saturday/i);

  const weekday = validateBookingSchedule({ option, startDate: "2026-08-24", endDate: "2026-08-25" });
  assert.equal(weekday.ok, true);
});

test("hourly options and published hours require times inside open-close window", () => {
  const hourly = normalizePriceOption({
    id: "session",
    cells: {
      service: "Studio hour",
      price: 15000,
      priceType: "per-hour",
      calculationField: "duration",
      durationUnit: "hours",
      availability: 4,
      availableStartTime: "09:00",
      availableEndTime: "17:00",
      requiresTime: "auto",
    },
  });
  assert.equal(optionRequiresTime(hourly), true);
  assert.equal(optionRequiresEndDate(hourly), false);

  const missingTimes = validateBookingSchedule({ option: hourly, startDate: "2026-08-20" });
  assert.equal(missingTimes.ok, false);
  assert.match(missingTimes.message, /Start and end times are required/i);

  const tooEarly = validateBookingSchedule({
    option: hourly,
    startDate: "2026-08-20",
    startTime: "08:00",
    endTime: "10:00",
  });
  assert.equal(tooEarly.ok, false);
  assert.match(tooEarly.message, /outside opening hours/i);

  const ok = validateBookingSchedule({
    option: hourly,
    startDate: "2026-08-20",
    startTime: "09:00",
    endTime: "11:00",
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.endDate, "2026-08-20");
});

test("same-day options default end date to the booking date", () => {
  const option = normalizePriceOption({
    id: "tour",
    cells: { service: "City tour", price: 20000, priceType: "per-person", calculationField: "people", durationUnit: "same-day", availability: 10 },
  });
  const result = validateBookingSchedule({ option, startDate: "2026-08-21" });
  assert.equal(result.ok, true);
  assert.equal(result.startDate, "2026-08-21");
  assert.equal(result.endDate, "2026-08-21");
});

test("automatic per-night booking can be created without clock times", async (context) => {
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
        cells: {
          service: "Room with all needs",
          price: 99997,
          priceType: "per-night",
          calculationField: "duration",
          durationUnit: "nights",
          maximumDuration: 10,
          availability: 4,
          availableFrom: "2026-07-01",
          availableTo: "2026-12-31",
          requiresTime: "no",
        },
      }],
    },
  };
  let created = null;

  SiteSetting.db._readyState = 1;
  SiteSetting.findOne = () => ({ lean: async () => ({ value: { bookingMode: "service-level" } }) });
  Hotel.findOne = async () => business;
  Hotel.countDocuments = async () => 1;
  Hotel.findOneAndUpdate = async () => business;
  Booking.create = async (data) => {
    created = { ...data, _id: "507f1f77bcf86cd799439033" };
    return created;
  };
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
      numberOfPeople: 2,
      quantity: 2,
      customerLocationDetails,
      startDate: "2026-07-10",
      endDate: "2026-07-12",
      bookingDetails: {
        customerLocationDetails,
        selectedOptionId: "room_option",
        requestedService: "Room with all needs",
        fullName: "Test Customer",
        phone: "+250788000000",
        email: "customer@example.com",
        numberOfPeople: 2,
        quantity: 2,
      },
    },
  }, result);

  assert.equal(result.statusCode, 201);
  assert.equal(created.startTime, "");
  assert.equal(created.endTime, "");
  assert.equal(created.bookingDetails.startDate, "2026-07-10");
  assert.equal(created.bookingDetails.endDate, "2026-07-12");
});
