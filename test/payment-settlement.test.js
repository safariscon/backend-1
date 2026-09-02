process.env.JWT_SECRET = "payment-settlement-test-secret";
process.env.PLATFORM_COMMISSION_RATE = "0.12";
process.env.XENTRIPAY_API_KEY = "your_xentripay_api_key";
process.env.XENTRIPAY_SIMULATE_SUCCESS = "true";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizePayoutDetails, normalizeCustomerPaymentDetails } = require("../src/utils/payoutDetails");
const { splitCollectedAmount, getPlatformCommissionPercentage, resolveCommissionPercentage } = require("../src/utils/commission");
const { getXentripayConfig, initiateCollection, initiatePayout, toClientPaymentError, buildCollectionInitiatePayload, customerPaysExactCollectionAmount } = require("../src/services/xentripayService");

test("platform commission rate 0.12 becomes 12 percent", () => {
  assert.equal(getPlatformCommissionPercentage(), 12);
  assert.equal(resolveCommissionPercentage({ commissionPercentage: 8 }), 8);
});

test("collected amount is split using commission on full booking price", () => {
  const full = splitCollectedAmount(30000, 12, 30000);
  assert.equal(full.collectedAmount, 30000);
  assert.equal(full.commissionDue, 3600);
  assert.equal(full.platformAmount, 3600);
  assert.equal(full.providerAmount, 26400);

  const deposit = splitCollectedAmount(15000, 10, 30000);
  assert.equal(deposit.collectedAmount, 15000);
  assert.equal(deposit.commissionDue, 3000);
  assert.equal(deposit.platformAmount, 3000);
  assert.equal(deposit.providerAmount, 12000);

  const small = splitCollectedAmount(120, 10, 1200);
  assert.equal(small.commissionDue, 120);
  assert.equal(small.platformAmount, 120);
  assert.equal(small.providerAmount, 0);
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

test("payout account helpers normalize names and msisdn for XentriPay", () => {
  const {
    normalizePayoutAccountName,
    parseXentripayRegisteredName,
    formatPayoutMsisdnForGateway,
    payoutMsisdnCandidatesForXentripay,
    formatPayoutFailureMessage,
  } = require("../src/utils/payoutDetails");

  assert.equal(normalizePayoutAccountName("  DUFITIMANA   Theoneste  "), "DUFITIMANA Theoneste");
  assert.equal(
    parseXentripayRegisteredName("Correct Registered name is : DUFITIMANA Theoneste"),
    "DUFITIMANA Theoneste"
  );
  assert.equal(formatPayoutMsisdnForGateway("0793559258"), "0793559258");
  assert.equal(formatPayoutMsisdnForGateway("250793559258"), "0793559258");
  assert.deepEqual(payoutMsisdnCandidatesForXentripay("0793559258"), ["0793559258", "250793559258", "+250793559258"]);
  assert.match(
    formatPayoutFailureMessage({ message: "Invalid FSP Account" }, { recipientName: "DUFITIMANA Theoneste", msisdn: "0793559258" }),
    /Invalid FSP Account/i
  );
  assert.doesNotMatch(
    formatPayoutFailureMessage({ message: "Invalid FSP Account" }, { recipientName: "DUFITIMANA Theoneste", msisdn: "0793559258" }),
    /not the wallet owner/i
  );
});

test("collected amount split matches deposit model (1000 deposit on 2000 listing)", () => {
  const split = splitCollectedAmount(1000, 10, 2000);
  assert.equal(split.platformAmount, 200);
  assert.equal(split.providerAmount, 800);
});

test("collection payload keeps gateway fees on merchant (chargesIncluded true)", () => {
  const previousPassFees = process.env.XENTRIPAY_PASS_FEES_TO_CUSTOMER;
  const previousIncluded = process.env.XENTRIPAY_CHARGES_INCLUDED;
  process.env.XENTRIPAY_PASS_FEES_TO_CUSTOMER = "false";
  process.env.XENTRIPAY_CHARGES_INCLUDED = "true";
  try {
    assert.equal(customerPaysExactCollectionAmount(), true);
    const { payload, wholeAmount, chargesIncluded } = buildCollectionInitiatePayload({
      email: "guest@example.com",
      cname: "Guest",
      amount: 1000,
      cnumber: "0780371519",
      msisdn: "250780371519",
      currency: "RWF",
      pmethod: "momo",
      customerRef: "PAY-1000",
      details: "test",
      collectionRedirectUrl: "",
      collectionReturnUrl: "",
    });
    assert.equal(wholeAmount, 1000);
    assert.equal(chargesIncluded, true);
    assert.equal(payload.amount, 1000);
    assert.equal(payload.chargesIncluded, true);
    assert.equal(payload.pmethod, "momo");
  } finally {
    process.env.XENTRIPAY_PASS_FEES_TO_CUSTOMER = previousPassFees;
    process.env.XENTRIPAY_CHARGES_INCLUDED = previousIncluded;
  }
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
