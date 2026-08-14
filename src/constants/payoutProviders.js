const MOBILE_MONEY_PROVIDERS = [
  { id: "63510", name: "MTN MOBILE MONEY", method: "momo" },
  { id: "63514", name: "AIRTEL RWANDA", method: "momo" },
  { id: "63509", name: "SPENN", method: "momo" },
];

const BANK_PROVIDERS = [
  { id: "040", name: "BANQUE DE KIGALI", method: "bank" },
  { id: "400", name: "BANQUE POPULAIRE DU RWANDA", method: "bank" },
  { id: "192", name: "EQUITY BANK", method: "bank" },
  { id: "100", name: "ECOBANK RWANDA", method: "bank" },
  { id: "115", name: "ACCESS BANK RWANDA", method: "bank" },
  { id: "070", name: "GUARANTY TRUST BANK (RWANDA)", method: "bank" },
  { id: "010", name: "INVESTMENT AND MORTGAGE BANK", method: "bank" },
  { id: "025", name: "NATIONAL COMMERCIAL BANK OF AFRICA", method: "bank" },
  { id: "145", name: "URWEGO OPPORTUNITY BANK", method: "bank" },
  { id: "800", name: "ZIGAMA CREDIT AND SAVINGS SCHEME", method: "bank" },
  { id: "900", name: "BANK OF AFRICA RWANDA", method: "bank" },
  { id: "950", name: "UNGUKA BANK", method: "bank" },
  { id: "951", name: "BANQUE NATIONALE DU RWANDA", method: "bank" },
];

const PAYOUT_PROVIDERS = [...MOBILE_MONEY_PROVIDERS, ...BANK_PROVIDERS];
const PROVIDER_BY_ID = new Map(PAYOUT_PROVIDERS.map((provider) => [provider.id, provider]));

const COLLECTION_METHODS = [
  {
    id: "momo",
    name: "Mobile Money",
    aliases: ["mobile-money", "momo", "mtn", "airtel"],
    description: "Customer confirms a MoMo prompt on their phone. Money is collected into the SafarisCon XentriPay wallet.",
  },
  {
    id: "cc",
    name: "Card",
    aliases: ["cc", "card", "credit-card", "debit-card"],
    description: "Customer is redirected to the card checkout page. Money is collected into the SafarisCon XentriPay wallet.",
  },
];

const PAYOUT_METHODS = [
  {
    id: "momo",
    name: "Mobile Money",
    aliases: ["momo", "mobile-money"],
    description: "Payout to MTN, Airtel, or SPENN after SafarisCon keeps commission from the customer payment.",
  },
  {
    id: "bank",
    name: "Bank transfer",
    aliases: ["bank", "bank-transfer"],
    description: "Payout to a Rwandan bank account after SafarisCon keeps commission. Card is not a payout channel.",
  },
];

const findPayoutProvider = (providerId) => PROVIDER_BY_ID.get(String(providerId || "").trim()) || null;

const normalizePayoutMethod = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["momo", "mobile-money", "mtn", "airtel", "spenn"].includes(normalized)) return "momo";
  if (["bank", "bank-transfer", "bank_transfer"].includes(normalized)) return "bank";
  if (["cc", "card", "credit-card", "debit-card"].includes(normalized)) return "card";
  return normalized;
};

const normalizeCollectionMethod = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["momo", "mobile-money", "mtn", "airtel"].includes(normalized)) return "momo";
  if (["cc", "card", "credit-card", "debit-card"].includes(normalized)) return "cc";
  return normalized;
};

module.exports = {
  MOBILE_MONEY_PROVIDERS,
  BANK_PROVIDERS,
  PAYOUT_PROVIDERS,
  COLLECTION_METHODS,
  PAYOUT_METHODS,
  findPayoutProvider,
  normalizePayoutMethod,
  normalizeCollectionMethod,
};
