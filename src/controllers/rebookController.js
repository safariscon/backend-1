const crypto = require("crypto");
const mongoose = require("mongoose");
const Booking = require("../models/Booking");
const Hotel = require("../models/Hotel");
const SiteSetting = require("../models/SiteSetting");
const AuditLog = require("../models/AuditLog");
const RebookRequest = require("../models/RebookRequest");
const { REALTIME_EVENTS, emitHotelRealtime, emitRealtime, emitUserRealtime } = require("../utils/realtime");
const { releaseBookingHold } = require("../services/bookingHoldService");

const DEFAULT_SETTINGS = Object.freeze({ requestDeadlineHours: 24, rebookIdValidityHours: 72 });
const ACTIVE_REBOOK_STATUSES = ["pending", "approved", "rebook_id_generated"];
const INELIGIBLE_BOOKING_STATUSES = ["completed", "cancelled", "rejected"];
const DEPOSIT_PAID_STATUSES = ["deposit_paid", "deposit-paid", "paid"];

const cleanReason = (value) => String(value || "").trim().replace(/\s+/g, " ").slice(0, 1500);
const normalizeCode = (value) => String(value || "").trim().toUpperCase();
const timeline = (event, actor, message = "") => ({
  event,
  message,
  actorId: actor?._id || actor?.id || null,
  actorRole: actor?.role || "system",
  at: new Date(),
});

const normalizeRebookSettings = (value = {}) => {
  const configuredDeadline = Number(value.requestDeadlineHours);
  const configuredValidity = Number(value.rebookIdValidityHours);
  return {
    requestDeadlineHours: Math.max(0, Math.min(2160, Number.isFinite(configuredDeadline) ? configuredDeadline : DEFAULT_SETTINGS.requestDeadlineHours)),
    rebookIdValidityHours: Math.max(1, Math.min(2160, Number.isFinite(configuredValidity) && configuredValidity > 0 ? configuredValidity : DEFAULT_SETTINGS.rebookIdValidityHours)),
  };
};

const getRebookSettings = async (serviceId = null) => {
  if (serviceId) {
    const service = await Hotel.findById(serviceId).select("rebookSettings").lean();
    if (service?.rebookSettings) return normalizeRebookSettings(service.rebookSettings);
  }
  const setting = await SiteSetting.findOne({ key: "rebook-settings" }).lean();
  return normalizeRebookSettings(setting?.value || {});
};

