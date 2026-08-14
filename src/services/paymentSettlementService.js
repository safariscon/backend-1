const Transaction = require("../models/Transaction");
const { prefixedCode } = require("../utils/secureIds");
const { hasCompletePayoutDetails } = require("../utils/payoutDetails");
const { resolveCommissionPercentage, splitCollectedAmount } = require("../utils/commission");
const {
  getXentripayConfig,
  initiateCollection,
  getCollectionStatus,
  initiatePayout,
  getPayoutStatus,
  normalizeCollectionStatus,
  normalizePayoutStatus,
} = require("./xentripayService");

const mapPaymentMethod = (pmethod) => (pmethod === "cc" ? "card" : "mobile-money");

const collectionReferenceOf = (transaction) =>
  transaction?.collectionRef || transaction?.paymentReference || transaction?.customerRef;

const buildSplit = (collectedAmount, business, booking) => {
  const percentage =
    Number.isFinite(Number(booking?.commissionPercentage)) && Number(booking.commissionPercentage) > 0
      ? Number(booking.commissionPercentage)
      : resolveCommissionPercentage(business);
  return splitCollectedAmount(collectedAmount, percentage);
};

const startCollection = async ({
  booking,
  business,
  user,
  amount,
  paymentDetails,
  redirecturl,
  returl,
}) => {
  if (!business) {
    const error = new Error("This booking is not linked to a service provider yet.");
    error.status = 400;
    throw error;
  }
  if (!hasCompletePayoutDetails(business.payoutDetails)) {
    const error = new Error(
      "This service provider has not added valid Mobile Money or bank payout details, so customer payment cannot start."
    );
    error.status = 409;
    throw error;
  }

  const config = getXentripayConfig();
  const customerRef = prefixedCode("PAY", 14);
  const split = buildSplit(amount, business, booking);
  const collection = await initiateCollection({
    email: paymentDetails.email,
    cname: paymentDetails.cname,
    cnumber: paymentDetails.cnumber,
    msisdn: paymentDetails.msisdn,
    amount,
    pmethod: paymentDetails.pmethod,
    customerRef,
    details: paymentDetails.details || `SafarisCon booking ${booking.bookingCode || booking._id}`,
    redirecturl,
    returl,
  });

  if (Number(collection.success) === 0 || Number(collection.retcode || 0) !== 0) {
    const error = new Error(collection.reply || "XentriPay rejected the collection request.");
    error.status = 400;
    error.payload = collection;
    throw error;
  }

  const transaction = await Transaction.create({
    transactionId: prefixedCode("TXN", 14),
    bookingId: booking._id,
    userId: user._id,
    sellerId: business.ownerUserId || null,
    businessId: business._id,
    amount,
    currency: config.currency,
    commissionAmount: split.platformAmount,
    sellerEarnings: split.providerAmount,
    commissionStatus: "pending",
    paymentMethod: mapPaymentMethod(paymentDetails.pmethod),
    senderAccount: paymentDetails.cnumber,
    receiverAccount: config.merchantName,
    paymentReference: customerRef,
    customerRef,
    collectionRef: collection.refid || customerRef,
    collectionTid: collection.tid || "",
    collectionAuthKey: collection.authkey || "",
    collectionStatus: "pending",
    checkoutUrl: collection.url || "",
    platformAmount: split.platformAmount,
    providerAmount: split.providerAmount,
    commissionPercentage: split.commissionPercentage,
    payoutStatus: "none",
    payoutProviderId: business.payoutDetails.providerId,
    payoutAccount: business.payoutDetails.msisdn || business.payoutDetails.accountNumber,
    customerPayment: {
      email: paymentDetails.email,
      name: paymentDetails.cname,
      phone: paymentDetails.cnumber,
      msisdn: paymentDetails.msisdn,
      method: paymentDetails.pmethod,
    },
    gatewayRaw: collection,
    status: "pending",
  });

  return {
    transaction,
    collection,
    split,
    simulated: Boolean(collection.simulated),
  };
};

const refreshCollection = async (transaction) => {
  const reference = collectionReferenceOf(transaction);
  if (!reference) {
    const error = new Error("This transaction has no collection reference to check.");
    error.status = 400;
    throw error;
  }

  const result = await getCollectionStatus(reference);
  const status = normalizeCollectionStatus(result.status);
  transaction.collectionStatus = status.toLowerCase();
  transaction.gatewayRaw = { ...(transaction.gatewayRaw || {}), collectionStatus: result };
  if (status === "FAILED") transaction.status = "failed";
  await transaction.save();
  return { transaction, status, result };
};

