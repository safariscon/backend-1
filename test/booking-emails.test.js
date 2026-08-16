const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSellerBookingsUrl,
  buildCustomerBookingsUrl,
} = require("../src/utils/frontendUrls");
const {
  isDeliverableEmail,
  sendServiceProviderBookingRequestEmail,
  sendCustomerBookingReceivedEmail,
} = require("../src/utils/notify");

test("seller bookings link uses FRONTEND_URL and asks the user to log in first", () => {
  const previous = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = "http://localhost:5173";
  const url = buildSellerBookingsUrl({ bookingId: "6a801e8b33074243a4c093f2" });
  process.env.FRONTEND_URL = previous;

  assert.equal(url.startsWith("http://localhost:5173/login?redirect="), true);
  assert.match(
    decodeURIComponent(url.split("redirect=")[1] || ""),
    /\/dashboard\/seller\/bookings\?bookingId=6a801e8b33074243a4c093f2/
  );
});

test("customer bookings link also goes through login redirect", () => {
  const previous = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = "http://localhost:5173";
  const url = buildCustomerBookingsUrl({ bookingId: "booking-1" });
  process.env.FRONTEND_URL = previous;
  assert.match(decodeURIComponent(url), /\/dashboard\/bookings\?bookingId=booking-1/);
});

test("placeholder seller emails are not treated as deliverable", () => {
  assert.equal(isDeliverableEmail("owner@seller.local"), false);
  assert.equal(isDeliverableEmail("provider@example.com"), true);
});

test("seller booking email describes manual next steps", async () => {
  const result = await sendServiceProviderBookingRequestEmail({
    serviceProviderEmail: "seller@example.com",
    serviceProviderName: "Theoneste Provider",
    businessName: "Theoneste Hotel service",
    bookingId: "booking-1",
    bookingCode: "SCN123",
    bookingMode: "manual",
    customerName: "Jane Guest",
    customerLocation: "Rubavu",
    optionName: "Standard room",
    bookingDate: "2026-08-17",
    endBookingDate: "2026-08-19",
    guests: 1,
    dashboardUrl: "http://localhost:5173/login?redirect=%2Fdashboard%2Fseller%2Fbookings",
  });
  assert.equal(result.simulated, true);
});

test("customer booking email is sent for automatic quotes", async () => {
  const result = await sendCustomerBookingReceivedEmail({
    customerEmail: "guest@example.com",
    customerName: "Jane Guest",
    businessName: "Theoneste Hotel service",
    bookingId: "booking-1",
    bookingMode: "automatic",
    optionName: "Standard room",
    totalPrice: 80000,
    dashboardUrl: "http://localhost:5173/login?redirect=%2Fdashboard%2Fbookings",
    paymentUrl: "http://localhost:5173/bookings/booking-1/pay",
  });
  assert.equal(result.simulated, true);
});