const resolveBookingDate = (booking) => {
  const details = booking?.bookingDetails || {};
  const value = details.bookingDate || details.startDate || details.pickupDate || booking?.checkIn;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const writeAudit = async ({ action, actor, request, bookingId, businessId, metadata = {} }) => {
  if (AuditLog.db.readyState !== 1) return;
  await AuditLog.create({
    action,
    actorId: actor?._id || actor?.id || null,
    actorRole: actor?.role || "system",
    bookingId: bookingId || request?.originalBookingId || null,
    businessId: businessId || request?.serviceId || null,
    metadata: { rebookRequestId: request?._id, rebookId: request?.rebookId || "", ...metadata },
  });
};

const notifyChange = (request, action) => {
  const payload = { action, requestId: request._id, bookingId: request.originalBookingId, status: request.status };
  emitUserRealtime(request.customerId?._id || request.customerId, REALTIME_EVENTS.BOOKING_CHANGED, payload);
  if (request.serviceId) emitHotelRealtime(request.serviceId?._id || request.serviceId, REALTIME_EVENTS.BOOKING_CHANGED, payload);
  if (request.sellerId) emitUserRealtime(request.sellerId?._id || request.sellerId, REALTIME_EVENTS.NOTIFICATION, payload);
  emitRealtime(REALTIME_EVENTS.NOTIFICATION, payload);
};

const expireOneRequest = async ({ request, message, action = "expired" }) => {
  const expiredRequest = await RebookRequest.findOneAndUpdate(
    { _id: request._id, status: request.status, usedAt: null },
    {
      $set: { status: "expired" },
      $unset: { activeKey: 1, redemptionClaimToken: 1, redemptionClaimExpiresAt: 1 },
      $push: { auditLogs: timeline("request_expired", null, message) },
    },
    { new: true }
  );
  if (!expiredRequest) return null;
  await writeAudit({ action: "rebook-request-expired", request: expiredRequest });
  notifyChange(expiredRequest, action);
  return expiredRequest;
};

const sendDeadlineReminder = async ({ request, now }) => {
  const remindedRequest = await RebookRequest.findOneAndUpdate(
    {
      _id: request._id,
      status: request.status,
      reminderSent: { $ne: true },
      deadlineAt: { $gt: now },
      usedAt: null,
    },
    {
      $set: { reminderSent: true, reminderSentAt: now },
      $push: { auditLogs: timeline("deadline_reminder_sent", null, "Customer was reminded before the booking change deadline.") },
    },
    { new: true }
  );
  if (!remindedRequest) return null;
  notifyChange(remindedRequest, "deadline-reminder");
  return remindedRequest;
};

const expireRequests = async (filter = {}) => {
  const now = new Date();
  const summary = await runRebookExpiryCleanup({ filter, now });
  return summary;
};

const runRebookExpiryCleanup = async ({ filter = {}, now = new Date() } = {}) => {
  const summary = { pendingExpired: 0, cancelExpired: 0, generatedIdExpired: 0 };

  const reminderDue = await RebookRequest.find({
    ...filter,
    status: { $in: ["pending", "cancel_requested"] },
    deadlineAt: { $gt: now },
    reminderSent: { $ne: true },
    usedAt: null,
  });

  for (const request of reminderDue) {
    await sendDeadlineReminder({ request, now });
  }

  const deadlineExpired = await RebookRequest.find({
    ...filter,
    status: { $in: ["pending", "cancel_requested"] },
    deadlineAt: { $lte: now },
    usedAt: null,
  });

  for (const request of deadlineExpired) {
    const expiredRequest = await expireOneRequest({
      request,
      message: "The booking change request deadline passed before admin approval.",
      action: "deadline-expired",
    });
    if (!expiredRequest) continue;
    if (request.requestType === "cancel" || request.status === "cancel_requested") summary.cancelExpired += 1;
    else summary.pendingExpired += 1;
  }

  const generatedIdExpired = await RebookRequest.find({
    ...filter,
    status: { $in: ["approved", "rebook_id_generated"] },
    expiresAt: { $ne: null, $lte: now },
    usedAt: null,
  });

  for (const request of generatedIdExpired) {
    const expiredRequest = await expireOneRequest({
      request,
      message: "The Re-book ID reached its expiry time.",
    });
    if (!expiredRequest) continue;
    summary.generatedIdExpired += 1;
  }

  return summary;
};

const populateRequest = (query) => query
  .populate("customerId", "name email phone")
  .populate("sellerId", "name email sellerId")
  .populate("serviceId", "name businessName type ownerUserId location images primaryImage")
  .populate("originalBookingId", "bookingCode bookingDetails checkIn createdAt totalPrice depositAmount amountPaid paymentStatus status")
  .populate("newBookingId", "bookingCode status paymentStatus createdAt");

const listPage = async (query, req) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));
  const [requests, total] = await Promise.all([
    populateRequest(RebookRequest.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)),
    RebookRequest.countDocuments(query),
  ]);
  return { requests, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } };
};

