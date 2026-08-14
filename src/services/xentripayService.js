const { prefixedCode } = require("../utils/secureIds");

const mailerBoolean = (value, fallback = true) => {
  if (value === undefined || value === null || value === "") return fallback;
  return !["false", "0", "no"].includes(String(value).trim().toLowerCase());
};

const getXentripayConfig = () => {
  const env = String(process.env.XENTRIPAY_ENV || "test").trim().toLowerCase();
  const defaultBase =
    env === "production" ? "https://xentripay.com" : "https://merchant.test.xentripay.com";
  const apiKey = String(process.env.XENTRIPAY_API_KEY || "").trim();
  const placeholderKey = !apiKey || /^(your_xentripay_api_key|replace_me|changeme|xxx)$/i.test(apiKey);
  const baseUrl = String(process.env.XENTRIPAY_BASE_URL || defaultBase).replace(/\/+$/, "");
  const simulateSuccess = mailerBoolean(process.env.XENTRIPAY_SIMULATE_SUCCESS, false);

  return {
    env: env === "production" ? "production" : "test",
    apiKey,
    baseUrl,
    currency: String(process.env.XENTRIPAY_CURRENCY || "RWF").trim().toUpperCase() || "RWF",
    chargesIncluded: mailerBoolean(process.env.XENTRIPAY_CHARGES_INCLUDED, true),
    minAmount: Number(process.env.XENTRIPAY_MIN_AMOUNT || 100),
    merchantName: String(process.env.XENTRIPAY_MERCHANT_NAME || "SafarisCon").trim(),
    merchantEmail: String(process.env.XENTRIPAY_MERCHANT_EMAIL || "").trim(),
    merchantPhone: String(process.env.XENTRIPAY_MERCHANT_PHONE || "").trim(),
    collectionRedirectUrl: String(process.env.XENTRIPAY_COLLECTION_REDIRECT_URL || "").trim(),
    collectionReturnUrl: String(process.env.XENTRIPAY_COLLECTION_RETURN_URL || "").trim(),
    checkoutFinalUrl: String(process.env.XENTRIPAY_CHECKOUT_FINAL_URL || "").trim(),
    configured: Boolean(apiKey) && !placeholderKey,
    simulateSuccess,
  };
};

const isSimulation = () => !getXentripayConfig().configured;

