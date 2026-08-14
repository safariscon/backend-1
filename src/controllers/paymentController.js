const Transaction = require("../models/Transaction");
const Hotel = require("../models/Hotel");
const {
  BANK_PROVIDERS,
  COLLECTION_METHODS,
  MOBILE_MONEY_PROVIDERS,
  PAYOUT_METHODS,
} = require("../constants/payoutProviders");
const { normalizePayoutDetails } = require("../utils/payoutDetails");
const { getXentripayConfig } = require("../services/xentripayService");
const { refreshPayout } = require("../services/paymentSettlementService");
const { getPlatformCommissionPercentage } = require("../utils/commission");

const sumField = (rows, field) => rows.reduce((total, row) => total + Number(row[field] || 0), 0);

const sellerBusinessFilter = (user) => ({
  $or: [
    { ownerUserId: user._id },
    { ownerEmail: user.email },
    ...(user.hotelId ? [{ _id: user.hotelId }] : []),
  ],
});

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
    const business = req.user.hotelId ? await Hotel.findById(req.user.hotelId).select("name payoutDetails") : null;
    return res.json({
      payoutDetails: business?.payoutDetails || req.user.payoutDetails || null,
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
    await req.user.save();

    let business = null;
    if (req.user.hotelId) {
      business = await Hotel.findByIdAndUpdate(
        req.user.hotelId,
        { $set: { payoutDetails: result.value } },
        { returnDocument: "after" }
      );
    }

    return res.json({
      message: "Payout details saved. After each customer payment, SafarisCon keeps commission and sends the rest here.",
      payoutDetails: result.value,
      businessId: business?._id || req.user.hotelId || null,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update payout details.", error: error.message });
  }
};

const getSellerFinance = async (req, res) => {
  try {
    const businesses = await Hotel.find(sellerBusinessFilter(req.user)).select("_id");
    const businessIds = businesses.map((row) => row._id);
    const transactions = await Transaction.find({
      $or: [{ sellerId: req.user._id }, { businessId: { $in: businessIds } }],
    })
      .populate("bookingId", "_id bookingCode status paymentStatus totalPrice")
      .sort({ createdAt: -1 })
      .limit(100);

    const paid = transactions.filter((row) => row.status === "paid");
    return res.json({
      message: "Customer payments land in SafarisCon and stay in the wallet until the cancellation window closes. Then your share is paid out. If the customer cancels in time, you receive most of the cancellation fee.",
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
      transactions,
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
        .populate("bookingId", "_id bookingCode status paymentStatus totalPrice")
        .populate("businessId", "name type payoutDetails")
        .populate("sellerId", "name email sellerId")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Transaction.countDocuments(filter),
    ]);

    return res.json({
      page,
      limit,
      total,
      payouts: transactions,
      merchantOtpNote:
        "XentriPay holds payouts as PENDING until the authorized SafarisCon merchant confirms the OTP sent to the merchant email/phone.",
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to list payouts.", error: error.message });
  }
};

const syncPayout = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.transactionId);
    if (!transaction) return res.status(404).json({ message: "Transaction not found." });
    const updated = await refreshPayout(transaction);
    return res.json({
      message: "Payout status refreshed from XentriPay.",
      transaction: updated,
    });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Failed to refresh payout status." });
  }
};

module.exports = {
  listPaymentCatalog,
  getMyPayoutDetails,
  updateMyPayoutDetails,
  getSellerFinance,
  getAdminFinance,
  listPayouts,
  syncPayout,
};