const createRequest = async (req, res) => {
  try {
    const originalBookingId = req.body.originalBookingId || req.body.bookingId;
    const requestType = String(req.body.requestType || "").toLowerCase();
    const reason = cleanReason(req.body.reason);
    if (!originalBookingId) return res.status(400).json({ message: "Original booking is required." });
    if (!mongoose.isValidObjectId(originalBookingId)) return res.status(400).json({ message: "Original booking ID is invalid." });
    if (!["rebook", "cancel"].includes(requestType)) return res.status(400).json({ message: "Choose Re-book or Cancel." });
    if (reason.length < 3) return res.status(400).json({ message: "Please provide a reason or message." });

    const booking = await Booking.findOne({ _id: originalBookingId, touristId: req.user._id });
    if (!booking) return res.status(404).json({ message: "Booking not found or does not belong to this customer." });
    if (!DEPOSIT_PAID_STATUSES.includes(booking.paymentStatus)) {
      return res.status(409).json({ message: "A paid deposit is required before requesting a booking change." });
    }
    if (INELIGIBLE_BOOKING_STATUSES.includes(booking.status)) {
      return res.status(409).json({ message: "This booking is no longer eligible for changes." });
    }
    if (requestType === "rebook" && (booking.originalBookingId || booking.rebookRequestId)) {
      return res.status(409).json({ message: "A re-booked booking cannot be re-booked again." });
    }
    const serviceId = booking.hotelId || booking.preferredHotelId;
    if (!serviceId) return res.status(409).json({ message: "This booking has no assigned service provider." });

    const bookingDate = resolveBookingDate(booking);
    if (!bookingDate) return res.status(409).json({ message: "The original booking has no valid service date." });
    const settings = await getRebookSettings(serviceId);
    const deadlineAt = new Date(bookingDate.getTime() - settings.requestDeadlineHours * 60 * 60 * 1000);
    if (Date.now() > deadlineAt.getTime()) {
      return res.status(409).json({ message: `The change deadline passed ${settings.requestDeadlineHours} hours before the booking date.` });
    }

    const previousApprovedRebook = requestType === "rebook" && await RebookRequest.exists({
      originalBookingId: booking._id,
      requestType: "rebook",
      $or: [
        { status: { $in: ["approved", "rebook_id_generated", "used"] } },
        { rebookId: { $exists: true, $ne: "" } },
      ],
    });
    if (previousApprovedRebook) return res.status(409).json({ message: "Re-book is allowed only once for this original booking." });
    const existingActive = await RebookRequest.exists({ activeKey: `${booking._id}:active` });
    if (existingActive) return res.status(409).json({ message: "An active change request already exists for this booking." });

    const business = await Hotel.findById(serviceId).select("ownerUserId");
    const sellerId = business?.ownerUserId || null;
    const now = new Date();
    const status = requestType === "cancel" ? "cancel_requested" : "pending";
    const request = await RebookRequest.create({
      originalBookingId: booking._id,
      customerId: req.user._id,
      sellerId,
      serviceId,
      requestType,
      reason,
      status,
      activeKey: `${booking._id}:active`,
      deadlineAt,
      refundStatus: requestType === "cancel" ? "pending" : "not_applicable",
      sellerNotified: Boolean(sellerId),
      sellerNotifiedAt: sellerId ? now : null,
      eligibilitySnapshot: {
        bookingExists: true,
        belongsToCustomer: true,
        depositPaid: true,
        beforeDeadline: true,
        originalPaymentStatus: booking.paymentStatus,
        originalBookingStatus: booking.status,
      },
      auditLogs: [
        timeline("reason_submitted", req.user, "Customer submitted a booking change reason."),
        ...(sellerId ? [timeline("seller_notified", null, "Seller was notified automatically.")] : []),
      ],
    });
    await writeAudit({ action: "rebook-request-submitted", actor: req.user, request });
    if (sellerId) await writeAudit({ action: "rebook-seller-notified", request });
    notifyChange(request, "submitted");
    return res.status(201).json({ message: "Your booking change request was submitted for review.", request: await populateRequest(RebookRequest.findById(request._id)) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: "An active change request already exists for this booking." });
    return res.status(500).json({ message: "Failed to submit booking change request.", error: error.message });
  }
};

const listCustomerRequests = async (req, res) => {
  try {
    await expireRequests({ customerId: req.user._id });
    return res.json(await listPage({ customerId: req.user._id }, req));
  } catch (error) {
    return res.status(500).json({ message: "Failed to load your booking change requests.", error: error.message });
  }
};

const listSellerRequests = async (req, res) => {
  try {
    const serviceIds = await Hotel.find({ ownerUserId: req.user._id }).distinct("_id");
    const query = { sellerId: req.user._id, serviceId: { $in: serviceIds } };
    await expireRequests(query);
    return res.json(await listPage(query, req));
  } catch (error) {
    return res.status(500).json({ message: "Failed to load seller Re-book requests.", error: error.message });
  }
};

const listAdminRequests = async (req, res) => {
  try {
    await expireRequests();
    const query = req.query.status ? { status: req.query.status } : {};
    const result = await listPage(query, req);
    const counts = await RebookRequest.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
    const byStatus = Object.fromEntries(counts.map((item) => [item._id, item.count]));
    return res.json({ ...result, overview: {
      pending: (byStatus.pending || 0) + (byStatus.cancel_requested || 0),
      approvedRebook: (byStatus.approved || 0) + (byStatus.rebook_id_generated || 0),
      used: byStatus.used || 0,
      cancelled: (byStatus.refund_requested || 0) + (byStatus.refund_approved || 0),
      expired: byStatus.expired || 0,
      refunded: byStatus.refund_approved || 0,
    } });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load admin Re-book requests.", error: error.message });
  }
};

