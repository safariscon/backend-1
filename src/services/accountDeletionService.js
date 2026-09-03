const Booking = require("../models/Booking");
const Hotel = require("../models/Hotel");
const HotelService = require("../models/HotelService");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const { releaseBookingHold } = require("./bookingHoldService");
const {
  REALTIME_EVENTS,
  emitRealtime,
  emitUserRealtime,
} = require("../utils/realtime");

const SELLER_ROLES = new Set(["hotel", "supplier"]);
const CUSTOMER_ROLES = new Set(["tourist", "customer"]);

/** Bookings still in provider/admin workflow — block customer self-delete. */
const CUSTOMER_PENDING_STATUSES = new Set(["pending", "reviewing"]);

/** Active / safety-sensitive booking statuses for sellers. */
const SELLER_BLOCKING_BOOKING_STATUSES = new Set([
  "pending",
  "reviewing",
  "confirmed",
  "waiting-for-payment",
  "deposit-paid",
  "provider-details-unlocked",
]);

const PAID_PAYMENT_STATUSES = new Set([
  "deposit_paid",
  "deposit-paid",
  "paid",
  "completed",
]);

const UNPAID_PAYMENT_STATUSES = new Set(["unpaid", "pending", "failed"]);

const sellerHotelQuery = (user) => ({
  $or: [
    { ownerUserId: user._id },
    ...(user.email ? [{ ownerEmail: user.email }, { sellerContactEmail: user.email }] : []),
    ...(user.hotelId ? [{ _id: user.hotelId }] : []),
    ...(user.sellerId ? [{ sellerId: user.sellerId }] : []),
  ],
});

const isPaidBooking = (booking) =>
  Boolean(booking?.detailsUnlocked)
  || PAID_PAYMENT_STATUSES.has(String(booking?.paymentStatus || "").toLowerCase())
  || ["deposit-paid", "provider-details-unlocked"].includes(String(booking?.status || "").toLowerCase());

const isUnpaidCloseable = (booking) => {
  if (isPaidBooking(booking)) return false;
  const payment = String(booking?.paymentStatus || "unpaid").toLowerCase();
  return UNPAID_PAYMENT_STATUSES.has(payment);
};

async function collectSellerInventory(user) {
  const hotels = await Hotel.find(sellerHotelQuery(user)).select("_id name").lean();
  const hotelIds = hotels.map((item) => item._id);
  const nestedServices = hotelIds.length
    ? await HotelService.find({ hotelId: { $in: hotelIds } }).select("_id name hotelId").lean()
    : [];
  return { hotels, hotelIds, nestedServices };
}

async function collectSellerBlockingBookings(hotelIds) {
  if (!hotelIds.length) return [];
  return Booking.find({
    $or: [{ hotelId: { $in: hotelIds } }, { preferredHotelId: { $in: hotelIds } }],
    status: { $in: [...SELLER_BLOCKING_BOOKING_STATUSES] },
  })
    .select("_id bookingCode status paymentStatus hotelId preferredHotelId")
    .lean();
}

async function collectCustomerPendingBookings(userId) {
  return Booking.find({
    touristId: userId,
    status: { $in: [...CUSTOMER_PENDING_STATUSES] },
  })
    .select("_id bookingCode status paymentStatus")
    .lean();
}

async function collectCustomerPaidActiveBookings(userId) {
  return Booking.find({
    touristId: userId,
    status: { $nin: ["cancelled", "rejected", "completed"] },
  })
    .select("_id bookingCode status paymentStatus detailsUnlocked")
    .lean()
    .then((rows) => rows.filter(isPaidBooking));
}

async function collectCustomerUnpaidBookings(userId) {
  return Booking.find({
    touristId: userId,
    status: { $nin: ["cancelled", "rejected", "completed"] },
  })
    .select("_id bookingCode status paymentStatus detailsUnlocked availabilityReservation hotelId preferredHotelId serviceOptionId")
    .then(async (rows) => {
      const unpaid = rows.filter(isUnpaidCloseable);
      return unpaid;
    });
}

/**
 * Preview blockers for the profile UI (no mutation).
 */
