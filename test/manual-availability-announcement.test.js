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
      description: "Buy 3 bottles and get 1 free.",
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
    },
  }, result);

  assert.equal(result.statusCode, 201);
  assert.equal(createdBooking.promotionSnapshot.title, "Happy Hour");
  assert.match(createdBooking.promotionSnapshot.description, /get 1 free/i);
});
