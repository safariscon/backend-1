const {
  findPayoutProvider,
  normalizeCollectionMethod,
  normalizePayoutMethod,
} = require("../constants/payoutProviders");

const LOCAL_PHONE_REGEX = /^07\d{8}$/;
const BANK_ACCOUNT_REGEX = /^\d{5,20}$/;

const digitsOnly = (value) => String(value || "").replace(/\D/g, "");

const toLocalMsisdn = (value) => {
  const digits = digitsOnly(value);
  if (digits.length === 12 && digits.startsWith("250")) return `0${digits.slice(3)}`;
  if (digits.length === 10 && digits.startsWith("07")) return digits;
  if (digits.length === 9 && digits.startsWith("7")) return `0${digits}`;
  return digits;
};

const toInternationalMsisdn = (value) => {
  const local = toLocalMsisdn(value);
  if (LOCAL_PHONE_REGEX.test(local)) return `250${local.slice(1)}`;
  const digits = digitsOnly(value);
  if (digits.length === 12 && digits.startsWith("250")) return digits;
  return digits;
};

const payoutDetailsSchema = () => ({
  method: { type: String, default: "", trim: true },
  providerId: { type: String, default: "", trim: true },
  providerName: { type: String, default: "", trim: true },
  accountName: { type: String, default: "", trim: true },
  accountNumber: { type: String, default: "", trim: true },
  msisdn: { type: String, default: "", trim: true },
  instructions: { type: String, default: "", trim: true },
  verified: { type: Boolean, default: false },
  verifiedAccountName: { type: String, default: "", trim: true },
  verifiedAt: { type: Date, default: null },
});

const emptyPayoutDetails = () => ({
  method: "",
  providerId: "",
  providerName: "",
  accountName: "",
  accountNumber: "",
  msisdn: "",
  instructions: "",
  verified: false,
  verifiedAccountName: "",
  verifiedAt: null,
});

const hasCompletePayoutDetails = (details = {}) =>
  Boolean(details.method && details.providerId && details.accountName && (details.accountNumber || details.msisdn));

const normalizePayoutDetails = (input = {}, { required = true } = {}) => {
  const raw = input && typeof input === "object" ? input : {};
  const method = normalizePayoutMethod(raw.method || raw.payoutMethod || "");
  const providerId = String(raw.providerId || raw.telecomProviderId || "").trim();
  const accountName = String(raw.accountName || raw.name || "").trim();
  const accountNumber = String(raw.accountNumber || raw.msisdn || raw.phone || "").trim();
  const instructions = String(raw.instructions || "").trim();

  if (!required && !method && !providerId && !accountName && !accountNumber) {
    return { ok: true, value: emptyPayoutDetails() };
  }

  if (method === "card") {
    return {
      ok: false,
      status: 400,
      message: "Card can be used by customers to pay, but service providers receive payouts by Mobile Money or bank transfer only.",
    };
  }
  if (!["momo", "bank"].includes(method)) {
    return {
      ok: false,
      status: 400,
      message: "Payout method must be momo (Mobile Money) or bank.",
    };
  }
  if (!accountName) {
    return { ok: false, status: 400, message: "Payout account name is required." };
  }

  const provider = findPayoutProvider(providerId);
  if (!provider) {
    return {
      ok: false,
      status: 400,
      message: "Choose a valid Mobile Money or Rwandan bank provider ID for payouts.",
    };
  }
  if (provider.method !== method) {
    return {
      ok: false,
      status: 400,
      message: `Provider ${provider.name} does not match payout method ${method}.`,
    };
  }

  if (method === "momo") {
    const local = toLocalMsisdn(accountNumber);
    if (!LOCAL_PHONE_REGEX.test(local)) {
      return {
        ok: false,
        status: 400,
        message: "Mobile Money payout number must be a local 10-digit phone such as 0788302208.",
      };
    }
    return {
      ok: true,
      value: {
        method,
        providerId: provider.id,
        providerName: provider.name,
        accountName,
        accountNumber: local,
        msisdn: local,
        instructions,
        verified: false,
        verifiedAccountName: "",
        verifiedAt: null,
      },
    };
  }

  const bankAccount = digitsOnly(accountNumber);
  if (!BANK_ACCOUNT_REGEX.test(bankAccount)) {
    return {
      ok: false,
      status: 400,
      message: "Bank payout account number must be 5 to 20 digits.",
    };
  }

  return {
    ok: true,
    value: {
      method,
      providerId: provider.id,
      providerName: provider.name,
      accountName,
      accountNumber: bankAccount,
      msisdn: bankAccount,
      instructions,
      verified: false,
      verifiedAccountName: "",
      verifiedAt: null,
    },
  };
};

const normalizeCustomerPaymentDetails = (input = {}, user = {}) => {
  const raw = input && typeof input === "object" ? input : {};
  const pmethod = normalizeCollectionMethod(
    raw.pmethod || raw.paymentMethod || raw.method || "momo"
  );
  const email = String(raw.email || user.email || "").trim().toLowerCase();
  const cname = String(raw.cname || raw.name || user.name || "").trim();
  const cnumber = toLocalMsisdn(raw.cnumber || raw.phone || raw.senderAccount || user.phone || "");
  const msisdn = toInternationalMsisdn(cnumber);
  const details = String(raw.details || "").trim();

  if (!["momo", "cc"].includes(pmethod)) {
    return {
      ok: false,
      status: 400,
      message: "Customer payment method must be momo or cc (card).",
    };
  }
  if (!email || !email.includes("@")) {
    return { ok: false, status: 400, message: "A valid customer email is required to collect payment." };
  }
  if (!cname) {
    return { ok: false, status: 400, message: "Customer full name is required to collect payment." };
  }
  if (!LOCAL_PHONE_REGEX.test(cnumber)) {
    return {
      ok: false,
      status: 400,
      message: "Customer phone must be a local 10-digit number such as 0780371519.",
    };
  }

  return {
    ok: true,
    value: {
      email,
      cname,
      cnumber,
      msisdn,
      pmethod,
      details,
      paymentMethod: pmethod === "cc" ? "card" : "mobile-money",
    },
  };
};

module.exports = {
  LOCAL_PHONE_REGEX,
  digitsOnly,
  toLocalMsisdn,
  toInternationalMsisdn,
  payoutDetailsSchema,
  emptyPayoutDetails,
  hasCompletePayoutDetails,
  normalizePayoutDetails,
  normalizeCustomerPaymentDetails,
};
