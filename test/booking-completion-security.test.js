const test = require("node:test");
const assert = require("node:assert/strict");
const Booking = require("../src/models/Booking");
const Hotel = require("../src/models/Hotel");
const { completeVerifiedBooking, verifyBookingCodeForCompletion } = require("../src/controllers/hotelController");

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const makeChain = (value) => ({
  populate() { return makeChain(value); },
  select() { return makeChain(value); },
  sort() { return makeChain(value); },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});

const installMocks = (context, { businessIds = ["business-1"], bookings = [] }) => {
  const originals = {
    hotelFind: Hotel.find,
    bookingFindOne: Booking.findOne,
    bookingFindOneAndUpdate: Booking.findOneAndUpdate,
  };

  Hotel.find = () => ({ distinct: async () => businessIds });
  Booking.findOne = (query) => {
    const booking = bookings.find((item) =>
      (!query._id || String(item._id) === String(query._id)) &&
      (!query.bookingCode || item.bookingCode === query.bookingCode) &&
      (!query.paymentStatus?.$in || query.paymentStatus.$in.includes(item.paymentStatus)) &&
      (!query.detailsUnlocked || item.detailsUnlocked === query.detailsUnlocked) &&
      (!query.bookingCodeUsed || item.bookingCodeUsed !== true) &&
      (!query.completionStatus?.$ne || item.completionStatus !== query.completionStatus.$ne) &&
      (!query.status?.$nin || !query.status.$nin.includes(item.status)) &&
      (!query.$or || query.$or.some((condition) =>
        condition.hotelId?.$in?.includes(item.hotelId) || condition.preferredHotelId?.$in?.includes(item.preferredHotelId)
      ))
    );
    return makeChain(booking || null);
  };
  Booking.findOneAndUpdate = (query, update) => {
    const booking = bookings.find((item) =>
      String(item._id) === String(query._id) &&
      item.bookingCode === query.bookingCode &&
      item.bookingCodeUsed !== true &&
      item.completionStatus !== "completed" &&
      !query.status.$nin.includes(item.status) &&
      query.paymentStatus.$in.includes(item.paymentStatus) &&
      item.detailsUnlocked === true &&
      query.$or.some((condition) => condition.hotelId?.$in?.includes(item.hotelId) || condition.preferredHotelId?.$in?.includes(item.preferredHotelId))
    );
    if (!booking) return makeChain(null);
    Object.assign(booking, update.$set);
    booking.completionAuditLogs = [...(booking.completionAuditLogs || []), update.$push.completionAuditLogs];
    return makeChain(booking);
  };

  context.after(() => {
    Hotel.find = originals.hotelFind;
    Booking.findOne = originals.bookingFindOne;
    Booking.findOneAndUpdate = originals.bookingFindOneAndUpdate;
  });
};

test("seller verifies valid Booking Code and receives safe summary", async (context) => {
  installMocks(context, {
    bookings: [{
      _id: "booking-1",
      bookingCode: "SCN-VALID",
      hotelId: "business-1",
      status: "confirmed",
      paymentStatus: "deposit_paid",
      detailsUnlocked: true,
      bookingCodeUsed: false,
      completionStatus: "pending",
      totalPrice: 100000,
      depositAmount: 30000,
      bookingDetails: { fullName: "Demo Customer", requestedService: "City tour", bookingDate: "2026-07-07" },
    }],
  });

  const result = response();
  await verifyBookingCodeForCompletion({
    user: { _id: "seller-1", role: "hotel", email: "seller@example.com" },
    body: { code: "SCN-VALID" },
  }, result);

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.valid, true);
  assert.equal(result.body.booking.bookingId, "booking-1");
  assert.equal(result.body.booking.remainingAmount, 70000);
});

test("seller cannot verify invalid, other-seller, or unpaid Booking Codes", async (context) => {
  installMocks(context, {
    businessIds: ["business-1"],
    bookings: [
      { _id: "other", bookingCode: "SCN-OTHER", hotelId: "business-2", status: "confirmed", paymentStatus: "deposit_paid", detailsUnlocked: true },
      { _id: "unpaid", bookingCode: "SCN-UNPAID", hotelId: "business-1", status: "confirmed", paymentStatus: "pending", detailsUnlocked: false },
    ],
  });

  const invalid = response();
  await verifyBookingCodeForCompletion({ user: { _id: "seller-1", role: "hotel" }, body: { code: "NOPE" } }, invalid);
  assert.equal(invalid.statusCode, 404);

  const otherSeller = response();
  await verifyBookingCodeForCompletion({ user: { _id: "seller-1", role: "hotel" }, body: { code: "SCN-OTHER" } }, otherSeller);
  assert.equal(otherSeller.statusCode, 404);

  const unpaid = response();
  await verifyBookingCodeForCompletion({ user: { _id: "seller-1", role: "hotel" }, body: { code: "SCN-UNPAID" } }, unpaid);
  assert.equal(unpaid.statusCode, 409);
});

test("seller completes verified booking once and Booking ID alone cannot complete", async (context) => {
  const booking = {
    _id: "booking-1",
    bookingCode: "SCN-VALID",
    hotelId: "business-1",
    status: "confirmed",
    paymentStatus: "deposit_paid",
    detailsUnlocked: true,
    bookingCodeUsed: false,
    completionStatus: "pending",
    totalPrice: 100000,
    depositAmount: 30000,
    completionAuditLogs: [],
  };
  installMocks(context, { bookings: [booking] });

  const noCode = response();
  await completeVerifiedBooking({
    user: { _id: "seller-1", role: "hotel" },
    body: { bookingId: "booking-1", confirmRemainingPaid: true },
  }, noCode);
  assert.equal(noCode.statusCode, 400);

  const completed = response();
  await completeVerifiedBooking({
    user: { _id: "seller-1", role: "hotel" },
    body: { bookingId: "booking-1", code: "SCN-VALID", confirmRemainingPaid: true },
  }, completed);
  assert.equal(completed.statusCode, 200);
  assert.equal(booking.status, "completed");
  assert.equal(booking.paymentStatus, "completed");
  assert.equal(booking.bookingCodeUsed, true);
  assert.equal(booking.remainingAmount, 70000);
  assert.equal(booking.completionAuditLogs.length, 1);

  const duplicate = response();
  await completeVerifiedBooking({
    user: { _id: "seller-1", role: "hotel" },
    body: { bookingId: "booking-1", code: "SCN-VALID", confirmRemainingPaid: true },
  }, duplicate);
  assert.equal(duplicate.statusCode, 409);
  assert.equal(booking.completionAuditLogs.length, 1);
});
