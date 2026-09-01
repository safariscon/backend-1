const nodemailer = require("nodemailer");
const { emailCopy, fill, greetingName, resolveLanguage } = require("./emailI18n");

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

const bookingModeLabel = (mode, copy) =>
  String(mode || "").toLowerCase() === "automatic" ? copy.automatic : copy.manual;

const otpHtml = ({ title, greeting, otp, expiresLine, purposeLine, ignoreLine }) => `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
    <h2 style="margin:0 0 16px;color:#111827;">${escapeHtml(title)}</h2>
    ${paragraphHtml([greeting, purposeLine || expiresLine].filter(Boolean))}
    <div style="font-size:28px;letter-spacing:6px;font-weight:700;color:#111827;background:#f3f4f6;border-radius:8px;padding:16px;text-align:center;margin:20px 0;">
      ${escapeHtml(otp)}
    </div>
    ${paragraphHtml([ignoreLine])}
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
  language,
}) => {
  const copy = emailCopy(language);
  const inviteUrl = String(registrationUrl || "").trim();
  const greeting = greetingName(copy, providerName, "providerHello");
  const created = businessName
    ? fill(copy.providerCreatedFor, { business: businessName })
    : copy.providerCreated;
  const nameLine = `${copy.providerNameLabel}: ${providerName || copy.providerHello}`;
  const emailLine = `${copy.providerEmailLabel}: ${providerEmail}`;
  const idLine = `${copy.providerIdLabel}: ${sellerId}`;
  const linkLines = inviteUrl
    ? [copy.providerOpenLink, inviteUrl, copy.providerConfirm]
    : [copy.providerUseId];

  return sendMail({
    to: providerEmail,
    subject: copy.providerSubject,
    text: [greeting, created, nameLine, emailLine, idLine, ...linkLines, copy.providerAfter].join("\n\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 16px;color:#111827;">${escapeHtml(copy.providerTitle)}</h2>
        ${paragraphHtml([greeting, created, copy.providerSaved])}
        <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin:16px 0;color:#111827;">
          <p style="margin:0 0 8px;"><strong>${escapeHtml(copy.providerNameLabel)}:</strong> ${escapeHtml(providerName)}</p>
          <p style="margin:0 0 8px;"><strong>${escapeHtml(copy.providerEmailLabel)}:</strong> ${escapeHtml(providerEmail)}</p>
          <p style="margin:0;"><strong>${escapeHtml(copy.providerIdLabel)}:</strong> ${escapeHtml(sellerId)}</p>
        </div>
        ${
          inviteUrl
            ? `
        <p style="margin:0 0 16px;color:#1f2937;line-height:1.5;">${escapeHtml(copy.providerFormHelp)}</p>
        <p style="margin:0 0 20px;">
          <a href="${escapeHtml(inviteUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600;">
            ${escapeHtml(copy.providerCta)}
          </a>
        </p>
        <p style="margin:0 0 16px;color:#6b7280;font-size:13px;line-height:1.5;word-break:break-all;">${escapeHtml(inviteUrl)}</p>
            `
            : paragraphHtml([copy.providerUseId])
        }
        ${paragraphHtml([copy.providerAfter])}
      </div>
    `,
    simulationMessage: `Sent service provider onboarding email with seller ID ${sellerId} and invite ${inviteUrl || "(no link)"} to ${providerEmail} for business "${businessName || "service provider account"}" and service provider "${providerName}".`,
  });
};

const sendOtpEmail = async ({ email, name, otp, expiresInMinutes, language, kind }) => {
  const copy = emailCopy(language);
  const greeting = greetingName(copy, name);
  const subjects = { verify: copy.verifySubject, reset: copy.resetSubject, login: copy.loginSubject };
  const titles = { verify: copy.verifyTitle, reset: copy.resetTitle, login: copy.loginTitle };
  const purposes = { verify: copy.verifyPurpose, reset: copy.resetPurpose, login: copy.loginPurpose };
  const texts = { verify: copy.verifyText, reset: copy.resetText, login: copy.loginText };
  const ignore = kind === "login" ? copy.ignoreLogin : copy.ignoreCode;
  return sendMail({
    to: email,
    subject: subjects[kind],
    text: [
      greeting,
      fill(texts[kind], { otp }),
      fill(copy.verifyExpires, { minutes: expiresInMinutes }),
      ignore,
    ].join("\n\n"),
    html: otpHtml({
      title: titles[kind],
      greeting,
      otp,
      purposeLine: fill(copy.otpUse, { purpose: purposes[kind], minutes: expiresInMinutes }),
      ignoreLine: ignore,
    }),
    simulationMessage: `Sent ${kind} OTP ${otp} to ${email} for "${name || "user"}". It expires in ${expiresInMinutes} minutes.`,
  });
};

