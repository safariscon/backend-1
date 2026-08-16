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

const formatRwfs = (amount) => `RWF ${Number(amount || 0).toLocaleString("en-US")}`;

const isDeliverableEmail = (email) => {
  const value = String(email || "").trim().toLowerCase();
  if (!value || !value.includes("@")) return false;
  return !/@seller\.local$|@business\.local$/i.test(value);
};

const detailsTableHtml = (rows = []) => {
  const cells = rows
    .filter((row) => row?.label && String(row.value || "").trim())
    .map(
      (row) => `
        <tr>
          <td style="padding:8px 12px;color:#6b7280;vertical-align:top;width:38%;">${escapeHtml(row.label)}</td>
          <td style="padding:8px 12px;color:#111827;font-weight:600;">${escapeHtml(row.value)}</td>
        </tr>`
    )
    .join("");
  if (!cells) return "";
  return `<table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;margin:16px 0;">${cells}</table>`;
};

const ctaButtonHtml = (href, label) =>
  href
    ? `<p style="margin:24px 0 8px;">
        <a href="${escapeHtml(href)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;">
          ${escapeHtml(label)}
        </a>
      </p>`
    : "";

const bookingModeLabel = (mode) =>
  String(mode || "").toLowerCase() === "automatic" ? "Automatic" : "Manual";

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
  bookingCode,
  bookingMode,
  customerName,
  customerLocation,
  serviceCategory,
  optionName,
  bookingDate,
  endBookingDate,
  startTime,
  endTime,
  guests,
  numberOfPeople,
  quantity,
  totalPrice,
  specialRequests,
  dashboardUrl,
}) => {
  const isAutomatic = String(bookingMode || "").toLowerCase() === "automatic";
  const mode = bookingModeLabel(bookingMode);
  const nextSteps = isAutomatic
    ? [
        "This booking used automatic pricing. You do not need to approve a quote.",
        "Open your bookings page, confirm the reserved option and dates, then wait for the customer to pay in SafarisCon.",
        "After payment, customer contact details unlock so you can deliver the service.",
      ]
    : [
        "This is a manual booking request. Review the dates, option, and guest count, then approve or reject it in your dashboard.",
        "If you approve, set the price (if needed). The customer will then pay in SafarisCon.",
        "Do not share your phone number or exact location outside the app. Contacts unlock after the customer pays.",
      ];
  const rows = [
    { label: "Booking ID", value: bookingCode || bookingId },
    { label: "Booking type", value: `${mode} booking` },
    { label: "Service", value: businessName },
    { label: "Category", value: serviceCategory },
    { label: "Option", value: optionName },
    { label: "Customer", value: customerName },
    { label: "Customer area", value: customerLocation },
    { label: "Start date", value: bookingDate },
    { label: "End date", value: endBookingDate && endBookingDate !== bookingDate ? endBookingDate : "" },
    { label: "Time", value: startTime && endTime ? `${startTime} – ${endTime}` : startTime || endTime },
    { label: "Guests", value: numberOfPeople || guests },
    { label: "Quantity", value: quantity },
    { label: "Quoted total", value: isAutomatic && totalPrice ? formatRwfs(totalPrice) : "" },
    { label: "Special requests", value: specialRequests },
  ];
  const openLabel = "Open seller bookings";

  return sendMail({
    to: serviceProviderEmail,
    subject: isAutomatic
      ? `New automatic booking for ${businessName || "your service"}`
      : `New booking request needs your review: ${businessName || "your service"}`,
    text: [
      `Hello ${serviceProviderName || "service provider"},`,
      `A customer booked ${businessName || "your service"} (${mode.toLowerCase()}).`,
      ...rows.filter((row) => row.value).map((row) => `${row.label}: ${row.value}`),
      ...nextSteps,
      dashboardUrl ? `Open bookings (sign in first if needed): ${dashboardUrl}` : "Open your SafarisCon seller bookings page.",
    ].join("\n\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 16px;color:#111827;">${isAutomatic ? "New automatic booking" : "New booking request"}</h2>
        ${paragraphHtml([
          `Hello ${serviceProviderName || "service provider"},`,
          `A customer booked ${businessName || "your service"}.`,
        ])}
        ${detailsTableHtml(rows)}
        ${paragraphHtml(nextSteps)}
        ${ctaButtonHtml(dashboardUrl, openLabel)}
        ${dashboardUrl ? `<p style="margin:0;color:#6b7280;font-size:13px;">If you are not signed in, you will log in first and then return to your bookings page.</p>` : ""}
      </div>
    `,
    simulationMessage: `Sent ${mode.toLowerCase()} booking email to seller ${serviceProviderEmail} for booking ${bookingId}.`,
  });
};

const sendCustomerBookingReceivedEmail = async ({
  customerEmail,
  customerName,
  businessName,
  bookingId,
  bookingCode,
  bookingMode,
  optionName,
  bookingDate,
  endBookingDate,
  startTime,
  endTime,
  guests,
  numberOfPeople,
  quantity,
  totalPrice,
  dashboardUrl,
  paymentUrl,
}) => {
  const isAutomatic = String(bookingMode || "").toLowerCase() === "automatic";
  const mode = bookingModeLabel(bookingMode);
  const nextSteps = isAutomatic
    ? [
        "Your quote is ready. Pay in SafarisCon to confirm the booking and unlock the provider details.",
        "Availability is held for a short time. Complete payment soon so the reservation is not released.",
      ]
    : [
        "The service provider will review this request. You will get another email when they approve it.",
        "After approval, pay in SafarisCon. Provider contact and the exact location unlock after payment.",
      ];
  const rows = [
    { label: "Booking ID", value: bookingCode || bookingId },
    { label: "Booking type", value: `${mode} booking` },
    { label: "Service", value: businessName },
    { label: "Option", value: optionName },
    { label: "Start date", value: bookingDate },
    { label: "End date", value: endBookingDate && endBookingDate !== bookingDate ? endBookingDate : "" },
    { label: "Time", value: startTime && endTime ? `${startTime} – ${endTime}` : startTime || endTime },
    { label: "Guests", value: numberOfPeople || guests },
    { label: "Quantity", value: quantity },
    { label: "Amount to pay", value: isAutomatic && totalPrice ? formatRwfs(totalPrice) : "Set after provider approval" },
  ];

  return sendMail({
    to: customerEmail,
    subject: isAutomatic
      ? `Your ${businessName || "SafarisCon"} quote is ready`
      : `We received your booking request for ${businessName || "a SafarisCon service"}`,
    text: [
      `Hello ${customerName || "there"},`,
      `Your booking for ${businessName || "the requested service"} was received.`,
      ...rows.filter((row) => row.value).map((row) => `${row.label}: ${row.value}`),
      ...nextSteps,
      dashboardUrl ? `View your bookings (sign in first if needed): ${dashboardUrl}` : "",
      paymentUrl ? `Pay now: ${paymentUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 16px;color:#111827;">${isAutomatic ? "Your quote is ready" : "Booking request received"}</h2>
        ${paragraphHtml([
          `Hello ${customerName || "there"},`,
          `Your booking for ${businessName || "the requested service"} was received.`,
        ])}
        ${detailsTableHtml(rows)}
        ${paragraphHtml(nextSteps)}
        ${ctaButtonHtml(paymentUrl || dashboardUrl, paymentUrl ? "Pay now" : "View my bookings")}
        ${dashboardUrl ? `<p style="margin:0;color:#6b7280;font-size:13px;">If you are not signed in, you will log in first and then open your bookings page.</p>` : ""}
      </div>
    `,
    simulationMessage: `Sent ${mode.toLowerCase()} booking confirmation to customer ${customerEmail} for booking ${bookingId}.`,
  });
};

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
  sendCustomerBookingReceivedEmail,
  sendManualBookingApprovedEmail,
  sendBusinessApprovedEmail,
  sendEmailVerificationOtp,
  sendPasswordResetOtp,
  sendLoginOtp,
  isDeliverableEmail,
};