async function getAccountDeletionStatus(user) {
  const role = String(user?.role || "").toLowerCase();

  if (role === "admin") {
    return {
      canDelete: false,
      role,
      code: "ADMIN_SELF_DELETE_FORBIDDEN",
      message: "Admin accounts cannot be self-deleted. Ask another admin if an account must be removed.",
      blockers: {
        services: 0,
        pendingBookings: 0,
        paidBookings: 0,
        unpaidBookings: 0,
      },
      redirect: null,
    };
  }

  if (SELLER_ROLES.has(role)) {
    const { hotels, hotelIds, nestedServices } = await collectSellerInventory(user);
    const serviceCount = hotels.length + nestedServices.length;
    const blockingBookings = await collectSellerBlockingBookings(hotelIds);
    const canDelete = serviceCount === 0 && blockingBookings.length === 0;

    return {
      canDelete,
      role,
      code: !canDelete
        ? (serviceCount > 0 ? "PROVIDER_MUST_DELETE_SERVICES" : "PROVIDER_HAS_PENDING_ACTIVITY")
        : "READY",
      message: canDelete
        ? "Your provider account can be permanently deleted."
        : serviceCount > 0
          ? "Delete all of your services first, then return here to delete your account."
          : "You still have pending or active bookings on your listings. Resolve or complete them before deleting your account.",
      blockers: {
        services: serviceCount,
        hotels: hotels.length,
        nestedServices: nestedServices.length,
        pendingBookings: blockingBookings.length,
        paidBookings: 0,
        unpaidBookings: 0,
      },
      samples: {
        services: [...hotels, ...nestedServices].slice(0, 5).map((item) => item.name || String(item._id)),
        bookings: blockingBookings.slice(0, 5).map((item) => item.bookingCode || String(item._id)),
      },
      redirect: serviceCount > 0 ? "seller_services" : null,
    };
  }

  if (CUSTOMER_ROLES.has(role) || role === "tourHelper") {
    const [pending, paidActive, unpaid] = await Promise.all([
      collectCustomerPendingBookings(user._id),
      collectCustomerPaidActiveBookings(user._id),
      collectCustomerUnpaidBookings(user._id),
    ]);
    const canDelete = pending.length === 0 && paidActive.length === 0;

    return {
      canDelete,
      role,
      code: !canDelete
        ? (paidActive.length ? "CUSTOMER_HAS_PAID_ACTIVITY" : "CUSTOMER_HAS_PENDING_BOOKINGS")
        : "READY",
      message: canDelete
        ? unpaid.length
          ? `Your account can be deleted. ${unpaid.length} unpaid booking(s) will be marked failed and released.`
          : "Your account can be permanently deleted."
        : paidActive.length
          ? "You have paid or unlocked bookings still in progress. Finish or cancel those with support before deleting."
          : "You have pending bookings awaiting review or approval. Resolve them before deleting your account.",
      blockers: {
        services: 0,
        pendingBookings: pending.length,
        paidBookings: paidActive.length,
        unpaidBookings: unpaid.length,
      },
      samples: {
        pending: pending.slice(0, 5).map((item) => item.bookingCode || String(item._id)),
        paid: paidActive.slice(0, 5).map((item) => item.bookingCode || String(item._id)),
        unpaid: unpaid.slice(0, 5).map((item) => item.bookingCode || String(item._id)),
      },
      redirect: null,
    };
  }

  return {
    canDelete: false,
    role,
    code: "UNSUPPORTED_ROLE",
    message: "This account type cannot be self-deleted.",
    blockers: { services: 0, pendingBookings: 0, paidBookings: 0, unpaidBookings: 0 },
    redirect: null,
  };
}

async function failUnpaidCustomerBookings(userId) {
  const unpaid = await collectCustomerUnpaidBookings(userId);
  let failedCount = 0;
  for (const booking of unpaid) {
    const doc = await Booking.findById(booking._id);
    if (!doc || isPaidBooking(doc)) continue;
    await releaseBookingHold(doc, { reservationStatus: "released" });
    doc.status = "cancelled";
    doc.paymentStatus = "failed";
    doc.adminResponseMessage = "Customer deleted their account. Unpaid booking was cancelled and capacity released.";
    doc.cancelledAt = new Date();
    await doc.save();
    await Transaction.updateMany(
      {
        bookingId: doc._id,
        status: "pending",
      },
      {
        $set: {
          status: "failed",
        },
      }
    ).catch(() => {});
    emitUserRealtime(userId, REALTIME_EVENTS.BOOKING_CHANGED, {
      action: "account-deleted-unpaid-failed",
      bookingId: doc._id,
    });
    failedCount += 1;
  }
  return failedCount;
}

async function deleteSellerShell(user) {
  const { hotels, hotelIds } = await collectSellerInventory(user);
  if (hotels.length || hotelIds.length) {
    throw Object.assign(new Error("PROVIDER_MUST_DELETE_SERVICES"), { status: 409 });
  }
  try {
    const Supplier = require("../models/Supplier");
    await Supplier.deleteMany({
      $or: [
        { ownerUserId: user._id },
        ...(user.email ? [{ email: user.email }] : []),
        ...(user.sellerId ? [{ sellerId: user.sellerId }] : []),
      ],
    });
  } catch (_error) {
    // Optional model / no-op.
  }
}

/**
 * Permanently delete the authenticated user's account after policy checks.
 */
async function deleteAccountForUser(user) {
  const status = await getAccountDeletionStatus(user);
  if (!status.canDelete) {
    const error = new Error(status.message);
    error.status = status.code === "ADMIN_SELF_DELETE_FORBIDDEN" ? 403 : 409;
    error.code = status.code;
    error.details = status;
    throw error;
  }

  const role = String(user.role || "").toLowerCase();
  let unpaidFailed = 0;

  if (CUSTOMER_ROLES.has(role) || role === "tourHelper") {
    unpaidFailed = await failUnpaidCustomerBookings(user._id);
    // Remove remaining terminal / historical bookings owned by this tourist.
    await Booking.deleteMany({ touristId: user._id });
  }

  if (SELLER_ROLES.has(role)) {
    await deleteSellerShell(user);
  }

  await User.deleteOne({ _id: user._id });

  emitRealtime(REALTIME_EVENTS.CATALOG_CHANGED, { reason: "account-deleted", userId: String(user._id) });

  return {
    deleted: true,
    role,
    unpaidBookingsFailed: unpaidFailed,
    message: "Account deleted permanently.",
  };
}

module.exports = {
  getAccountDeletionStatus,
  deleteAccountForUser,
  SELLER_ROLES,
  CUSTOMER_ROLES,
};
