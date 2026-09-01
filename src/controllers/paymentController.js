const Transaction = require("../models/Transaction");
const Hotel = require("../models/Hotel");
const {
  BANK_PROVIDERS,
  COLLECTION_METHODS,
  MOBILE_MONEY_PROVIDERS,
  PAYOUT_METHODS,
} = require("../constants/payoutProviders");
const { normalizePayoutDetails, resolvePayoutRecipientName, formatPayoutMsisdnForGateway, normalizePayoutAccountName, hasCompletePayoutDetails } = require("../utils/payoutDetails");
const { getXentripayConfig } = require("../services/xentripayService");
const { refreshPayout, triggerProviderPayoutForTransaction, processEligibleProviderPayouts, processHeldProviderPayouts, payoutBreakdown, reconcileTransactionSplit } = require("../services/paymentSettlementService");
const { notifyProviderPayoutOutcome } = require("../services/payoutNotificationService");
const { getPlatformCommissionPercentage } = require("../utils/commission");

const sumField = (rows, field) => rows.reduce((total, row) => total + Number(row[field] || 0), 0);

const serializePayoutTransaction = (transaction) => {
  const tx = typeof transaction.toObject === "function" ? transaction.toObject() : transaction;
  const booking = tx.bookingId && typeof tx.bookingId === "object" ? tx.bookingId : {};
  const business = tx.businessId && typeof tx.businessId === "object" ? tx.businessId : {};
  const payoutDetails = business.payoutDetails || {};
  return {
    id: String(tx._id || ""),
    transactionId: tx.transactionId || "",
    bookingCode: booking.bookingCode || "",
    bookingTotal: Number(booking.totalPrice || 0),
    businessId: String(business._id || tx.businessId || ""),
    businessName: business.name || "",
    payoutDetails: {
      accountName: payoutDetails.accountName || "",
      msisdn: payoutDetails.msisdn || payoutDetails.accountNumber || "",
      providerName: payoutDetails.providerName || "",
      verified: Boolean(payoutDetails.verified),
      verifiedAccountName: payoutDetails.verifiedAccountName || "",
    },
    amount: Number(tx.amount || 0),
    providerAmount: Number(tx.providerAmount || tx.sellerEarnings || 0),
    platformAmount: Number(tx.platformAmount || tx.commissionAmount || 0),
    payoutStatus: tx.payoutStatus || "",
    payoutMessage: tx.payoutMessage || "",
    status: tx.status || "",
  };
};

const sellerBusinessFilter = (user) => ({
  $or: [
    { ownerUserId: user._id },
    { ownerEmail: user.email },
    ...(user.hotelId ? [{ _id: user.hotelId }] : []),
  ],
});

const resolveSellerBusinesses = async (user) =>
  Hotel.find(sellerBusinessFilter(user)).select("name payoutDetails ownerUserId").sort({ updatedAt: -1 });

const resolvePrimarySellerBusiness = async (user) => {
  if (user.hotelId) {
    const linked = await Hotel.findById(user.hotelId).select("name payoutDetails");
    if (linked) return linked;
  }
  const businesses = await resolveSellerBusinesses(user);
  return businesses[0] || null;
};

const payoutDetailsDiffer = (left = {}, right = {}) =>
  normalizePayoutAccountName(left.accountName) !== normalizePayoutAccountName(right.accountName)
  || String(left.msisdn || left.accountNumber || "").trim() !== String(right.msisdn || right.accountNumber || "").trim()
  || String(left.providerId || "").trim() !== String(right.providerId || "").trim();

const syncPayoutDetailsToOwnedBusinesses = async (user, payoutDetails) => {
  const businesses = await resolveSellerBusinesses(user);
  if (!businesses.length) return { businesses: [], primary: null };
  await Hotel.updateMany(
    { _id: { $in: businesses.map((row) => row._id) } },
    { $set: { payoutDetails } }
  );
  if (!user.hotelId) user.hotelId = businesses[0]._id;
  return { businesses, primary: businesses[0] };
};

