const test = require("node:test");
const assert = require("node:assert/strict");
const Booking = require("../src/models/Booking");
const { listMyBookings } = require("../src/controllers/bookingController");
const { approveBooking } = require("../src/controllers/adminController");
const { createPdfReceipt } = require("../src/utils/pdfReceipt");
const { PassThrough } = require("node:stream");
const { uploadBookingPdf } = require("../src/services/bookingPdfStorage");

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

test("customer dashboard returns approved payment reason and paid receipt data", async (context) => {
  const originalFind = Booking.find;
  const approvedBusiness = {
    _id: "507f1f77bcf86cd799439022",
    name: "Demo Provider",
    type: "tours",
    location: "Kigali",
    locationDetails: { district: "Gasabo" },
  };
  const documents = [
    {
      toObject: () => ({
        _id: "507f1f77bcf86cd799439033",
        touristId: "507f1f77bcf86cd799439011",
        status: "confirmed",
        paymentStatus: "unpaid",
        totalPrice: 100000,
        depositAmount: 30000,
        paymentReason: "30% deposit for the confirmed city tour",
        adminResponseMessage: "Booking approved. Payment purpose: 30% deposit for the confirmed city tour",
        hotelId: approvedBusiness,
        preferredHotelId: approvedBusiness,
      }),
    },
    {
      toObject: () => ({
        _id: "507f1f77bcf86cd799439044",
        touristId: "507f1f77bcf86cd799439011",
        status: "confirmed",
        paymentStatus: "deposit-paid",
        amountPaid: 30000,
        paymentReason: "30% deposit for airport transport",
        verificationToken: "receipt-token",
        hotelId: approvedBusiness,
      }),
    },
  ];

  Booking.find = (query) => {
    if (query.paymentStatus) return Promise.resolve([]);
    const chain = {
      populate() { return chain; },
      sort: async () => documents,
    };
    return chain;
  };
  context.after(() => {
    Booking.find = originalFind;
  });

  const result = response();
  await listMyBookings({ user: { _id: "507f1f77bcf86cd799439011" } }, result);

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.bookings.length, 2);
  assert.equal(result.body.bookings[0].paymentReason, "30% deposit for the confirmed city tour");
  assert.match(result.body.bookings[0].adminResponseMessage, /Payment purpose/);
  assert.equal(result.body.bookings[0].providerDetailsUnlocked, false);
  assert.equal(result.body.bookings[1].providerDetailsUnlocked, true);
  assert.equal(result.body.bookings[1].verificationToken, "receipt-token");
});

test("admin approval requires a customer payment reason", async () => {
  const result = response();
  await approveBooking(
    { params: { bookingId: "507f1f77bcf86cd799439033" }, body: { totalPrice: 100000 } },
    result
  );
  assert.equal(result.statusCode, 400);
  assert.match(result.body.message, /reason or purpose/i);
});

test("paid booking PDF includes the expanded booking payment document", async () => {
  const pdf = await createPdfReceipt({
    booking: {
      _id: "507f1f77bcf86cd799439044",
      bookingCode: "SCN-BOOKING",
      status: "confirmed",
      paymentStatus: "deposit-paid",
      totalPrice: 100000,
      amountPaid: 30000,
      quantity: 2,
      paymentReason: "30% deposit for airport transport",
      paymentReference: "PAY-REFERENCE",
      verificationToken: "receipt-token",
      touristId: { name: "Demo Customer" },
      bookingDetails: { serviceName: "Airport transport" },
      receipt: { receiptNumber: "RCT-TEST", generatedAt: new Date() },
    },
    business: { name: "Demo Provider", location: "Kigali", contactInfo: "provider@example.com" },
    transaction: { transactionId: "TXN-TEST" },
    verifyUrl: "https://example.com/verify/receipt-token",
  });
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  assert.ok(pdf.length > 1000);
});

test("booking PDF uploads to authenticated Cloudinary raw storage", async () => {
  let uploadOptions = null;
  let uploadedBytes = 0;
  const fakeCloudinary = {
    uploader: {
      upload_stream(options, callback) {
        uploadOptions = options;
        const stream = new PassThrough();
        stream.on("data", (chunk) => { uploadedBytes += chunk.length; });
        stream.on("end", () => callback(null, {
          secure_url: "https://cloudinary.example/authenticated/booking.pdf",
          public_id: options.public_id,
          bytes: uploadedBytes,
          resource_type: options.resource_type,
          type: options.type,
        }));
        return stream;
      },
    },
  };
  const pdf = Buffer.from("%PDF-test-booking");
  const stored = await uploadBookingPdf(pdf, "RCT-TEST-1", fakeCloudinary);

  assert.equal(uploadOptions.resource_type, "raw");
  assert.equal(uploadOptions.type, "authenticated");
  assert.match(uploadOptions.public_id, /booking-pdfs\/RCT-TEST-1$/);
  assert.equal(stored.bytes, pdf.length);
  assert.equal(stored.deliveryType, "authenticated");
});
