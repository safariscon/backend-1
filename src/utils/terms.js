const TERMS_NOT_ACCEPTED = "TERMS_NOT_ACCEPTED";

const TRUTHY = new Set([true, 1, "1", "true", "yes", "on", "accepted", "agree"]);
const FALSY = new Set([false, 0, "0", "false", "no", "off"]);

const normalizeFlag = (value) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (TRUTHY.has(normalized)) return true;
    if (FALSY.has(normalized)) return false;
    return null;
  }
  if (TRUTHY.has(value)) return true;
  if (FALSY.has(value)) return false;
  return null;
};

const firstDefined = (body = {}, keys = []) => {
  for (const key of keys) {
    if (body[key] !== undefined && body[key] !== null && body[key] !== "") {
      return body[key];
    }
  }
  return undefined;
};

const TERMS_KEYS = [
  "acceptedTerms",
  "termsAccepted",
  "acceptTerms",
  "agreeToTerms",
  "accepted",
  "acceptedTermsAndPolicy",
  "acceptedTermsAndPrivacy",
];

const PRIVACY_KEYS = ["acceptedPrivacy", "privacyAccepted", "acceptPrivacy", "agreeToPrivacy"];

const hasAcceptedTerms = (body = {}) => {
  const terms = normalizeFlag(firstDefined(body, TERMS_KEYS));
  const privacy = normalizeFlag(firstDefined(body, PRIVACY_KEYS));

  if (privacy === false) return false;
  if (terms === true) return true;
  if (privacy === true && terms !== false) return true;
  return false;
};

const termsRejectedPayload = (message) => ({
  code: TERMS_NOT_ACCEPTED,
  message:
    message ||
    "You must accept the Terms of use and Privacy policy before you can continue.",
  termsAccepted: false,
});

const applyTermsAcceptance = (user, at = new Date()) => {
  user.termsAccepted = true;
  user.termsAcceptedAt = at;
  return user;
};

const hasUserAcceptedTerms = (user) => Boolean(user?.termsAccepted);

module.exports = {
  TERMS_NOT_ACCEPTED,
  hasAcceptedTerms,
  hasUserAcceptedTerms,
  termsRejectedPayload,
  applyTermsAcceptance,
};
