const frontendUrl = () =>
  String(process.env.FRONTEND_URL || process.env.PUBLIC_FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");

const LOGIN_PATH = "/login";
const SELLER_BOOKINGS_PATH = "/dashboard/seller/bookings";
const CUSTOMER_BOOKINGS_PATH = "/dashboard/bookings";

const withQuery = (path, query = {}) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    params.set(key, String(value));
  });
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
};

const buildLoginRedirectUrl = (nextPath) => {
  const path = String(nextPath || "/").startsWith("/") ? String(nextPath) : `/${nextPath}`;
  return `${frontendUrl()}${LOGIN_PATH}?redirect=${encodeURIComponent(path)}`;
};

const buildSellerBookingsUrl = ({ bookingId } = {}) =>
  buildLoginRedirectUrl(withQuery(SELLER_BOOKINGS_PATH, { bookingId }));

const buildCustomerBookingsUrl = ({ bookingId } = {}) =>
  buildLoginRedirectUrl(withQuery(CUSTOMER_BOOKINGS_PATH, { bookingId }));

module.exports = {
  frontendUrl,
  LOGIN_PATH,
  SELLER_BOOKINGS_PATH,
  CUSTOMER_BOOKINGS_PATH,
  buildLoginRedirectUrl,
  buildSellerBookingsUrl,
  buildCustomerBookingsUrl,
};
