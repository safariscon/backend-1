const publicFrontendUrl = () =>
  String(process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || "https://safariscon.eserveconn.com").replace(/\/+$/, "");

const PROVIDER_REGISTER_PATH = "/provider-register";

const normalizeSellerId = (value) => String(value || "").toUpperCase().trim();

const buildProviderInviteUrl = ({ sellerId } = {}) => {
  const id = encodeURIComponent(normalizeSellerId(sellerId));
  return `${publicFrontendUrl()}${PROVIDER_REGISTER_PATH}?sellerId=${id}`;
};

const buildOnboardingPreview = (user) => {
  const sellerId = user.sellerId;
  const registrationUrl = buildProviderInviteUrl({ sellerId });
  return {
    sellerId,
    providerName: user.name,
    providerEmail: user.email,
    serviceProviderName: user.name,
    serviceProviderEmail: user.email,
    mustSetPassword: true,
    registrationPath: PROVIDER_REGISTER_PATH,
    registrationUrl,
    autocomplete: {
      providerName: user.name,
      providerEmail: user.email,
      sellerId,
    },
    fields: {
      providerName: { value: user.name, readOnly: true },
      providerEmail: { value: user.email, readOnly: true },
      sellerId: { value: sellerId, required: true, readOnly: false },
      newPassword: { required: true, minLength: 8 },
    },
    message:
      "Name and email are already set by SafarisCon. Enter your seller ID and a new password to finish registration.",
  };
};

module.exports = {
  publicFrontendUrl,
  PROVIDER_REGISTER_PATH,
  normalizeSellerId,
  buildProviderInviteUrl,
  buildOnboardingPreview,
};
