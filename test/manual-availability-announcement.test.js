const test = require("node:test");
const assert = require("node:assert/strict");
const Hotel = require("../src/models/Hotel");
const Booking = require("../src/models/Booking");
const SiteSetting = require("../src/models/SiteSetting");
const { createBookingRequest } = require("../src/controllers/bookingController");
const { updateAnnouncement } = require("../src/controllers/adminController");

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const customerLocationDetails = {
  province: "Western Province",
  district: "Rubavu",
  sector: "Gisenyi",
  cell: "Amahoro",
  village: "Umucyo",
};

const bookingSchedule = {
  bookingDate: "2026-07-10",
  endBookingDate: "2026-07-10",
  startTime: "18:00",
  endTime: "20:00",
};

test("booking checks seller/admin status without quantity-driven availability", async (context) => {
  const originalFindOne = Hotel.findOne;
  let receivedQuery = null;
  Hotel.findOne = async (query) => {
    receivedQuery = query;
    return null;
  };
  context.after(() => { Hotel.findOne = originalFindOne; });

  const result = response();
  await createBookingRequest({
    user: { _id: "507f1f77bcf86cd799439011" },
    body: {
      hotelId: "507f1f77bcf86cd799439022",
      quantity: 10,
      destinationPlace: "Tour",
      destinationLocation: "Kigali",
    },
  }, result);

  assert.equal(result.statusCode, 404);
  assert.equal(receivedQuery.status, "available");
  assert.equal(receivedQuery.quantityRemaining, undefined);
});

test("admin announcement interval is stored in seconds", async (context) => {
  const originalFindOneAndUpdate = SiteSetting.findOneAndUpdate;
  let storedValue = null;
  SiteSetting.findOneAndUpdate = async (_filter, update) => {
    storedValue = update.$set.value;
    return { value: storedValue };
  };
  context.after(() => { SiteSetting.findOneAndUpdate = originalFindOneAndUpdate; });

  const result = response();
  await updateAnnouncement({
    body: {
      enabled: true,
      intervalSeconds: 12,
      items: [{ text: "Seconds-based announcement" }],
    },
  }, result);

  assert.equal(result.statusCode, 200);
  assert.equal(storedValue.intervalSeconds, 12);
  assert.equal(storedValue.intervalMinutes, undefined);
});

test("booking stores the promotion that was active when the customer booked", async (context) => {
  const originalFindOne = Hotel.findOne;
  const originalCountDocuments = Hotel.countDocuments;
  const originalCreate = Booking.create;
  let createdBooking = null;
  const now = Date.now();
  Hotel.findOne = async () => ({
    _id: "507f1f77bcf86cd799439022",
    type: "bars-and-pubs",
    promotion: {
      enabled: true,
      title: "Happy Hour",
      percent: 25,
      note: "Save on happy hour.",
      startAt: new Date(now - 60_000),
      endAt: new Date(now + 60_000),
    },
  });
  Hotel.countDocuments = async () => 1;
  Booking.create = async (data) => {
    createdBooking = { ...data, _id: "507f1f77bcf86cd799439033" };
    return createdBooking;
  };
  context.after(() => {
    Hotel.findOne = originalFindOne;
    Hotel.countDocuments = originalCountDocuments;
    Booking.create = originalCreate;
  });

  const result = response();
  await createBookingRequest({
    user: { _id: "507f1f77bcf86cd799439011" },
    body: {
      hotelId: "507f1f77bcf86cd799439022",
      destinationPlace: "Happy Hour booking",
      destinationLocation: "Rubavu",
      quantity: 3,
      customerLocationDetails,
      ...bookingSchedule,
      bookingDetails: { customerLocationDetails, ...bookingSchedule },
    },
  }, result);

  assert.equal(result.statusCode, 201);
  assert.equal(createdBooking.promotionSnapshot.title, "Happy Hour");
  assert.equal(createdBooking.promotionSnapshot.percent, 25);
  assert.match(createdBooking.promotionSnapshot.note, /happy hour/i);
});

test("manual booking with a selected option does not crash when there is no automatic quote", async (context) => {
  const originalFindOne = Hotel.findOne;
  const originalCountDocuments = Hotel.countDocuments;
  const originalCreate = Booking.create;
  let createdBooking = null;
  Hotel.findOne = async () => ({
    _id: "6a801e8b33074243a4c093f2",
    type: "hotel-rooms",
    name: "Theoneste Hotel service",
    bookingMode: "manual",
    approvalStatus: "approved",
    status: "available",
    availabilityTable: {
      rows: [
        {
          id: "room_option",
          cells: { service: "Standard room", price: 50000, availability: 5 },
        },
      ],
    },
  });
  Hotel.countDocuments = async () => 1;
  Booking.create = async (data) => {
    createdBooking = { ...data, _id: "booking-manual-1" };
    return createdBooking;
  };
  context.after(() => {
    Hotel.findOne = originalFindOne;
    Hotel.countDocuments = originalCountDocuments;
    Booking.create = originalCreate;
  });

  const result = response();
  await createBookingRequest({
    user: { _id: "507f1f77bcf86cd799439011", role: "customer" },
    body: {
      hotelId: "6a801e8b33074243a4c093f2",
      quantity: 1,
      numberOfPeople: 1,
      guests: 1,
      bookingDate: "2026-08-17",
      endBookingDate: "2026-08-19",
      checkIn: "2026-08-17",
      checkOut: "2026-08-19",
      startTime: "11:44",
      endTime: "11:48",
      totalPrice: 0,
      destinationPlace: "Hotel 1",
      destinationLocation: "Rubavu",
      customerLocation: "Bugu, RRukoko, rubavu, Rubavu, Eastern Province, Rwanda",
      customerLocationDetails,
      bookingDetails: {
        selectedOptionId: "room_option",
        requestedService: "Standard room",
      },
    },
  }, result);

  assert.equal(result.statusCode, 201, result.body?.error || result.body?.message);
  assert.equal(createdBooking.bookingMode, "manual");
  assert.equal(createdBooking.status, "pending");
  assert.equal(createdBooking.priceSnapshot.numberOfPeople, 1);
  assert.equal(createdBooking.priceSnapshot.totalPrice, 0);
  assert.equal(createdBooking.availabilityReservation, undefined);
});
