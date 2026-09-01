const test = require("node:test");
const assert = require("node:assert/strict");
const Booking = require("../src/models/Booking");
const Hotel = require("../src/models/Hotel");
const Transaction = require("../src/models/Transaction");
const { cancelBooking, hasDepositPaid, listMyBookings, payBooking, runBookingNoActionRefundCleanup } = require("../src/controllers/bookingController");

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const makeBookingDoc = (data) => ({
  ...data,
  toObject() { return { ...this }; },
  async save() { return this; },
});

test("customer booking details are locked before 30% payment", async (context) => {
  const originalFind = Booking.find;
  const business = {
    _id: "507f1f77bcf86cd799439022",
    name: "Exact Provider",
    type: "tours",
    description: "Public tour details",
    basePrice: 100000,
    location: "Kigali",
    locationDetails: { district: "Gasabo", sector: "Kimironko" },
    contactInfo: "private@example.com",
    contactDetails: {
      phone: "+250788000000",
      exactAddress: "Private street",
      latitude: -1.9,
      longitude: 30.1,
      googleMapsUrl: "https://maps.example/private",
    },
  };
  const documents = [makeBookingDoc({
    _id: "507f1f77bcf86cd799439033",
    touristId: "507f1f77bcf86cd799439011",
    status: "confirmed",
    paymentStatus: "unpaid",
    detailsUnlocked: false,
    totalPrice: 100000,
    depositAmount: 30000,
    hotelId: business,
    preferredHotelId: business,
  })];

  Booking.find = (query) => {
    if (query.paymentStatus) return Promise.resolve([]);
    const chain = { populate() { return chain; }, sort: async () => documents };
    return chain;
  };
  context.after(() => { Booking.find = originalFind; });

  const result = response();
  await listMyBookings({ user: { _id: "507f1f77bcf86cd799439011" } }, result);

  const booking = result.body.bookings[0];
  assert.equal(booking.providerDetailsUnlocked, false);
  assert.equal(booking.detailsUnlocked, false);
  assert.equal(booking.hotelId.district, "Gasabo");
  assert.equal(booking.hotelId.sector, "Kimironko");
  assert.equal(booking.lockedDetails.visible.price, 100000);
  assert.equal(booking.lockedDetails.visible.depositAmountRequired, 30000);
  assert.equal(booking.hotelId.contactInfo, undefined);
  assert.equal(booking.hotelId.contactDetails, undefined);
});

test("details unlock after successful 30% payment", async (context) => {
  process.env.XENTRIPAY_SIMULATE_SUCCESS = "true";
  const originals = {
    bookingFindOne: Booking.findOne,
    bookingFindOneAndUpdate: Booking.findOneAndUpdate,
    hotelFindById: Hotel.findById,
    transactionCreate: Transaction.create,
    transactionFindOne: Transaction.findOne,
  };
  const booking = makeBookingDoc({
    _id: "507f1f77bcf86cd799439033",
    touristId: "507f1f77bcf86cd799439011",
    status: "confirmed",
    bookingMode: "manual",
    paymentStatus: "unpaid",
    totalPrice: 100000,
    depositAmount: 30000,
    depositPercent: 30,
    depositPercentage: 30,
    commissionPercentage: 12,
    hotelId: "507f1f77bcf86cd799439022",
    preferredHotelId: "507f1f77bcf86cd799439022",
    bookingCode: "SCN-TEST",
    verificationCode: "VERIFY-TEST",
    verificationToken: "token",
    receipt: {},
  });
  const paidBooking = makeBookingDoc({ ...booking });
  const business = {
    _id: booking.hotelId,
    ownerUserId: "seller",
    sellerContactEmail: "seller@example.com",
    commissionPercentage: 12,
    payoutDetails: {
      method: "momo",
      providerId: "63510",
      providerName: "MTN MOBILE MONEY",
      accountName: "Demo Lodge",
      accountNumber: "0788302208",
      msisdn: "0788302208",
    },
    async save() { return this; },
  };

  Booking.findOne = () => ({ populate: async () => booking });
  Booking.findOneAndUpdate = (_filter, update) => ({
    populate: async () => {
      Object.assign(paidBooking, update.$set);
      return paidBooking;
    },
  });
  Hotel.findById = async () => business;
  Transaction.findOne = () => ({ sort: async () => null });
  Transaction.create = async (data) => ({ ...data, _id: "transaction", async save() { return this; } });
  context.after(() => {
    Booking.findOne = originals.bookingFindOne;
    Booking.findOneAndUpdate = originals.bookingFindOneAndUpdate;
    Hotel.findById = originals.hotelFindById;
    Transaction.create = originals.transactionCreate;
    Transaction.findOne = originals.transactionFindOne;
    delete process.env.XENTRIPAY_SIMULATE_SUCCESS;
  });

  const result = response();
  await payBooking({
    params: { bookingId: booking._id },
    body: {
      paymentMethod: "momo",
      email: "customer@example.com",
      cname: "Demo Customer",
      cnumber: "0780371519",
    },
    user: { _id: booking.touristId, email: "customer@example.com", name: "Demo Customer", role: "customer" },
    headers: {},
  }, result);

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.booking.paymentStatus, "deposit_paid");
  assert.equal(result.body.booking.detailsUnlocked, true);
  assert.equal(result.body.booking.amountPaid, 30000);
  assert.equal(result.body.split.platformAmount, 12000);
  assert.equal(result.body.split.providerAmount, 18000);
  assert.equal(hasDepositPaid(result.body.booking), true);
});