const listPaymentCatalog = (_req, res) => {
  const config = getXentripayConfig();
  return res.json({
    currency: config.currency,
    minAmount: config.minAmount,
    configured: config.configured,
    environment: config.env,
    platformCommissionPercentage: getPlatformCommissionPercentage(),
    collectionMethods: COLLECTION_METHODS,
    payoutMethods: PAYOUT_METHODS,
    mobileMoneyProviders: MOBILE_MONEY_PROVIDERS,
    bankProviders: BANK_PROVIDERS,
    notes: {
      collections:
        "Customers pay SafarisCon through XentriPay. Card and Mobile Money are supported for collections.",
      payouts:
        "Customer pays 100% into the SafarisCon XentriPay wallet. Money stays there until the cancellation window closes. Then SafarisCon keeps commission and pays the provider. If the customer cancels in time, they lose the agreed penalty percent; that fee is split at half the usual commission rate.",
    },
  });
};

const getMyPayoutDetails = async (req, res) => {
  try {
    let business = await resolvePrimarySellerBusiness(req.user);
    const userPayout = req.user.payoutDetails;

    if (
      hasCompletePayoutDetails(userPayout)
      && business
      && payoutDetailsDiffer(userPayout, business.payoutDetails)
    ) {
      await syncPayoutDetailsToOwnedBusinesses(req.user, userPayout);
      await req.user.save();
      business = await Hotel.findById(business._id).select("name payoutDetails");
    }

    const payoutDetails =
      (business?.payoutDetails && hasCompletePayoutDetails(business.payoutDetails)
        ? business.payoutDetails
        : null)
      || (hasCompletePayoutDetails(userPayout) ? userPayout : null)
      || business?.payoutDetails
      || userPayout
      || null;

    return res.json({
      payoutDetails,
      businessId: business?._id || null,
      businessName: business?.name || "",
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load payout details.", error: error.message });
  }
};

const updateMyPayoutDetails = async (req, res) => {
  try {
    const result = normalizePayoutDetails(req.body.payoutDetails || req.body);
    if (!result.ok) return res.status(result.status).json({ message: result.message });

    req.user.payoutDetails = result.value;
    const { primary: business } = await syncPayoutDetailsToOwnedBusinesses(req.user, result.value);
    await req.user.save();

    return res.json({
      message: business
        ? "Payout details saved on your service listing(s). After each customer payment, SafarisCon keeps commission and sends the rest here."
        : "Payout details saved on your account. Link a service listing so payouts can be sent after bookings are paid.",
      payoutDetails: result.value,
      businessId: business?._id || req.user.hotelId || null,
      businessName: business?.name || "",
      gatewayPreview: {
        recipientName: resolvePayoutRecipientName(result.value),
        msisdn: formatPayoutMsisdnForGateway(result.value.msisdn || result.value.accountNumber),
        localMsisdn: result.value.msisdn || result.value.accountNumber,
        providerName: result.value.providerName,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update payout details.", error: error.message });
  }
};

const previewMyPayoutDetails = async (req, res) => {
  try {
    const result = normalizePayoutDetails(req.body.payoutDetails || req.body);
    if (!result.ok) return res.status(result.status).json({ message: result.message });

    const business = await resolvePrimarySellerBusiness(req.user);
    const stored = business?.payoutDetails || req.user.payoutDetails || {};
    const recipientName = resolvePayoutRecipientName(result.value);

    return res.json({
      message:
        "XentriPay checks that the account name matches the MoMo wallet registered to this number. Names must match exactly — extra spaces or different spelling will fail.",
      preview: {
        recipientName,
        msisdn: formatPayoutMsisdnForGateway(result.value.msisdn || result.value.accountNumber),
        localMsisdn: result.value.msisdn || result.value.accountNumber,
        providerId: result.value.providerId,
        providerName: result.value.providerName,
      },
      stored: {
        verified: Boolean(stored.verified),
        verifiedAccountName: stored.verifiedAccountName || "",
        accountName: stored.accountName || "",
      },
      nameMatchesVerified:
        !stored.verifiedAccountName
        || normalizePayoutAccountName(stored.verifiedAccountName) === recipientName,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to preview payout details.", error: error.message });
  }
};

const getSellerFinance = async (req, res) => {
  try {
    const businesses = await Hotel.find(sellerBusinessFilter(req.user)).select("_id");
    const businessIds = businesses.map((row) => row._id);
    const transactions = await Transaction.find({
      $or: [{ sellerId: req.user._id }, { businessId: { $in: businessIds } }],
    })
      .populate("bookingId", "_id bookingCode status paymentStatus totalPrice commissionPercentage")
      .populate("businessId", "commissionPercentage payoutDetails")
      .sort({ createdAt: -1 })
      .limit(100);

    for (const transaction of transactions) {
      await reconcileTransactionSplit(transaction, transaction.bookingId, transaction.businessId);
    }

    const paid = transactions.filter((row) => row.status === "paid");
    return res.json({
      summary: {
        grossCollected: sumField(paid, "amount"),
        commission: sumField(paid, "platformAmount") || sumField(paid, "commissionAmount"),
        providerEarnings: sumField(paid, "providerAmount") || sumField(paid, "sellerEarnings"),
        pendingPayout: paid
          .filter((row) => ["none", "pending", "held"].includes(row.payoutStatus))
          .reduce((total, row) => total + Number(row.providerAmount || row.sellerEarnings || 0), 0),
        paidOut: paid
          .filter((row) => row.payoutStatus === "successful")
          .reduce((total, row) => total + Number(row.providerAmount || row.sellerEarnings || 0), 0),
        failedPayout: paid
          .filter((row) => row.payoutStatus === "failed")
          .reduce((total, row) => total + Number(row.providerAmount || row.sellerEarnings || 0), 0),
      },
      transactions: transactions.map((row) => {
        const plain = typeof row.toObject === "function" ? row.toObject() : row;
        return {
          ...plain,
          payoutMessage: plain.payoutStatus === "failed" ? plain.payoutMessage : "",
        };
      }),
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load provider finance.", error: error.message });
  }
};

const getAdminFinance = async (_req, res) => {
  try {
    const [paid, payouts] = await Promise.all([
      Transaction.aggregate([
        { $match: { status: "paid" } },
        {
          $group: {
            _id: null,
            gross: { $sum: "$amount" },
            commission: { $sum: "$platformAmount" },
            provider: { $sum: "$providerAmount" },
            count: { $sum: 1 },
          },
        },
      ]),
      Transaction.aggregate([
        { $match: { status: "paid" } },
        {
          $group: {
            _id: "$payoutStatus",
            amount: { $sum: "$providerAmount" },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);
    const totals = paid[0] || { gross: 0, commission: 0, provider: 0, count: 0 };
    const byStatus = Object.fromEntries(payouts.map((row) => [row._id || "none", row]));
    return res.json({
      message: "SafarisCon collects customer payments, retains commission, and pays providers from the merchant wallet.",
      summary: {
        grossBookingPayments: totals.gross,
        platformRevenue: totals.commission,
        providerPayables: totals.provider,
        paidBookings: totals.count,
        pendingPayouts: byStatus.pending?.amount || 0,
        successfulPayouts: byStatus.successful?.amount || 0,
        failedPayouts: byStatus.failed?.amount || 0,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load platform finance.", error: error.message });
  }
};

const listPayouts = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 25)));
    const skip = (page - 1) * limit;
    const filter = {};
    if (req.query.payoutStatus) filter.payoutStatus = String(req.query.payoutStatus);
    if (req.query.status) filter.status = String(req.query.status);

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .populate("bookingId", "_id bookingCode status paymentStatus totalPrice commissionPercentage hotelId preferredHotelId")
        .populate("businessId", "name type payoutDetails commissionPercentage")
        .populate("sellerId", "name email sellerId")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Transaction.countDocuments(filter),
    ]);

    const payouts = [];
    for (const transaction of transactions) {
      const booking = transaction.bookingId;
      const business = transaction.businessId;
      await reconcileTransactionSplit(transaction, booking, business);
      payouts.push(serializePayoutTransaction(transaction));
    }

    return res.json({
      page,
      limit,
      total,
      payouts,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to list payouts.", error: error.message });
  }
};

const syncPayout = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.transactionId)
      .populate("businessId", "name ownerEmail ownerUserId payoutDetails");
    if (!transaction) return res.status(404).json({ message: "Transaction not found." });
    const previousStatus = transaction.payoutStatus;
    const updated = await refreshPayout(transaction);
    const business = updated.businessId || (updated.businessId?._id ? updated.businessId : null);
    if (updated.payoutStatus === "successful" && previousStatus !== "successful") {
      await notifyProviderPayoutOutcome({ transaction: updated, business, outcome: "successful" });
    } else if (updated.payoutStatus === "failed" && previousStatus !== "failed") {
      await notifyProviderPayoutOutcome({ transaction: updated, business, outcome: "failed" });
    }
    return res.json({
      message: "Payout status refreshed from XentriPay.",
      transaction: serializePayoutTransaction(updated),
      breakdown: payoutBreakdown(updated),
    });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Failed to refresh payout status." });
  }
};

const triggerPayout = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.transactionId)
      .populate("bookingId", "bookingCode totalPrice paymentStatus")
      .populate("businessId", "name ownerEmail ownerUserId payoutDetails");
    if (!transaction) return res.status(404).json({ message: "Transaction not found." });
    const force = req.body?.force !== false;
    const { transaction: updated, breakdown } = await triggerProviderPayoutForTransaction(transaction, { force });
    const message = updated.payoutStatus === "failed"
      ? updated.payoutMessage || "Provider payout failed."
      : force
        ? "Provider payout submitted to XentriPay (admin override — cancellation window ignored). Confirm the merchant OTP, then sync status."
        : "Provider payout submitted to XentriPay. Confirm the merchant OTP, then sync status.";
    return res.json({ message, transaction: serializePayoutTransaction(updated), breakdown });
  } catch (error) {
    return res.status(error.status || 500).json({
      message: error.message || "Failed to trigger provider payout.",
      refundableUntil: error.refundableUntil,
    });
  }
};

const triggerAllEligiblePayouts = async (req, res) => {
  try {
    const force = req.body?.force !== false;
    const summary = force
      ? await processHeldProviderPayouts({ limit: 100 })
      : await processEligibleProviderPayouts({ limit: 100 });
    const message = force
      ? `Submitted ${summary.paidOut} provider payout(s) from held balances (admin override). ${summary.failed} failed, ${summary.skipped} skipped. Confirm one merchant OTP batch in XentriPay, then sync each row or wait for the webhook/cron.`
      : `Processed ${summary.checked} paid bookings. ${summary.paidOut} payout(s) submitted, ${summary.failed} failed, ${summary.skipped} skipped.`;
    return res.json({ message, summary });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Failed to process eligible payouts." });
  }
};

const handleXentripayWebhook = async (req, res) => {
  try {
    const secret = String(process.env.XENTRIPAY_WEBHOOK_SECRET || "").trim();
    if (secret) {
      const provided =
        req.headers["x-xentripay-key"]
        || req.headers["x-webhook-secret"]
        || req.headers["authorization"]
        || req.query.secret;
      const token = String(provided || "").replace(/^Bearer\s+/i, "").trim();
      if (token !== secret) {
        return res.status(401).json({ message: "Unauthorized webhook." });
      }
    }

    const payload = req.body || {};
    const customerRef =
      payload.customerRef
      || payload.customerReference
      || payload.refid
      || payload.data?.customerRef
      || payload.data?.customerReference;

    if (!customerRef) {
      return res.status(400).json({ message: "Webhook payload is missing a customer reference." });
    }

    const transaction = await Transaction.findOne({
      $or: [
        { payoutReference: customerRef },
        { collectionRef: customerRef },
        { customerRef },
        { paymentReference: customerRef },
      ],
    });

    if (!transaction) {
      return res.status(404).json({ message: "No transaction matched this webhook reference.", customerRef });
    }

    if (transaction.payoutReference === customerRef) {
      const previous = transaction.payoutStatus;
      const updated = await refreshPayout(transaction);
      const business = updated.businessId ? await Hotel.findById(updated.businessId) : null;
      if (updated.payoutStatus === "successful" && previous !== "successful") {
        await notifyProviderPayoutOutcome({ transaction: updated, business, outcome: "successful" });
      } else if (updated.payoutStatus === "failed" && previous !== "failed") {
        await notifyProviderPayoutOutcome({ transaction: updated, business, outcome: "failed" });
      }
      return res.json({ received: true, type: "payout", status: updated.payoutStatus });
    }

    const { status } = await refreshCollection(transaction);
    return res.json({ received: true, type: "collection", status });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Webhook processing failed." });
  }
};

module.exports = {
  listPaymentCatalog,
  getMyPayoutDetails,
  updateMyPayoutDetails,
  previewMyPayoutDetails,
  getSellerFinance,
  getAdminFinance,
  listPayouts,
  syncPayout,
  triggerPayout,
  triggerAllEligiblePayouts,
  handleXentripayWebhook,
};
