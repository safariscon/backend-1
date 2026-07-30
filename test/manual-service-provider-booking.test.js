const test = require("node:test");
const assert = require("node:assert/strict");
const Booking = require("../src/models/Booking");
const Hotel = require("../src/models/Hotel");
const { updateBookingStatus } = require("../src/controllers/hotelController");
const { approveBooking } = require("../src/controllers/adminController");

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

test("service provider approves manual booking with price and deadline without exposing customer contacts or commission", async (context) => {
  const originalHotelFind = Hotel.find;
  const originalHotelFindById = Hotel.findById;
  const originalBookingFindOne = Booking.findOne;
  const business = {
    _id: "business-1",
    name: "Kigali City Tour",
    supplierId: "supplier-1",
    commissionPercentage: 5,
  };
  const booking = {
    _id: "booking-1",
    touristId: { _id: "customer-1", name: "Customer One", email: "customer@example.com" },
    preferredHotelId: "business-1",
    hotelId: null,
    quantity: 2,
    paymentStatus: "unpaid",
    bookingDetails: {
      fullName: "Customer One",
      phone: "+250788000000",
      email: "customer@example.com",
      customerLocation: "Kigali",
      requestedService: "City tour",
    },
    async save() {},
  };

  Hotel.find = () => ({
    select: async () => [{ _id: "business-1" }],
  });
  Hotel.findById = async (id) => (String(id) === "business-1" ? business : null);
  Booking.findOne = () => ({
    populate: async () => booking,
  });

  context.after(() => {
    Hotel.find = originalHotelFind;
    Hotel.findById = originalHotelFindById;
    Booking.findOne = originalBookingFindOne;
  });

  const result = response();
  await updateBookingStatus(
    {
      params: { bookingId: "booking-1" },
      body: { status: "confirmed", totalPrice: 100000, paymentDeadlineHours: 12 },
      user: { _id: "seller-1", role: "hotel", email: "seller@example.com" },
    },
    result
  );

  assert.equal(result.statusCode, 200);
  assert.equal(booking.status, "confirmed");
  assert.equal(booking.totalPrice, 100000);
  assert.equal(booking.depositAmount, 30000);
  assert.equal(booking.commissionPercentage, 5);
  assert.equal(booking.commissionAmount, 5000);
  assert.equal(booking.sellerApproval.status, "approved");
  assert.ok(booking.paymentDeadlineAt);
  assert.equal(result.body.booking.bookingDetails.phone, undefined);
  assert.equal(result.body.booking.bookingDetails.email, undefined);
  assert.equal(result.body.booking.commissionAmount, undefined);
});

test("admin cannot approve manual booking assigned to a service provider", async (context) => {
  const originalFindById = Booking.findById;

  Booking.findById = () => ({
    select: async () => ({
      _id: "booking-1",
      bookingMode: "manual",
      preferredHotelId: "business-1",
      hotelId: null,
      status: "pending",
    }),
  });

  context.after(() => {
    Booking.findById = originalFindById;
  });

  const result = response();
  await approveBooking(
    {
      params: { bookingId: "booking-1" },
      body: { totalPrice: 100000, paymentReason: "Approved service" },
      user: { _id: "admin-1", role: "admin" },
    },
    result
  );

  assert.equal(result.statusCode, 409);
  assert.match(result.body.message, /service provider/i);
});