test("customer cancellation refunds 20% of paid deposit", async (context) => {
  const originalFindOne = Booking.findOne;
  const booking = makeBookingDoc({
    _id: "507f1f77bcf86cd799439033",
    touristId: "507f1f77bcf86cd799439011",
    status: "confirmed",
    paymentStatus: "deposit_paid",
    detailsUnlocked: true,
    amountPaid: 30000,
    depositAmount: 30000,
    refundStatus: "none",
    cancellation: {},
  });
  Booking.findOne = async () => booking;
  context.after(() => { Booking.findOne = originalFindOne; });

  const result = response();
  await cancelBooking({
    params: { bookingId: booking._id },
    body: { cancellationReason: "Plans changed" },
    user: { _id: booking.touristId, role: "customer" },
  }, result);

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.booking.status, "cancelled");
  assert.equal(result.body.booking.refundAmount, 6000);
  assert.equal(result.body.booking.refundPercentOfDeposit, 20);
});

test("no-action refund gives 15% of paid deposit and skips successful re-book deposits", async (context) => {
  const originalFind = Booking.find;
  const past = new Date("2026-07-01T00:00:00.000Z");
  const now = new Date("2026-07-07T00:00:00.000Z");
  const stale = makeBookingDoc({
    _id: "stale",
    status: "provider-details-unlocked",
    paymentStatus: "deposit_paid",
    detailsUnlocked: true,
    amountPaid: 30000,
    depositAmount: 30000,
    refundStatus: "none",
    bookingDetails: { bookingDate: past },
    cancellation: {},
  });
  const rebooked = makeBookingDoc({
    _id: "rebooked",
    status: "provider-details-unlocked",
    paymentStatus: "deposit_paid",
    detailsUnlocked: true,
    amountPaid: 30000,
    depositAmount: 30000,
    refundStatus: "not_applicable",
    refundAmount: 0,
    rebookRequestId: "request",
    bookingDetails: { bookingDate: past },
    cancellation: {},
  });
  Booking.find = async () => [stale, rebooked];
  context.after(() => { Booking.find = originalFind; });

  const summary = await runBookingNoActionRefundCleanup({ now });

  assert.equal(summary.noActionRefunded, 1);
  assert.equal(stale.status, "cancelled");
  assert.equal(stale.refundAmount, 4500);
  assert.equal(stale.refundPercentOfDeposit, 15);
  assert.equal(rebooked.refundStatus, "not_applicable");
  assert.equal(rebooked.refundAmount, 0);
});