const startProviderPayout = async (transaction, business) => {
  const payoutDetails = business?.payoutDetails || {};
  if (!hasCompletePayoutDetails(payoutDetails)) {
    transaction.payoutStatus = "failed";
    transaction.payoutMessage = "Service provider payout details are missing.";
    await transaction.save();
    return transaction;
  }

  const providerAmount = Number(transaction.providerAmount || transaction.sellerEarnings || 0);
  if (providerAmount <= 0) {
    transaction.payoutStatus = "none";
    transaction.payoutMessage = "No provider payout is due after platform commission.";
    await transaction.save();
    return transaction;
  }

  if (transaction.payoutReference && ["pending", "successful"].includes(transaction.payoutStatus)) {
    return transaction;
  }

  const customerReference = prefixedCode("PO", 12);
  const payout = await initiatePayout({
    customerReference,
    telecomProviderId: payoutDetails.providerId,
    msisdn: payoutDetails.msisdn || payoutDetails.accountNumber,
    name: payoutDetails.accountName,
    amount: providerAmount,
  });

  transaction.payoutReference = customerReference;
  transaction.payoutInternalRef = payout.internalRef || "";
  transaction.payoutStatus = normalizePayoutStatus(payout.status);
  transaction.payoutMessage =
    payout.statusMessage ||
    "Payout submitted. The SafarisCon merchant must confirm the XentriPay OTP before funds are released.";
  transaction.payoutProviderId = payoutDetails.providerId;
  transaction.payoutAccount = payoutDetails.msisdn || payoutDetails.accountNumber;
  transaction.verifiedAccountName = payout.validatedAccountName || "";
  transaction.gatewayRaw = { ...(transaction.gatewayRaw || {}), payout };
  if (payout.validatedAccountName && business.payoutDetails) {
    business.payoutDetails.verified = true;
    business.payoutDetails.verifiedAccountName = payout.validatedAccountName;
    business.payoutDetails.verifiedAt = new Date();
    if (typeof business.save === "function") await business.save();
  }
  await transaction.save();
  return transaction;
};

const guessTelecomProviderId = (msisdn) => {
  const digits = String(msisdn || "").replace(/\D/g, "");
  const local = digits.startsWith("250") ? `0${digits.slice(3)}` : digits;
  if (/^07[23]/.test(local)) return "63514";
  return "63510";
};

const startCustomerRefundPayout = async (transaction, amount) => {
  const refundAmount = Number(amount || 0);
  if (refundAmount <= 0) {
    transaction.refundPayoutStatus = "none";
    transaction.refundPayoutMessage = "No customer refund amount is due.";
    await transaction.save();
    return transaction;
  }
  const msisdn = transaction.customerPayment?.msisdn || transaction.customerPayment?.phone || transaction.senderAccount;
  if (!msisdn) {
    transaction.refundPayoutStatus = "failed";
    transaction.refundPayoutMessage = "Customer Mobile Money number is missing, so the refund must be completed from the XentriPay wallet manually.";
    await transaction.save();
    return transaction;
  }
  if (transaction.refundPayoutReference && ["pending", "successful"].includes(transaction.refundPayoutStatus)) {
    return transaction;
  }

  const customerReference = prefixedCode("RFD", 12);
  const payout = await initiatePayout({
    customerReference,
    telecomProviderId: guessTelecomProviderId(msisdn),
    msisdn,
    name: transaction.customerPayment?.name || "SafarisCon customer",
    amount: refundAmount,
  });
  transaction.refundPayoutReference = customerReference;
  transaction.refundPayoutStatus = normalizePayoutStatus(payout.status) === "successful" ? "successful" : "pending";
  transaction.refundPayoutMessage =
    payout.statusMessage ||
    "Customer refund submitted. Confirm the XentriPay merchant OTP to send the remaining money back.";
  transaction.gatewayRaw = { ...(transaction.gatewayRaw || {}), customerRefund: payout };
  await transaction.save();
  return transaction;
};

const refreshPayout = async (transaction) => {
  if (!transaction.payoutReference) return transaction;
  const result = await getPayoutStatus(transaction.payoutReference);
  const status = normalizePayoutStatus(result?.data?.status || result?.status);
  transaction.payoutStatus = status;
  transaction.payoutMessage = result?.message || transaction.payoutMessage;
  transaction.gatewayRaw = { ...(transaction.gatewayRaw || {}), payoutStatus: result };
  await transaction.save();
  return transaction;
};

const findLatestTransaction = (bookingId) =>
  Transaction.findOne({ bookingId }).sort({ createdAt: -1 });

const syncPendingCollections = async ({ limit = 25 } = {}) => {
  const pending = await Transaction.find({
    status: "pending",
    collectionStatus: "pending",
  })
    .sort({ createdAt: 1 })
    .limit(limit);

  const summary = { checked: pending.length, succeeded: 0, failed: 0, stillPending: 0 };
  for (const transaction of pending) {
    try {
      const { status } = await refreshCollection(transaction);
      if (status === "SUCCESS") summary.succeeded += 1;
      else if (status === "FAILED") summary.failed += 1;
      else summary.stillPending += 1;
    } catch (_error) {
      summary.stillPending += 1;
    }
  }
  return summary;
};

module.exports = {
  buildSplit,
  startCollection,
  refreshCollection,
  startProviderPayout,
  startCustomerRefundPayout,
  refreshPayout,
  findLatestTransaction,
  syncPendingCollections,
};