const xentripayRequest = async (method, path, body) => {
  const config = getXentripayConfig();
  if (!config.configured) {
    const error = new Error("XentriPay is not configured. Set XENTRIPAY_API_KEY in .env.");
    error.status = 503;
    throw error;
  }

  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-XENTRIPAY-KEY": config.apiKey,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_error) {
    payload = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(payload?.message || `XentriPay request failed (${response.status}).`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
};

const simulateCollection = ({ customerRef, pmethod, amount }) => ({
  simulated: true,
  reply: "Simulated XentriPay collection initiated.",
  url: pmethod === "cc" ? `https://sandbox.xentripay.local/card/${customerRef}` : null,
  success: 1,
  authkey: `sim-auth-${customerRef}`,
  tid: prefixedCode("TID", 10),
  refid: customerRef,
  retcode: 0,
  customerRef,
  amount,
});

const initiateCollection = async ({
  email,
  cname,
  cnumber,
  msisdn,
  amount,
  pmethod,
  customerRef,
  details,
  redirecturl,
  returl,
}) => {
  const config = getXentripayConfig();
  const wholeAmount = Math.round(Number(amount || 0));
  if (!Number.isFinite(wholeAmount) || wholeAmount < config.minAmount) {
    const error = new Error(`Amount must be at least ${config.minAmount} ${config.currency}.`);
    error.status = 400;
    throw error;
  }

  const payload = {
    email,
    cname,
    amount: wholeAmount,
    cnumber,
    msisdn,
    currency: config.currency,
    pmethod,
    chargesIncluded: config.chargesIncluded,
    customerRef,
    details,
  };

  if (pmethod === "cc") {
    payload.redirecturl = redirecturl || config.collectionRedirectUrl;
    payload.returl = returl || config.collectionReturnUrl;
    if (!payload.redirecturl || !payload.returl) {
      const error = new Error("Card collections require redirect and return URLs.");
      error.status = 400;
      throw error;
    }
  }

  if (isSimulation()) {
    return simulateCollection({ customerRef, pmethod, amount: wholeAmount });
  }

  return xentripayRequest("POST", "/api/collections/initiate", payload);
};

const getCollectionStatus = async (reference) => {
  if (isSimulation()) {
    return {
      simulated: true,
      customerRef: reference,
      rid: reference,
      status: getXentripayConfig().simulateSuccess ? "SUCCESS" : "PENDING",
      updatedAt: new Date().toISOString(),
    };
  }

  return xentripayRequest("GET", `/api/collections/status/${encodeURIComponent(reference)}`);
};

const initiatePayout = async ({
  customerReference,
  telecomProviderId,
  msisdn,
  name,
  amount,
}) => {
  const config = getXentripayConfig();
  const wholeAmount = Math.round(Number(amount || 0));
  if (!Number.isFinite(wholeAmount) || wholeAmount < 1) {
    const error = new Error("Payout amount must be at least 1 RWF.");
    error.status = 400;
    throw error;
  }

  const payload = {
    customerReference,
    telecomProviderId: String(telecomProviderId),
    msisdn: String(msisdn),
    name,
    transactionType: "PAYOUT",
    currency: config.currency,
    amount: wholeAmount,
  };

  if (isSimulation()) {
    return {
      simulated: true,
      id: Date.now(),
      businessName: config.merchantName,
      customerReference,
      telecomProviderId: payload.telecomProviderId,
      msisdn: payload.msisdn,
      transactionType: "PAYOUT",
      currency: config.currency,
      amount: wholeAmount,
      txnCharge: 0,
      status: "PENDING",
      statusMessage: "Simulated payout submitted. Confirm the merchant OTP in XentriPay to release funds.",
      internalRef: prefixedCode("PO", 12),
      validatedAccountName: name,
    };
  }

  return xentripayRequest("POST", "/api/payment-requests", payload);
};

const getPayoutStatus = async (customerReference) => {
  if (isSimulation()) {
    return {
      timestamp: new Date().toISOString(),
      message: "Success",
      data: {
        status: getXentripayConfig().simulateSuccess ? "COMPLETED" : "PENDING",
        reference_number: customerReference,
        amount: "0",
      },
    };
  }

  return xentripayRequest(
    "GET",
    `/api/payment-requests/check-status?customerRef=${encodeURIComponent(customerReference)}`
  );
};

const createCheckoutSession = async ({ amount, customerFinalUrl, currency }) => {
  const config = getXentripayConfig();
  const payload = {
    amount: Math.round(Number(amount || 0)),
    customerFinalUrl: customerFinalUrl || config.checkoutFinalUrl,
    currency: currency || config.currency,
  };

  if (isSimulation()) {
    const id = `cs_sim_${prefixedCode("", 8).toLowerCase()}`;
    return {
      simulated: true,
      id,
      checkoutUrl: `${config.baseUrl}/checkout/${id}`,
      status: "CREATED",
    };
  }

  return xentripayRequest("POST", "/api/checkout/sessions", payload);
};

const payCheckoutSession = async (sessionId, payment) => {
  if (isSimulation()) {
    return {
      simulated: true,
      status: "PENDING",
      redirectTo: payment.gatewayRedirectUrl || getXentripayConfig().checkoutFinalUrl,
      gatewayUrl: payment.pmethod === "cc" ? `https://sandbox.xentripay.local/card/${sessionId}` : null,
      paymentMethod: payment.pmethod,
    };
  }

  return xentripayRequest("POST", `/api/checkout/sessions/${encodeURIComponent(sessionId)}/pay`, payment);
};

const getCheckoutStatus = async (refid) => {
  if (isSimulation()) {
    return {
      simulated: true,
      refid,
      status: getXentripayConfig().simulateSuccess ? "SUCCESS" : "PENDING",
    };
  }

  return xentripayRequest("GET", `/api/checkout/sessions/status/${encodeURIComponent(refid)}`);
};

const normalizeCollectionStatus = (status) => {
  const value = String(status || "").trim().toUpperCase();
  if (["SUCCESS", "SUCCESSFUL", "COMPLETED", "PAID"].includes(value)) return "SUCCESS";
  if (["FAILED", "DECLINED", "CANCELLED", "CANCELED", "TIMEOUT"].includes(value)) return "FAILED";
  return "PENDING";
};

const normalizePayoutStatus = (status) => {
  const value = String(status || "").trim().toUpperCase();
  if (["SUCCESSFUL", "SUCCESS", "COMPLETED"].includes(value)) return "successful";
  if (["FAILED", "DECLINED"].includes(value)) return "failed";
  if (["REVERSED"].includes(value)) return "reversed";
  return "pending";
};

module.exports = {
  getXentripayConfig,
  isSimulation,
  initiateCollection,
  getCollectionStatus,
  initiatePayout,
  getPayoutStatus,
  createCheckoutSession,
  payCheckoutSession,
  getCheckoutStatus,
  normalizeCollectionStatus,
  normalizePayoutStatus,
};
