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

// this is a comment

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
  sellerId,
  registrationUrl,
}) => {
  const inviteUrl = String(registrationUrl || "").trim();
  const nameLine = `Name: ${providerName || "service provider"}`;
  const emailLine = `Email: ${providerEmail}`;
  const idLine = `Seller ID: ${sellerId}`;
  const linkLines = inviteUrl
    ? [
        "Open this link to finish registration. Your name and email will be filled in automatically:",
        inviteUrl,
        "On that page, confirm your seller ID and create a password. You do not need to retype your name or email.",
      ]
    : ["Use this seller ID to complete registration and create your password."];

  return sendMail({
    to: providerEmail,
    subject: "Complete your SafarisCon service provider registration",
    text: [
      `Hello ${providerName || "service provider"},`,
      businessName
        ? `Your service provider account for ${businessName} has been created.`
        : "Your service provider account has been created.",
      nameLine,
      emailLine,
      idLine,
      ...linkLines,
      "After creating your password, you will receive an email verification code before you can log in.",
    ].join("\n\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 16px;color:#111827;">Complete your service provider registration</h2>
        ${paragraphHtml([
          `Hello ${providerName || "service provider"},`,
          businessName
            ? `Your service provider account for ${businessName} has been created.`
            : "Your service provider account has been created.",
          "These details are already saved for you. You will not need to retype your name or email.",
        ])}
        <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin:16px 0;color:#111827;">
          <p style="margin:0 0 8px;"><strong>Name:</strong> ${escapeHtml(providerName)}</p>
          <p style="margin:0 0 8px;"><strong>Email:</strong> ${escapeHtml(providerEmail)}</p>
          <p style="margin:0;"><strong>Seller ID:</strong> ${escapeHtml(sellerId)}</p>
        </div>
        ${
          inviteUrl
            ? `
        <p style="margin:0 0 16px;color:#1f2937;line-height:1.5;">Open the link below. The form will load your name and email automatically. Enter your seller ID and a new password to continue.</p>
        <p style="margin:0 0 20px;">
          <a href="${escapeHtml(inviteUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600;">
            Complete registration
          </a>
        </p>
        <p style="margin:0 0 16px;color:#6b7280;font-size:13px;line-height:1.5;word-break:break-all;">${escapeHtml(inviteUrl)}</p>
            `
            : paragraphHtml(["Use this seller ID to complete registration and create your password."])
        }
        ${paragraphHtml(["After creating your password, you will receive an email verification code before you can log in."])}
      </div>
    `,
    simulationMessage: `Sent service provider onboarding email with seller ID ${sellerId} and invite ${inviteUrl || "(no link)"} to ${providerEmail} for business "${businessName || "service provider account"}" and service provider "${providerName}".`,
  });
};

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

const sendLoginOtp = async ({ email, name, otp, expiresInMinutes }) =>
  sendMail({
    to: email,
    subject: "Your SafarisCon login code",
    text: [
      `Hello ${name || "there"},`,
      `Your SafarisCon login code is ${otp}.`,
      `It expires in ${expiresInMinutes} minutes.`,
      "If you did not try to log in, you can ignore this email.",
    ].join("\n\n"),
    html: otpHtml({
      title: "Confirm your login",
      name,
      otp,
      expiresInMinutes,
      purpose: "complete your SafarisCon login",
    }),
    simulationMessage: `Sent login OTP ${otp} to ${email} for "${name || "user"}". It expires in ${expiresInMinutes} minutes.`,
  });

const sendServiceProviderBookingRequestEmail = async ({
  serviceProviderEmail,
  serviceProviderName,
  businessName,
  bookingId,
}) =>
  sendMail({
    to: serviceProviderEmail,
    subject: "New SafarisCon booking request needs approval",
    text: [
      `Hello ${serviceProviderName || "service provider"},`,
      `A customer requested ${businessName || "your service"}.`,
      `Booking ID: ${bookingId}`,
      "Review the request in your SafarisCon dashboard. Customer contact details stay hidden until payment is completed in the system.",
    ].join("\n\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 16px;color:#111827;">New booking request</h2>
        ${paragraphHtml([
          `Hello ${serviceProviderName || "service provider"},`,
          `A customer requested ${businessName || "your service"}.`,
          `Booking ID: ${bookingId}`,
          "Review the request in your SafarisCon dashboard. Customer contact details stay hidden until payment is completed in the system.",
        ])}
      </div>
    `,
    simulationMessage: `Sent manual booking request email to service provider ${serviceProviderEmail} for booking ${bookingId}.`,
  });

const sendManualBookingApprovedEmail = async ({
  customerEmail,
  customerName,
  businessName,
  bookingId,
  amount,
  depositAmount,
  deadlineAt,
  paymentUrl,
}) =>
  sendMail({
    to: customerEmail,
    subject: "Your SafarisCon booking was approved",
    text: [
      `Hello ${customerName || "there"},`,
      `Your booking for ${businessName || "the requested service"} was approved.`,
      `Booking ID: ${bookingId}`,
      `Total amount: RWF ${Number(amount || 0).toLocaleString("en-US")}`,
      `Amount to pay now: RWF ${Number(depositAmount || 0).toLocaleString("en-US")}`,
      deadlineAt ? `Payment deadline: ${new Date(deadlineAt).toLocaleString("en-US")}` : "",
      paymentUrl ? `Pay in SafarisCon: ${paymentUrl}` : "Open SafarisCon to complete payment.",
    ].filter(Boolean).join("\n\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 16px;color:#111827;">Booking approved</h2>
        ${paragraphHtml([
          `Hello ${customerName || "there"},`,
          `Your booking for ${businessName || "the requested service"} was approved.`,
          `Booking ID: ${bookingId}`,
          `Total amount: RWF ${Number(amount || 0).toLocaleString("en-US")}`,
          `Amount to pay now: RWF ${Number(depositAmount || 0).toLocaleString("en-US")}`,
          deadlineAt ? `Payment deadline: ${new Date(deadlineAt).toLocaleString("en-US")}` : "",
          paymentUrl ? `Pay in SafarisCon: ${paymentUrl}` : "Open SafarisCon to complete payment.",
        ].filter(Boolean))}
      </div>
    `,
    simulationMessage: `Sent manual booking approval email to customer ${customerEmail} for booking ${bookingId}.`,
  });

const sendBusinessApprovedEmail = async ({
  serviceProviderEmail,
  serviceProviderName,
  businessName,
  commissionPercentage,
}) =>
  sendMail({
    to: serviceProviderEmail,
    subject: "Your SafarisCon business was approved",
    text: [
      `Hello ${serviceProviderName || "service provider"},`,
      `${businessName || "Your business"} has been approved and is now available on SafarisCon.`,
      `Platform commission: ${Number(commissionPercentage || 0)}% of each paid booking for this business.`,
      "This commission is part of the SafarisCon service provider terms and will be shown in your dashboard for this business.",
    ].join("\n\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 16px;color:#111827;">Business approved</h2>
        ${paragraphHtml([
          `Hello ${serviceProviderName || "service provider"},`,
          `${businessName || "Your business"} has been approved and is now available on SafarisCon.`,
          `Platform commission: ${Number(commissionPercentage || 0)}% of each paid booking for this business.`,
          "This commission is part of the SafarisCon service provider terms and will be shown in your dashboard for this business.",
        ])}
      </div>
    `,
    simulationMessage: `Sent business approval email to ${serviceProviderEmail} for "${businessName}" with ${Number(commissionPercentage || 0)}% commission.`,
  });

module.exports = {
  sendProviderOnboardingEmail,
  sendServiceProviderBookingRequestEmail,
  sendManualBookingApprovedEmail,
  sendBusinessApprovedEmail,
  sendEmailVerificationOtp,
  sendPasswordResetOtp,
  sendLoginOtp,
};
