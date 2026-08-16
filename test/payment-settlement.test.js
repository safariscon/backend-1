process.env.JWT_SECRET = "payment-settlement-test-secret";
process.env.PLATFORM_COMMISSION_RATE = "0.12";
process.env.XENTRIPAY_API_KEY = "your_xentripay_api_key";
process.env.XENTRIPAY_SIMULATE_SUCCESS = "true";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizePayoutDetails, normalizeCustomerPaymentDetails } = require("../src/utils/payoutDetails");
const { splitCollectedAmount, getPlatformCommissionPercentage, resolveCommissionPercentage } = require("../src/utils/commission");
const { getXentripayConfig, initiateCollection, initiatePayout, toClientPaymentError } = require("../src/services/xentripayService");

test("platform commission rate 0.12 becomes 12 percent", () => {
  assert.equal(getPlatformCommissionPercentage(), 12);
  assert.equal(resolveCommissionPercentage({ commissionPercentage: 8 }), 8);
});

test("collected amount is split into platform commission and provider payout", () => {
  const split = splitCollectedAmount(30000, 12);
  assert.equal(split.collectedAmount, 30000);
  assert.equal(split.platformAmount, 3600);
  assert.equal(split.providerAmount, 26400);
});

test("service provider payout details accept momo and bank but reject card", () => {
  const momo = normalizePayoutDetails({
    method: "mobile-money",
    providerId: "63510",
    accountName: "Jane Lodge",
    accountNumber: "250788302208",
  });
  assert.equal(momo.ok, true);
  assert.equal(momo.value.method, "momo");
  assert.equal(momo.value.msisdn, "0788302208");
  assert.equal(momo.value.providerName, "MTN MOBILE MONEY");

  const bank = normalizePayoutDetails({
    method: "bank",
    providerId: "040",
    accountName: "Jane Lodge",
    accountNumber: "40123456789",
  });
  assert.equal(bank.ok, true);
  assert.equal(bank.value.method, "bank");

  const card = normalizePayoutDetails({
    method: "card",
    providerId: "63510",
    accountName: "Jane Lodge",
    accountNumber: "0788302208",
  });
  assert.equal(card.ok, false);
  assert.match(card.message, /Card can be used by customers/i);
});

test("customer collection details accept momo and card", () => {
  const momo = normalizeCustomerPaymentDetails({
    paymentMethod: "momo",
    email: "guest@example.com",
    cname: "Guest User",
    cnumber: "0780371519",
  });
  assert.equal(momo.ok, true);
  assert.equal(momo.value.pmethod, "momo");
  assert.equal(momo.value.msisdn, "250780371519");

  const card = normalizeCustomerPaymentDetails({
    paymentMethod: "card",
    email: "guest@example.com",
    name: "Guest User",
    phone: "0780371519",
  });
  assert.equal(card.ok, true);
  assert.equal(card.value.pmethod, "cc");
});

test("placeholder XentriPay key stays in simulation mode", async () => {
  const config = getXentripayConfig();
  assert.equal(config.configured, false);

  const collection = await initiateCollection({
    email: "guest@example.com",
    cname: "Guest User",
    cnumber: "0780371519",
    msisdn: "250780371519",
    amount: 30000,
    pmethod: "momo",
    customerRef: "PAY-TEST",
    details: "test",
  });
  assert.equal(collection.simulated, true);
  assert.equal(collection.success, 1);

  const payout = await initiatePayout({
    customerReference: "PO-TEST",
    telecomProviderId: "63510",
    msisdn: "0788302208",
    name: "Jane Lodge",
    amount: 26400,
  });
  assert.equal(payout.simulated, true);
  assert.equal(payout.status, "PENDING");
});

test("missing XentriPay key does not fake a live MoMo prompt", async () => {
  const previousKey = process.env.XENTRIPAY_API_KEY;
  const previousSimulate = process.env.XENTRIPAY_SIMULATE_SUCCESS;
  process.env.XENTRIPAY_API_KEY = "";
  process.env.XENTRIPAY_SIMULATE_SUCCESS = "false";
  try {
    await assert.rejects(
      () =>
        initiateCollection({
          email: "guest@example.com",
          cname: "Guest User",
          cnumber: "0780371519",
          msisdn: "250780371519",
          amount: 3000,
          pmethod: "momo",
          customerRef: "PAY-LIVE-TEST",
          details: "test",
        }),
      (error) => error.status === 503 && /backend \.env/i.test(error.message)
    );
  } finally {
    process.env.XENTRIPAY_API_KEY = previousKey;
    process.env.XENTRIPAY_SIMULATE_SUCCESS = previousSimulate;
  }
});

test("XentriPay 401 is mapped to 502 so the customer is not logged out", () => {
  const mapped = toClientPaymentError({
    status: 401,
    message: "Unauthorized",
    code: "PAYMENT_GATEWAY_ERROR",
  });
  assert.equal(mapped.status, 502);
  assert.equal(mapped.code, "PAYMENT_GATEWAY_UNAUTHORIZED");
  assert.match(mapped.message, /still signed in/i);
});