const createUniqueRebookId = async () => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = `RBK-${new Date().getFullYear()}-${String(crypto.randomInt(0, 1000000)).padStart(6, "0")}`;
    if (!(await RebookRequest.exists({ rebookId: code }))) return code;
  }
  throw new Error("Could not generate a unique Re-book ID.");
};

const approveRequest = async (req, res) => {
  try {
    const current = await RebookRequest.findById(req.params.id);
    if (!current) return res.status(404).json({ message: "Request not found." });
    const now = new Date();
    let update;
    if (current.requestType === "rebook") {
      if (current.status !== "pending") return res.status(409).json({ message: "Only pending Re-book requests can be approved." });
      const settings = await getRebookSettings(current.serviceId);
      update = {
        $set: { status: "rebook_id_generated", rebookId: await createUniqueRebookId(), approvedAt: now, expiresAt: new Date(now.getTime() + settings.rebookIdValidityHours * 3600000), adminReviewedBy: req.user._id },
        $push: { auditLogs: { $each: [timeline("admin_approved", req.user, "Admin approved the Re-book request."), timeline("rebook_id_generated", req.user, "A one-time Re-book ID was generated.")] } },
      };
    } else {
      if (current.status !== "cancel_requested") return res.status(409).json({ message: "Only pending cancellation requests can be approved." });
      update = {
        $set: { status: "refund_requested", approvedAt: now, adminReviewedBy: req.user._id, refundStatus: "pending" },
        $push: { auditLogs: timeline("admin_approved", req.user, "Admin approved cancellation and requested the partial refund.") },
      };
    }
    const request = await RebookRequest.findOneAndUpdate({ _id: current._id, status: current.status }, update, { new: true });
    if (!request) return res.status(409).json({ message: "This request changed while it was being reviewed." });
    await writeAudit({ action: current.requestType === "rebook" ? "rebook-request-approved" : "cancel-request-approved", actor: req.user, request });
    if (current.requestType === "rebook") await writeAudit({ action: "rebook-id-generated", actor: req.user, request });
    notifyChange(request, "approved");
    return res.json({ message: current.requestType === "rebook" ? "Re-book approved and one-time ID generated." : "Cancellation approved. The partial refund is ready for approval.", request: await populateRequest(RebookRequest.findById(request._id)) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: "Re-book ID collision. Please approve again." });
    return res.status(500).json({ message: "Failed to approve request.", error: error.message });
  }
};

