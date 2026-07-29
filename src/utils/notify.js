const nodemailer = require("nodemailer");

const mailerBoolean = (value, fallback = true) => {
  if (value === undefined || value === null || value === "") return fallback;
  return !["false", "0", "no"].includes(String(value).trim().toLowerCase());
};

const getMailerConfig = () => {
  const host = String(process.env.MAILER_HOST || "").trim();
  const port = Number(process.env.MAILER_PORT || 0);
  const user = String(process.env.MAILER_PRODUCER_EMAIL || "").trim();
  const pass = String(process.env.MAILER_PRODUCER_PASSWORD || "");

  return {
    host,
    port,
    user,
    pass,
    rejectUnauthorized: mailerBoolean(process.env.MAILER_REJECT_UNAUTHORIZED, true),
    configured: Boolean(host && port && user && pass),
  };
};

let transporter = null;
let transporterKey = "";

const getTransporter = () => {
  const config = getMailerConfig();
  if (!config.configured) return null;

  const key = JSON.stringify(config);
  if (transporter && transporterKey === key) return transporter;

  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    tls: {
      rejectUnauthorized: config.rejectUnauthorized,
    },
  });
  transporterKey = key;
  return transporter;
};

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const paragraphHtml = (lines) =>
  lines
    .map((line) => `<p style="margin:0 0 12px;color:#1f2937;line-height:1.5;">${escapeHtml(line)}</p>`)
    .join("");

const otpHtml = ({ title, name, otp, expiresInMinutes, purpose }) => `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
    <h2 style="margin:0 0 16px;color:#111827;">${escapeHtml(title)}</h2>
    ${paragraphHtml([
      `Hello ${name || "there"},`,
      `Use this code to ${purpose}. It expires in ${expiresInMinutes} minutes.`,
    ])}
    <div style="font-size:28px;letter-spacing:6px;font-weight:700;color:#111827;background:#f3f4f6;border-radius:8px;padding:16px;text-align:center;margin:20px 0;">
      ${escapeHtml(otp)}
    </div>
    ${paragraphHtml(["If you did not request this code, you can ignore this email."])}
  </div>
`;

const sendMail = async ({ to, subject, text, html, simulationMessage }) => {
  const config = getMailerConfig();
  const activeTransporter = getTransporter();

  if (!activeTransporter) {
    console.log(`[EMAIL SIMULATION] ${simulationMessage}`);
    return { simulated: true };
  }

  return activeTransporter.sendMail({
    from: `"SafarisCon" <${config.user}>`,
    to,
    subject,
    text,
    html,
  });
};

const sendProviderOnboardingEmail = async ({
  providerEmail,
  businessName,
  providerName,
}) =>
  sendMail({
    to: providerEmail,
    subject: "Complete your SafarisCon provider registration",
    text: [
      `Hello ${providerName || "provider"},`,
      `Your provider account for ${businessName} has been created.`,
      "Use the seller ID and generated password from the admin to complete registration and set your password.",
    ].join("\n\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 16px;color:#111827;">Complete your provider registration</h2>
        ${paragraphHtml([
          `Hello ${providerName || "provider"},`,
          `Your provider account for ${businessName} has been created.`,
          "Use the seller ID and generated password from the admin to complete registration and set your password.",
        ])}
      </div>
    `,
    simulationMessage: `Sent onboarding email to ${providerEmail} for business "${businessName}" and provider "${providerName}". The provider must complete registration to set a password.`,
  });

const sendEmailVerificationOtp = async ({ email, name, otp, expiresInMinutes }) =>
  sendMail({
    to: email,
    subject: "Verify your SafarisCon email",
    text: [
      `Hello ${name || "there"},`,
      `Your SafarisCon email verification code is ${otp}.`,
      `It expires in ${expiresInMinutes} minutes.`,
      "If you did not request this code, you can ignore this email.",
    ].join("\n\n"),
    html: otpHtml({
      title: "Verify your email",
      name,
      otp,
      expiresInMinutes,
      purpose: "verify your SafarisCon email",
    }),
    simulationMessage: `Sent email verification OTP ${otp} to ${email} for "${name || "user"}". It expires in ${expiresInMinutes} minutes.`,
  });

const sendPasswordResetOtp = async ({ email, name, otp, expiresInMinutes }) =>
  sendMail({
    to: email,
    subject: "Reset your SafarisCon password",
    text: [
      `Hello ${name || "there"},`,
      `Your SafarisCon password reset code is ${otp}.`,
      `It expires in ${expiresInMinutes} minutes.`,
      "If you did not request this code, you can ignore this email.",
    ].join("\n\n"),
    html: otpHtml({
      title: "Reset your password",
      name,
      otp,
      expiresInMinutes,
      purpose: "reset your SafarisCon password",
    }),
    simulationMessage: `Sent password reset OTP ${otp} to ${email} for "${name || "user"}". It expires in ${expiresInMinutes} minutes.`,
  });

module.exports = {
  sendProviderOnboardingEmail,
  sendEmailVerificationOtp,
  sendPasswordResetOtp,
};