const sendEmailVerificationOtp = async (payload) => sendOtpEmail({ ...payload, kind: "verify" });
const sendPasswordResetOtp = async (payload) => sendOtpEmail({ ...payload, kind: "reset" });
const sendLoginOtp = async (payload) => sendOtpEmail({ ...payload, kind: "login" });

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
  pickupLocation,
  returnLocation,
  dashboardUrl,
  language,
}) => {
  const copy = emailCopy(language);
  const isAutomatic = String(bookingMode || "").toLowerCase() === "automatic";
  const mode = bookingModeLabel(bookingMode, copy);
  const business = businessName || copy.yourService;
  const greeting = greetingName(copy, serviceProviderName, "sellerHello");
  const nextSteps = isAutomatic
    ? [copy.sellerAuto1, copy.sellerAuto2, copy.sellerAuto3]
    : [copy.sellerManual1, copy.sellerManual2, copy.sellerManual3];
  const rows = [
    { label: copy.bookingId, value: bookingCode || bookingId },
    { label: copy.bookingType, value: isAutomatic ? copy.automaticBooking : copy.manualBooking },
    { label: copy.service, value: businessName },
    { label: copy.category, value: serviceCategory },
    { label: copy.option, value: optionName },
    { label: copy.customer, value: customerName },
    { label: copy.customerArea, value: customerLocation },
    { label: copy.pickupLocation, value: pickupLocation },
    { label: copy.returnLocation, value: returnLocation },
    { label: copy.startDate, value: bookingDate },
    { label: copy.endDate, value: endBookingDate && endBookingDate !== bookingDate ? endBookingDate : "" },
    { label: copy.time, value: startTime && endTime ? `${startTime} – ${endTime}` : startTime || endTime },
    { label: copy.guests, value: numberOfPeople || guests },
    { label: copy.quantity, value: quantity },
    { label: copy.quotedTotal, value: isAutomatic && totalPrice ? formatRwfs(totalPrice) : "" },
    { label: copy.specialRequests, value: specialRequests },
  ];

  return sendMail({
    to: serviceProviderEmail,
    subject: fill(isAutomatic ? copy.sellerAutoSubject : copy.sellerManualSubject, { business }),
    text: [
      greeting,
      fill(copy.sellerBooked, { business, mode: mode.toLowerCase() }),
      ...rows.filter((row) => row.value).map((row) => `${row.label}: ${row.value}`),
      ...nextSteps,
      dashboardUrl ? fill(copy.openBookingsSignIn, { url: dashboardUrl }) : copy.openSellerPage,
    ].join("\n\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 16px;color:#111827;">${escapeHtml(isAutomatic ? copy.sellerAutoTitle : copy.sellerManualTitle)}</h2>
        ${paragraphHtml([greeting, fill(copy.sellerBookedShort, { business })])}
        ${detailsTableHtml(rows)}
        ${paragraphHtml(nextSteps)}
        ${ctaButtonHtml(dashboardUrl, copy.openSellerBookings)}
        ${dashboardUrl ? `<p style="margin:0;color:#6b7280;font-size:13px;">${escapeHtml(copy.signInThenBookings)}</p>` : ""}
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
  pickupLocation,
  returnLocation,
  dashboardUrl,
  paymentUrl,
  language,
}) => {
  const copy = emailCopy(language);
  const isAutomatic = String(bookingMode || "").toLowerCase() === "automatic";
  const mode = bookingModeLabel(bookingMode, copy);
  const business = businessName || copy.requestedService;
  const greeting = greetingName(copy, customerName);
  const nextSteps = isAutomatic ? [copy.customerAuto1, copy.customerAuto2] : [copy.customerManual1, copy.customerManual2];
  const rows = [
    { label: copy.bookingId, value: bookingCode || bookingId },
    { label: copy.bookingType, value: isAutomatic ? copy.automaticBooking : copy.manualBooking },
    { label: copy.service, value: businessName },
    { label: copy.option, value: optionName },
    { label: copy.pickupLocation, value: pickupLocation },
    { label: copy.returnLocation, value: returnLocation },
    { label: copy.startDate, value: bookingDate },
    { label: copy.endDate, value: endBookingDate && endBookingDate !== bookingDate ? endBookingDate : "" },
    { label: copy.time, value: startTime && endTime ? `${startTime} – ${endTime}` : startTime || endTime },
    { label: copy.guests, value: numberOfPeople || guests },
    { label: copy.quantity, value: quantity },
    { label: copy.amountToPay, value: isAutomatic && totalPrice ? formatRwfs(totalPrice) : copy.amountAfterApproval },
  ];

  return sendMail({
    to: customerEmail,
    subject: fill(isAutomatic ? copy.customerAutoSubject : copy.customerManualSubject, { business: businessName || "SafarisCon" }),
    text: [
      greeting,
      fill(copy.customerReceived, { business }),
      ...rows.filter((row) => row.value).map((row) => `${row.label}: ${row.value}`),
      ...nextSteps,
      dashboardUrl ? fill(copy.viewBookingsUrl, { url: dashboardUrl }) : "",
      paymentUrl ? fill(copy.payNowUrl, { url: paymentUrl }) : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 16px;color:#111827;">${escapeHtml(isAutomatic ? copy.customerAutoTitle : copy.customerManualTitle)}</h2>
        ${paragraphHtml([greeting, fill(copy.customerReceived, { business })])}
        ${detailsTableHtml(rows)}
        ${paragraphHtml(nextSteps)}
        ${ctaButtonHtml(paymentUrl || dashboardUrl, paymentUrl ? copy.payNow : copy.viewBookings)}
        ${dashboardUrl ? `<p style="margin:0;color:#6b7280;font-size:13px;">${escapeHtml(copy.signInThenCustomer)}</p>` : ""}
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
  language,
}) => {
  const copy = emailCopy(language);
  const greeting = greetingName(copy, customerName);
  const business = businessName || copy.requestedService;
  return sendMail({
    to: customerEmail,
    subject: copy.approvedSubject,
    text: [
      greeting,
      fill(copy.approvedBody, { business }),
      `${copy.bookingId}: ${bookingId}`,
      `${copy.totalAmount}: ${formatRwfs(amount)}`,
      `${copy.amountNow}: ${formatRwfs(depositAmount)}`,
      deadlineAt ? `${copy.paymentDeadline}: ${new Date(deadlineAt).toLocaleString("en-US")}` : "",
      paymentUrl ? fill(copy.payInSafariscon, { url: paymentUrl }) : copy.openToPay,
    ].filter(Boolean).join("\n\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 16px;color:#111827;">${escapeHtml(copy.approvedTitle)}</h2>
        ${paragraphHtml([
          greeting,
          fill(copy.approvedBody, { business }),
          `${copy.bookingId}: ${bookingId}`,
          `${copy.totalAmount}: ${formatRwfs(amount)}`,
          `${copy.amountNow}: ${formatRwfs(depositAmount)}`,
          deadlineAt ? `${copy.paymentDeadline}: ${new Date(deadlineAt).toLocaleString("en-US")}` : "",
          paymentUrl ? fill(copy.payInSafariscon, { url: paymentUrl }) : copy.openToPay,
        ].filter(Boolean))}
      </div>
    `,
    simulationMessage: `Sent manual booking approval email to customer ${customerEmail} for booking ${bookingId}.`,
  });
};

const sendBusinessApprovedEmail = async ({
  serviceProviderEmail,
  serviceProviderName,
  businessName,
  commissionPercentage,
  language,
}) => {
  const copy = emailCopy(language);
  const greeting = greetingName(copy, serviceProviderName, "sellerHello");
  const business = businessName || copy.yourBusiness;
  return sendMail({
    to: serviceProviderEmail,
    subject: copy.businessApprovedSubject,
    text: [
      greeting,
      fill(copy.businessApprovedBody, { business }),
      fill(copy.commissionLine, { percent: Number(commissionPercentage || 0) }),
      copy.commissionTerms,
    ].join("\n\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 16px;color:#111827;">${escapeHtml(copy.businessApprovedTitle)}</h2>
        ${paragraphHtml([
          greeting,
          fill(copy.businessApprovedBody, { business }),
          fill(copy.commissionLine, { percent: Number(commissionPercentage || 0) }),
          copy.commissionTerms,
        ])}
      </div>
    `,
    simulationMessage: `Sent business approval email to ${serviceProviderEmail} for "${businessName}" with ${Number(commissionPercentage || 0)}% commission.`,
  });
};

const sendBookingPaidEmail = async ({ customerEmail, customerName, businessName, bookingId, bookingCode, amount, language }) => {
  const copy = emailCopy(language);
  const greeting = greetingName(copy, customerName);
  const business = businessName || copy.requestedService;
  return sendMail({
    to: customerEmail,
    subject: copy.paidSubject,
    text: [
      greeting,
      fill(copy.paidBody, { business }),
      `${copy.bookingId}: ${bookingId}`,
      bookingCode ? `${copy.bookingCode}: ${bookingCode}` : "",
      amount ? `${copy.totalAmount}: ${formatRwfs(amount)}` : "",
    ].filter(Boolean).join("\n\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 16px;color:#111827;">${escapeHtml(copy.paidTitle)}</h2>
        ${paragraphHtml([
          greeting,
          fill(copy.paidBody, { business }),
          `${copy.bookingId}: ${bookingId}`,
          bookingCode ? `${copy.bookingCode}: ${bookingCode}` : "",
          amount ? `${copy.totalAmount}: ${formatRwfs(amount)}` : "",
        ].filter(Boolean))}
      </div>
    `,
    simulationMessage: `Sent booking paid email to ${customerEmail} for booking ${bookingId}.`,
  });
};

const sendBookingCancelledEmail = async ({ customerEmail, customerName, businessName, bookingId, refundAmount, penaltyAmount, language }) => {
  const copy = emailCopy(language);
  const greeting = greetingName(copy, customerName);
  const business = businessName || copy.requestedService;
  return sendMail({
    to: customerEmail,
    subject: copy.cancelledSubject,
    text: [
      greeting,
      fill(copy.cancelledBody, { business }),
      `${copy.bookingId}: ${bookingId}`,
      refundAmount != null ? `${copy.refundAmount}: ${formatRwfs(refundAmount)}` : "",
      penaltyAmount != null ? `${copy.cancellationFee}: ${formatRwfs(penaltyAmount)}` : "",
    ].filter(Boolean).join("\n\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 16px;color:#111827;">${escapeHtml(copy.cancelledTitle)}</h2>
        ${paragraphHtml([
          greeting,
          fill(copy.cancelledBody, { business }),
          `${copy.bookingId}: ${bookingId}`,
          refundAmount != null ? `${copy.refundAmount}: ${formatRwfs(refundAmount)}` : "",
          penaltyAmount != null ? `${copy.cancellationFee}: ${formatRwfs(penaltyAmount)}` : "",
        ].filter(Boolean))}
      </div>
    `,
    simulationMessage: `Sent booking cancelled email to ${customerEmail} for booking ${bookingId}.`,
  });
};

const sendProviderPayoutEmail = async ({ serviceProviderEmail, serviceProviderName, businessName, amount, payoutReference, language }) => {
  const copy = emailCopy(language);
  const greeting = greetingName(copy, serviceProviderName, "sellerHello");
  const business = businessName || copy.yourService;
  return sendMail({
    to: serviceProviderEmail,
    subject: copy.payoutSubject,
    text: [
      greeting,
      fill(copy.payoutBody, { business }),
      amount != null ? `${copy.payoutAmount}: ${formatRwfs(amount)}` : "",
      payoutReference ? `${copy.payoutReference}: ${payoutReference}` : "",
    ].filter(Boolean).join("\n\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 16px;color:#111827;">${escapeHtml(copy.payoutTitle)}</h2>
        ${paragraphHtml([
          greeting,
          fill(copy.payoutBody, { business }),
          amount != null ? `${copy.payoutAmount}: ${formatRwfs(amount)}` : "",
          payoutReference ? `${copy.payoutReference}: ${payoutReference}` : "",
        ].filter(Boolean))}
      </div>
    `,
    simulationMessage: `Sent provider payout email to ${serviceProviderEmail} for ${business}.`,
  });
};

const sendBookingCodeEmail = async ({ customerEmail, customerName, businessName, bookingCode, language }) => {
  const copy = emailCopy(language);
  const greeting = greetingName(copy, customerName);
  return sendMail({
    to: customerEmail,
    subject: copy.codeSubject,
    text: [greeting, copy.codeBody, `${copy.bookingCode}: ${bookingCode}`].join("\n\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 16px;color:#111827;">${escapeHtml(copy.codeTitle)}</h2>
        ${paragraphHtml([greeting, copy.codeBody])}
        <div style="font-size:28px;letter-spacing:4px;font-weight:700;color:#111827;background:#f3f4f6;border-radius:8px;padding:16px;text-align:center;margin:20px 0;">
          ${escapeHtml(bookingCode)}
        </div>
      </div>
    `,
    simulationMessage: `Sent booking code ${bookingCode} to ${customerEmail}.`,
  });
};

module.exports = {
  sendProviderOnboardingEmail,
  sendServiceProviderBookingRequestEmail,
  sendCustomerBookingReceivedEmail,
  sendManualBookingApprovedEmail,
  sendBusinessApprovedEmail,
  sendEmailVerificationOtp,
  sendPasswordResetOtp,
  sendLoginOtp,
  sendBookingPaidEmail,
  sendBookingCancelledEmail,
  sendProviderPayoutEmail,
  sendBookingCodeEmail,
  isDeliverableEmail,
  resolveLanguage,
};