const rejectRequest = async (req, res) => {
  try {
    const reason = cleanReason(req.body.reason || "Request did not meet the change policy.");
    const now = new Date();
    const request = await RebookRequest.findOneAndUpdate(
      { _id: req.params.id, status: { $in: ["pending", "cancel_requested", "refund_requested"] } },
      { $set: { status: "rejected", rejectedAt: now, adminReviewedBy: req.user._id }, $unset: { activeKey: 1 }, $push: { auditLogs: timeline("admin_rejected", req.user, reason) } },
      { new: true }
    );
    if (!request) return res.status(409).json({ message: "This request cannot be rejected in its current status." });
    await writeAudit({ action: "rebook-request-rejected", actor: req.user, request, metadata: { reason } });
    notifyChange(request, "rejected");
    return res.json({ message: "Request rejected.", request: await populateRequest(RebookRequest.findById(request._id)) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to reject request.", error: error.message });
  }
};

const approveRefund = async (req, res) => {
  try {
    const current = await RebookRequest.findOne({ _id: req.params.id, requestType: "cancel", status: "refund_requested", refundedAt: null }).populate("originalBookingId");
    if (!current) return res.status(409).json({ message: "Refund is unavailable or has already been processed." });
    const booking = current.originalBookingId;
    const paidDeposit = Math.max(0, Math.min(Number(booking.amountPaid || 0), Number(booking.depositAmount || Number(booking.totalPrice || 0) * 0.3)));
    const refundAmount = Math.round(paidDeposit * 0.2);
    if (!refundAmount) return res.status(409).json({ message: "No paid deposit is available for refund." });
    const now = new Date();
    const refundReference = `RFD-${new Date().getFullYear()}-${String(crypto.randomInt(0, 1000000)).padStart(6, "0")}`;
    const request = await RebookRequest.findOneAndUpdate(
      { _id: current._id, status: "refund_requested", refundedAt: null },
      { $set: { status: "refund_approved", refundStatus: "approved", refundAmount, refundReference, refundedAt: now, adminReviewedBy: req.user._id }, $unset: { activeKey: 1 }, $push: { auditLogs: timeline("refund_approved", req.user, `Refund approved: ${refundAmount} RWF (20% of the paid deposit).`) } },
      { new: true }
    );
    if (!request) return res.status(409).json({ message: "Refund was already processed." });
    await Booking.updateOne({ _id: booking._id }, { $set: { status: "cancelled", "cancellation.cancelledAt": now, "cancellation.refundAmount": refundAmount } });
    try {
      await releaseBookingHold(booking);
    } catch (error) {
      console.warn("Failed to release nights for refunded booking:", error.message);
    }
    await writeAudit({ action: "rebook-refund-approved", actor: req.user, request, metadata: { refundAmount, refundReference, formula: "20% of paid 30% deposit" } });
    notifyChange(request, "refund-approved");
    return res.json({ message: `Refund approved for ${refundAmount.toLocaleString()} RWF.`, request: await populateRequest(RebookRequest.findById(request._id)) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to approve refund.", error: error.message });
  }
};

const confirmUnavailable = async (req, res) => {
  try {
    const ownedRequest = await RebookRequest.findOne({ _id: req.params.id, sellerId: req.user._id }).select("serviceId");
    if (!ownedRequest || !(await Hotel.exists({ _id: ownedRequest.serviceId, ownerUserId: req.user._id }))) {
      return res.status(404).json({ message: "Request not found for one of your services." });
    }
    const request = await RebookRequest.findOneAndUpdate(
      { _id: req.params.id, sellerId: req.user._id, status: { $in: ["pending", "cancel_requested"] } },
      { $set: { sellerConfirmedUnavailable: true, sellerConfirmedUnavailableAt: new Date() }, $push: { auditLogs: timeline("seller_confirmed_unavailable", req.user, "Seller confirmed the original date is unavailable.") } },
      { new: true }
    );
    if (!request) return res.status(404).json({ message: "Request not found for this seller or cannot be updated." });
    await writeAudit({ action: "rebook-seller-confirmed-unavailable", actor: req.user, request });
    notifyChange(request, "seller-confirmed-unavailable");
    return res.json({ message: "Unavailability confirmed for admin review.", request: await populateRequest(RebookRequest.findById(request._id)) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to confirm unavailability.", error: error.message });
  }
};

const markSellerNotified = async (req, res) => {
  try {
    const request = await RebookRequest.findByIdAndUpdate(
      req.params.id,
      { $set: { sellerNotified: true, sellerNotifiedAt: new Date() }, $push: { auditLogs: timeline("seller_notified", req.user, "Admin marked the seller as notified.") } },
      { new: true }
    );
    if (!request) return res.status(404).json({ message: "Request not found." });
    await writeAudit({ action: "rebook-seller-notified", actor: req.user, request });
    notifyChange(request, "seller-notified");
    return res.json({ message: "Seller marked as notified.", request: await populateRequest(RebookRequest.findById(request._id)) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update seller notification.", error: error.message });
  }
};

const verifyRebookId = async (req, res) => {
  try {
    const rebookId = normalizeCode(req.body.rebookId);
    if (!rebookId) return res.status(400).json({ message: "Enter a Re-book ID." });
    await expireRequests({ rebookId });
    const request = await populateRequest(RebookRequest.findOne({ rebookId, customerId: req.user._id }));
    if (!request) return res.status(404).json({ message: "Re-book ID was not found for this account." });
    if (request.status !== "rebook_id_generated" || request.usedAt) return res.status(409).json({ message: "This Re-book ID is no longer available." });
    if (!request.expiresAt || request.expiresAt <= new Date()) return res.status(409).json({ message: "This Re-book ID has expired." });
    const requestedServiceId = req.body.serviceId;
    if (requestedServiceId && String(request.serviceId?._id || request.serviceId) !== String(requestedServiceId)) {
      return res.status(403).json({ message: "This Re-book ID is valid only for the original service." });
    }
    return res.json({ valid: true, message: "Re-book ID verified. Complete the normal booking form.", request });
  } catch (error) {
    return res.status(500).json({ message: "Failed to verify Re-book ID.", error: error.message });
  }
};

const getSettings = async (_req, res) => {
  try {
    return res.json({ settings: await getRebookSettings() });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load Re-book settings.", error: error.message });
  }
};

const updateSettings = async (req, res) => {
  try {
    const requestDeadlineHours = Math.max(0, Math.min(2160, Number(req.body.requestDeadlineHours)));
    const rebookIdValidityHours = Math.max(1, Math.min(2160, Number(req.body.rebookIdValidityHours)));
    if (!Number.isFinite(requestDeadlineHours) || !Number.isFinite(rebookIdValidityHours)) return res.status(400).json({ message: "Enter valid deadline hours." });
    const settings = { requestDeadlineHours, rebookIdValidityHours };
    await SiteSetting.findOneAndUpdate({ key: "rebook-settings" }, { $set: { value: settings } }, { upsert: true, new: true });
    await writeAudit({ action: "rebook-settings-updated", actor: req.user, metadata: settings });
    return res.json({ message: "Re-book deadlines updated.", settings });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update Re-book settings.", error: error.message });
  }
};

const claimRebookId = async ({ rebookId, customerId, serviceId }) => {
  const code = normalizeCode(rebookId);
  if (!code) return null;
  await expireRequests({ rebookId: code });
  const claimToken = crypto.randomBytes(24).toString("hex");
  const now = new Date();
  const request = await RebookRequest.findOneAndUpdate(
    {
      rebookId: code,
      customerId,
      serviceId,
      status: "rebook_id_generated",
      usedAt: null,
      expiresAt: { $gt: now },
      $or: [{ redemptionClaimExpiresAt: null }, { redemptionClaimExpiresAt: { $lte: now } }],
    },
    { $set: { redemptionClaimToken: claimToken, redemptionClaimExpiresAt: new Date(now.getTime() + 5 * 60 * 1000) } },
    { new: true }
  ).select("+redemptionClaimToken +redemptionClaimExpiresAt");
  if (!request) {
    const error = new Error("Re-book ID is invalid, expired, used, already in progress, or belongs to another service.");
    error.status = 409;
    throw error;
  }
  return { requestId: request._id, claimToken, originalBookingId: request.originalBookingId };
};

const finalizeRebookIdUse = async ({ requestId, claimToken, newBookingId, actor }) => {
  const now = new Date();
  const request = await RebookRequest.findOneAndUpdate(
    { _id: requestId, redemptionClaimToken: claimToken, status: "rebook_id_generated", usedAt: null },
    { $set: { status: "used", usedAt: now, newBookingId }, $unset: { activeKey: 1, redemptionClaimToken: 1, redemptionClaimExpiresAt: 1 }, $push: { auditLogs: timeline("rebook_id_used", actor, "Customer used the one-time Re-book ID.") } },
    { new: true }
  );
  if (!request) throw new Error("The Re-book ID claim could not be completed.");
  await writeAudit({ action: "rebook-id-used", actor, request, bookingId: newBookingId, metadata: { originalBookingId: request.originalBookingId } });
  notifyChange(request, "used");
  return request;
};

const releaseRebookIdClaim = async (claim) => {
  if (!claim?.requestId || !claim?.claimToken) return;
  await RebookRequest.updateOne(
    { _id: claim.requestId, redemptionClaimToken: claim.claimToken, usedAt: null },
    { $unset: { redemptionClaimToken: 1, redemptionClaimExpiresAt: 1 } }
  );
};

module.exports = {
  createRequest,
  listCustomerRequests,
  listSellerRequests,
  listAdminRequests,
  approveRequest,
  rejectRequest,
  approveRefund,
  verifyRebookId,
  confirmUnavailable,
  markSellerNotified,
  getSettings,
  updateSettings,
  runRebookExpiryCleanup,
  claimRebookId,
  finalizeRebookIdUse,
  releaseRebookIdClaim,
};
