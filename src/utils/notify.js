const sendProviderOnboardingEmail = async ({
  providerEmail,
  businessName,
  providerName,
}) => {
  // Placeholder email integration.
  console.log(
    `[EMAIL SIMULATION] Sent onboarding email to ${providerEmail} for business "${businessName}" and provider "${providerName}". The provider must complete registration to set a password.`
  );
};

module.exports = { sendProviderOnboardingEmail };
