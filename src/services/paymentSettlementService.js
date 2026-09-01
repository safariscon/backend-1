const Transaction = require("../models/Transaction");
const Booking = require("../models/Booking");
const Hotel = require("../models/Hotel");
const { prefixedCode } = require("../utils/secureIds");
const {
  hasCompletePayoutDetails,
  parseXentripayRegisteredName,
  resolvePayoutRecipientName,
  normalizePayoutAccountName,
  formatPayoutMsisdnForGateway,
  formatPayoutFailureMessage,
} = require("../utils/payoutDetails");
const { resolveCommissionPercentage, splitCollectedAmount } = require("../utils/commission");
const { notifyProviderPayoutOutcome, payoutBreakdown } = require("./payoutNotificationService");
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
  return splitCollectedAmount(collectedAmount, percentage, booking?.totalPrice);
};

const canReconcileSplit = (transaction, booking) => {
  if (!transaction || transaction.status !== "paid") return false;
  if (booking?.status === "cancelled") return false;
  if (transaction.payoutStatus === "successful") return false;
  if (transaction.payoutStatus === "pending" && transaction.payoutReference) return false;
  return true;
};

const reconcileTransactionSplit = async (transaction, booking, business) => {
  if (!canReconcileSplit(transaction, booking)) return transaction;
  const split = buildSplit(transaction.amount, business, booking);
  const changed =
    Number(transaction.platformAmount) !== split.platformAmount
    || Number(transaction.providerAmount) !== split.providerAmount
    || Number(transaction.commissionPercentage) !== split.commissionPercentage;
  if (!changed) return transaction;
  transaction.platformAmount = split.platformAmount;
  transaction.commissionAmount = split.platformAmount;
  transaction.providerAmount = split.providerAmount;
  transaction.sellerEarnings = split.providerAmount;
  transaction.commissionPercentage = split.commissionPercentage;
  if (typeof transaction.save === "function") await transaction.save();
  return transaction;
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
  console.info(
    `XentriPay collection ${collection.simulated ? "SIMULATED" : "LIVE"} ref=${customerRef} amount=${amount} msisdn=${paymentDetails.msisdn}`
  );

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
    checkoutUrl: String(collection.url || "").trim(),
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

const loadBusinessForPayout = async (business) => {
  const businessId = business?._id || business;
  if (!businessId) return null;
  return Hotel.findById(businessId).select("name payoutDetails ownerUserId ownerEmail");
};

const applyGatewayRegisteredName = async (businessId, registeredName) => {
  if (!businessId || !registeredName) return null;
  return Hotel.findByIdAndUpdate(
    businessId,
    {
      $set: {
        "payoutDetails.accountName": registeredName,
        "payoutDetails.verified": true,
        "payoutDetails.verifiedAccountName": registeredName,
        "payoutDetails.verifiedAt": new Date(),
      },
    },
    { returnDocument: "after" }
  ).select("name payoutDetails");
};

const submitProviderPayoutAttempt = async ({ payoutDetails, providerAmount, recipientName }) => {
  const customerReference = prefixedCode("PO", 12);
  const msisdn = payoutDetails.msisdn || payoutDetails.accountNumber;
  const payout = await initiatePayout({
    customerReference,
    telecomProviderId: payoutDetails.providerId,
    msisdn,
    name: recipientName,
    amount: providerAmount,
  });
  return {
    payout,
    customerReference,
    recipientName,
    msisdn: formatPayoutMsisdnForGateway(msisdn),
  };
};

const startProviderPayout = async (transaction, business, booking) => {
  if (booking) {
    await reconcileTransactionSplit(transaction, booking, business);
  }

  const businessDoc = (await loadBusinessForPayout(business)) || business;
  const payoutDetails = businessDoc?.payoutDetails || {};
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

  if (transaction.payoutStatus === "failed") {
    transaction.payoutReference = "";
    transaction.payoutInternalRef = "";
  }

  const businessId = businessDoc?._id || businessDoc;
  let recipientName = resolvePayoutRecipientName(payoutDetails);
  const attempts = [];

  const runAttempt = async (label) => {
    try {
      const result = await submitProviderPayoutAttempt({
        payoutDetails,
        providerAmount,
        recipientName,
      });
      attempts.push({ label, ok: true, recipientName: result.recipientName, msisdn: result.msisdn });
      return { ok: true, ...result };
    } catch (error) {
      const registeredName = parseXentripayRegisteredName(error.message);
      attempts.push({
        label,
        ok: false,
        recipientName,
        msisdn: formatPayoutMsisdnForGateway(payoutDetails.msisdn || payoutDetails.accountNumber),
        message: error.message,
        registeredName,
      });
      return { ok: false, error, registeredName };
    }
  };

  let attempt = await runAttempt("initial");
  if (!attempt.ok && attempt.registeredName) {
    await applyGatewayRegisteredName(businessId, attempt.registeredName);
    recipientName = attempt.registeredName;
    payoutDetails.accountName = attempt.registeredName;
    payoutDetails.verifiedAccountName = attempt.registeredName;
    payoutDetails.verified = true;
    attempt = await runAttempt("gateway-name-retry");
  }

  transaction.gatewayRaw = {
    ...(transaction.gatewayRaw || {}),
    payoutAttempts: attempts,
  };

  if (!attempt.ok) {
    transaction.payoutStatus = "failed";
    transaction.payoutMessage = formatPayoutFailureMessage(attempt.error, {
      recipientName,
      msisdn: formatPayoutMsisdnForGateway(payoutDetails.msisdn || payoutDetails.accountNumber),
    });
    transaction.gatewayRaw = {
      ...transaction.gatewayRaw,
      payoutError: attempt.error?.payload || { message: attempt.error?.message },
    };
    await transaction.save();
    return transaction;
  }

  const { payout, customerReference } = attempt;
  transaction.payoutReference = customerReference;
  transaction.payoutInternalRef = payout.internalRef || "";
  transaction.payoutStatus = normalizePayoutStatus(payout.status);
  transaction.payoutMessage =
    payout.statusMessage ||
    "Payout submitted. The SafarisCon merchant must confirm the XentriPay OTP before funds are released.";
  transaction.payoutProviderId = payoutDetails.providerId;
  transaction.payoutAccount = payoutDetails.msisdn || payoutDetails.accountNumber;
  transaction.verifiedAccountName = payout.validatedAccountName || recipientName || "";
  transaction.gatewayRaw = { ...(transaction.gatewayRaw || {}), payout };
  if ((payout.validatedAccountName || recipientName) && businessDoc?.payoutDetails && businessId) {
    const validatedName = normalizePayoutAccountName(payout.validatedAccountName || recipientName);
    await applyGatewayRegisteredName(businessId, validatedName);
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

const hasAcceptedGatewayCollection = (transaction) => {
  if (!transaction || transaction.status !== "pending") return false;
  if (transaction.gatewayRaw?.simulated) return false;
  const success = Number(transaction.gatewayRaw?.success);
  const retcode = Number(transaction.gatewayRaw?.retcode);
  return Boolean(transaction.collectionTid) && success === 1 && retcode === 0;
};

const COLLECTION_REUSE_WINDOW_MS = 90 * 1000;

const isReusablePendingCollection = (transaction) => {
  if (!hasAcceptedGatewayCollection(transaction)) return false;
  const created = new Date(transaction.createdAt).getTime();
  return Number.isFinite(created) && Date.now() - created < COLLECTION_REUSE_WINDOW_MS;
};

const abandonStaleCollection = async (transaction, reason) => {
  if (!transaction) return null;
  transaction.status = "failed";
  transaction.collectionStatus = "failed";
  transaction.gatewayRaw = {
    ...(transaction.gatewayRaw || {}),
    abandonedAt: new Date().toISOString(),
    abandonReason: reason,
  };
  await transaction.save();
  return transaction;
};

const syncPendingCollections = async ({ limit = 25 } = {}) => {
  const pending = await Transaction.find({
    status: "pending",
    collectionStatus: "pending",
  })
    .sort({ createdAt: 1 })
    .limit(limit);

  const summary = { checked: pending.length, succeeded: 0, failed: 0, stillPending: 0 };
  for (const transaction of pending) {
    if (transaction.gatewayRaw?.simulated || !hasAcceptedGatewayCollection(transaction)) {
      summary.stillPending += 1;
      continue;
    }
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

const DEPOSIT_PAID_STATUSES = ["paid", "deposit_paid", "deposit-paid"];

const processEligibleProviderPayouts = async ({ now = new Date(), limit = 50 } = {}) => {
  const summary = { checked: 0, paidOut: 0, skipped: 0, failed: 0, errors: [] };
  const bookings = await Booking.find({
    paymentStatus: { $in: DEPOSIT_PAID_STATUSES },
    status: { $nin: ["cancelled", "completed", "rejected"] },
    "cancellation.refundableUntil": { $lte: now },
  }).limit(limit);

  for (const booking of bookings) {
    summary.checked += 1;
    const transaction = await findLatestTransaction(booking._id);
    if (!transaction || transaction.status !== "paid") {
      summary.skipped += 1;
      continue;
    }
    if (!["held", "none", "failed"].includes(transaction.payoutStatus)) {
      summary.skipped += 1;
      continue;
    }
    const businessId = booking.hotelId || booking.preferredHotelId;
    const business = businessId ? await Hotel.findById(businessId) : null;
    try {
      const updated = await startProviderPayout(transaction, business, booking);
      const outcome = updated.payoutStatus === "failed" ? "failed" : "submitted";
      await notifyProviderPayoutOutcome({ transaction: updated, business, outcome });
      if (updated.payoutStatus === "failed") summary.failed += 1;
      else summary.paidOut += 1;
    } catch (error) {
      summary.failed += 1;
      summary.errors.push(error.message);
    }
  }
  return summary;
};

const processHeldProviderPayouts = async ({ limit = 100 } = {}) => {
  const summary = { checked: 0, paidOut: 0, skipped: 0, failed: 0, errors: [] };
  const transactions = await Transaction.find({
    status: "paid",
    payoutStatus: { $in: ["held", "none", "failed"] },
  })
    .sort({ createdAt: 1 })
    .limit(limit);

  for (const transaction of transactions) {
    summary.checked += 1;
    const booking = transaction.bookingId
      ? await Booking.findById(transaction.bookingId)
      : null;
    if (booking?.status === "cancelled") {
      summary.skipped += 1;
      continue;
    }
    const businessId =
      transaction.businessId
      || booking?.hotelId
      || booking?.preferredHotelId;
    const business = businessId ? await Hotel.findById(businessId) : null;
    try {
      const updated = await startProviderPayout(transaction, business, booking);
      const outcome = updated.payoutStatus === "failed" ? "failed" : "submitted";
      await notifyProviderPayoutOutcome({ transaction: updated, business, outcome });
      if (updated.payoutStatus === "failed") summary.failed += 1;
      else summary.paidOut += 1;
    } catch (error) {
      summary.failed += 1;
      summary.errors.push(error.message);
    }
  }
  return summary;
};

const syncPendingPayouts = async ({ limit = 25 } = {}) => {
  const pending = await Transaction.find({
    status: "paid",
    payoutStatus: "pending",
    payoutReference: { $exists: true, $ne: "" },
  })
    .sort({ updatedAt: 1 })
    .limit(limit);

  const summary = { checked: pending.length, successful: 0, failed: 0, stillPending: 0 };
  for (const transaction of pending) {
    try {
      const previous = transaction.payoutStatus;
      const updated = await refreshPayout(transaction);
      const business = updated.businessId ? await Hotel.findById(updated.businessId) : null;
      if (updated.payoutStatus === "successful" && previous !== "successful") {
        summary.successful += 1;
        await notifyProviderPayoutOutcome({ transaction: updated, business, outcome: "successful" });
      } else if (updated.payoutStatus === "failed" && previous !== "failed") {
        summary.failed += 1;
        await notifyProviderPayoutOutcome({ transaction: updated, business, outcome: "failed" });
      } else {
        summary.stillPending += 1;
      }
    } catch (_error) {
      summary.stillPending += 1;
    }
  }
  return summary;
};

const triggerProviderPayoutForTransaction = async (transaction, { force = false, now = new Date() } = {}) => {
  if (!transaction || transaction.status !== "paid") {
    const error = new Error("Only paid bookings can trigger a provider payout.");
    error.status = 400;
    throw error;
  }
  if (!["held", "none", "failed"].includes(transaction.payoutStatus)) {
    const error = new Error(`Payout is already ${transaction.payoutStatus}.`);
    error.status = 409;
    throw error;
  }

  let booking = transaction.bookingId;
  if (booking && typeof booking === "object" && !booking.cancellation) {
    booking = await Booking.findById(booking._id || booking);
  } else if (!booking && transaction.bookingId) {
    booking = await Booking.findById(transaction.bookingId);
  }

  if (
    !force
    && booking?.cancellation?.refundableUntil
    && new Date(booking.cancellation.refundableUntil) > now
  ) {
    const error = new Error(
      "Free cancellation is still open. Provider payout is not due until the cancellation window closes."
    );
    error.status = 409;
    error.refundableUntil = booking.cancellation.refundableUntil;
    throw error;
  }

  let business = transaction.businessId;
  if (!business?.payoutDetails) {
    const businessId =
      transaction.businessId?._id
      || transaction.businessId
      || booking?.hotelId
      || booking?.preferredHotelId;
    business = businessId ? await Hotel.findById(businessId) : null;
  }

  const updated = await startProviderPayout(transaction, business, booking);
  const outcome = updated.payoutStatus === "failed" ? "failed" : "submitted";
  await notifyProviderPayoutOutcome({ transaction: updated, business, outcome });
  return { transaction: updated, breakdown: payoutBreakdown(updated) };
};

module.exports = {
  buildSplit,
  startCollection,
  refreshCollection,
  startProviderPayout,
  startCustomerRefundPayout,
  refreshPayout,
  findLatestTransaction,
  hasAcceptedGatewayCollection,
  isReusablePendingCollection,
  abandonStaleCollection,
  syncPendingCollections,
  processEligibleProviderPayouts,
  processHeldProviderPayouts,
  syncPendingPayouts,
  reconcileTransactionSplit,
  triggerProviderPayoutForTransaction,
  payoutBreakdown,
};
