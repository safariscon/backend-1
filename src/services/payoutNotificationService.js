const User = require("../models/User");
const { sendProviderPayoutEmail, sendProviderPayoutFailedEmail, sendProviderPayoutSuccessEmail } = require("../utils/notify");

const resolveProviderContact = async (business) => {
  if (!business) return null;
  if (business.ownerUserId) {
    const user = await User.findById(business.ownerUserId).select("email name language");
    if (user?.email) return user;
  }
  if (business.ownerEmail) {
    return { email: business.ownerEmail, name: business.name || business.ownerEmail };
  }
  return null;
};

const payoutBreakdown = (transaction) => ({
  customerPaid: Number(transaction.amount || 0),
  platformCommission: Number(transaction.platformAmount || transaction.commissionAmount || 0),
  providerShare: Number(transaction.providerAmount || transaction.sellerEarnings || 0),
  commissionPercentage: Number(transaction.commissionPercentage || 0),
});

const notifyProviderPayoutOutcome = async ({ transaction, business, outcome = "submitted" }) => {
  const contact = await resolveProviderContact(business);
  if (!contact?.email) return { notified: false, reason: "no_provider_email" };

  const payload = {
    serviceProviderEmail: contact.email,
    serviceProviderName: contact.name,
    businessName: business?.name,
    amount: Number(transaction.providerAmount || transaction.sellerEarnings || 0),
    payoutReference: transaction.payoutReference,
    reason: transaction.payoutMessage,
    language: contact.language,
    breakdown: payoutBreakdown(transaction),
  };

  if (outcome === "failed") {
    await sendProviderPayoutFailedEmail(payload);
  } else if (outcome === "successful") {
    await sendProviderPayoutSuccessEmail(payload);
  } else {
    await sendProviderPayoutEmail(payload);
  }
  return { notified: true, email: contact.email };
};

module.exports = {
  resolveProviderContact,
  payoutBreakdown,
  notifyProviderPayoutOutcome,
};
