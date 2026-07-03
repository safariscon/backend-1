const crypto = require("crypto");
const mongoose = require("mongoose");
const AnalyticsEvent = require("../models/AnalyticsEvent");
const { EVENT_TYPES } = require("../models/AnalyticsEvent");

const clean = (value, max = 500) => String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const objectIdOrNull = (value) => mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null;

const deviceFromUserAgent = (userAgent) => {
  const ua = String(userAgent || "");
  if (/ipad|tablet|kindle|silk/i.test(ua)) return "tablet";
  if (/mobile|iphone|ipod|android/i.test(ua)) return "mobile";
  return ua ? "desktop" : "unknown";
};

const browserFromUserAgent = (userAgent) => {
  const ua = String(userAgent || "");
  if (/edg\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/chrome|crios/i.test(ua)) return "Chrome";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/safari/i.test(ua)) return "Safari";
  return "Unknown";
};

const hashIp = (req) => {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwarded || req.ip || req.socket?.remoteAddress || "";
  if (!ip) return "";
  return crypto.createHmac("sha256", process.env.ANALYTICS_HASH_SALT || process.env.JWT_SECRET || "analytics")
    .update(ip)
    .digest("hex");
};

const buildEventData = (req, overrides = {}) => {
  const eventType = overrides.eventType || req.body?.eventType;
  if (!EVENT_TYPES.includes(eventType)) throw Object.assign(new Error("Unsupported analytics event type."), { status: 400 });
  const userAgent = req.headers?.["user-agent"] || "";
  return {
    eventType,
    userId: req.user?._id || null,
    sessionId: clean(overrides.sessionId || req.body?.sessionId, 120),
    serviceId: objectIdOrNull(overrides.serviceId || req.body?.serviceId),
    bookingId: objectIdOrNull(overrides.bookingId || req.body?.bookingId),
    paymentId: objectIdOrNull(overrides.paymentId || req.body?.paymentId),
    role: clean(req.user?.role || overrides.role || "guest", 40),
    pageUrl: clean(overrides.pageUrl || req.body?.pageUrl, 500),
    deviceType: deviceFromUserAgent(userAgent),
    browser: browserFromUserAgent(userAgent),
    ipHash: hashIp(req),
  };
};

const recordAnalyticsEvent = async (data) => {
  if (AnalyticsEvent.db.readyState !== 1) return null;
  try {
    return await AnalyticsEvent.create(data);
  } catch (_error) {
    return null;
  }
};

const trackEvent = async (req, res) => {
  try {
    const event = await AnalyticsEvent.create(buildEventData(req));
    return res.status(201).json({ tracked: true, eventId: event._id });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Event could not be tracked." });
  }
};

const parseDateRange = (query = {}) => {
  const now = new Date();
  const end = query.endDate ? new Date(query.endDate + "T23:59:59.999Z") : now;
  let start;
  if (query.range === "custom" && query.startDate) start = new Date(query.startDate + "T00:00:00.000Z");
  else {
    const days = query.range === "today" ? 1 : query.range === "7d" ? 7 : 30;
    start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    start.setUTCHours(0, 0, 0, 0);
  }
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    throw Object.assign(new Error("Invalid analytics date range."), { status: 400 });
  }
  return { start, end };
};

const eventSummary = (rows = []) => {
  const summary = Object.fromEntries(EVENT_TYPES.map((type) => [type, 0]));
  rows.forEach((row) => { summary[row._id] = Number(row.count || 0); });
  return summary;
};

const getAnalyticsOverview = async (req, res) => {
  try {
    const { start, end } = parseDateRange(req.query);
    const match = { createdAt: { $gte: start, $lte: end } };
    const [result] = await AnalyticsEvent.aggregate([
      { $match: match },
      { $facet: {
        eventCounts: [{ $group: { _id: "$eventType", count: { $sum: 1 } } }],
        uniqueVisitors: [
          { $match: { eventType: "APP_VISIT" } },
          { $group: { _id: { $cond: [{ $ne: ["$userId", null] }, { $concat: ["user:", { $toString: "$userId" }] }, { $concat: ["session:", "$sessionId"] }] } } },
          { $count: "count" },
        ],
        daily: [
          { $group: { _id: { date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } }, eventType: "$eventType" }, count: { $sum: 1 } } },
          { $sort: { "_id.date": 1 } },
        ],
      } },
    ]);
    const summary = eventSummary(result?.eventCounts);
    const dailyMap = new Map();
    (result?.daily || []).forEach((row) => {
      const item = dailyMap.get(row._id.date) || { date: row._id.date, visits: 0, serviceViews: 0, payClicks: 0, paymentSuccess: 0 };
      if (row._id.eventType === "APP_VISIT") item.visits = row.count;
      if (row._id.eventType === "SERVICE_VIEW") item.serviceViews = row.count;
      if (row._id.eventType === "PAY_DEPOSIT_CLICKED") item.payClicks = row.count;
      if (row._id.eventType === "PAYMENT_SUCCESS") item.paymentSuccess = row.count;
      dailyMap.set(row._id.date, item);
    });
    return res.json({
      range: { start, end },
      summary: {
        totalVisits: summary.APP_VISIT,
        uniqueVisitors: Number(result?.uniqueVisitors?.[0]?.count || 0),
        serviceViews: summary.SERVICE_VIEW,
        bookingFormsOpened: summary.BOOKING_FORM_OPENED,
        bookingsSubmitted: summary.BOOKING_SUBMITTED,
        payDepositClicks: summary.PAY_DEPOSIT_CLICKED,
        successfulPayments: summary.PAYMENT_SUCCESS,
        failedPayments: summary.PAYMENT_FAILED,
      },
      trends: [...dailyMap.values()],
      funnel: {
        serviceViews: summary.SERVICE_VIEW,
        bookingFormsOpened: summary.BOOKING_FORM_OPENED,
        bookingsSubmitted: summary.BOOKING_SUBMITTED,
        payDepositClicks: summary.PAY_DEPOSIT_CLICKED,
        successfulPayments: summary.PAYMENT_SUCCESS,
      },
    });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Analytics overview could not be loaded." });
  }
};

const getAnalyticsServices = async (req, res) => {
  try {
    const { start, end } = parseDateRange(req.query);
    const services = await AnalyticsEvent.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end }, serviceId: { $ne: null }, eventType: { $in: ["SERVICE_VIEW", "BOOKING_FORM_OPENED", "BOOKING_SUBMITTED", "PAY_DEPOSIT_CLICKED", "PAYMENT_SUCCESS"] } } },
      { $group: {
        _id: "$serviceId",
        views: { $sum: { $cond: [{ $eq: ["$eventType", "SERVICE_VIEW"] }, 1, 0] } },
        bookingFormOpened: { $sum: { $cond: [{ $eq: ["$eventType", "BOOKING_FORM_OPENED"] }, 1, 0] } },
        bookingSubmitted: { $sum: { $cond: [{ $eq: ["$eventType", "BOOKING_SUBMITTED"] }, 1, 0] } },
        payDepositClicked: { $sum: { $cond: [{ $eq: ["$eventType", "PAY_DEPOSIT_CLICKED"] }, 1, 0] } },
        paymentSuccess: { $sum: { $cond: [{ $eq: ["$eventType", "PAYMENT_SUCCESS"] }, 1, 0] } },
      } },
      { $sort: { views: -1, bookingSubmitted: -1 } },
      { $limit: 50 },
      { $lookup: { from: "hotels", localField: "_id", foreignField: "_id", as: "service" } },
      { $unwind: { path: "$service", preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "users", localField: "service.ownerUserId", foreignField: "_id", as: "seller" } },
      { $project: {
        serviceId: "$_id",
        serviceName: { $ifNull: ["$service.name", "Deleted service"] },
        category: { $ifNull: ["$service.type", "Unknown"] },
        seller: { $ifNull: [{ $arrayElemAt: ["$seller.name", 0] }, "$service.sellerContactEmail", "-"] },
        views: 1, bookingFormOpened: 1, bookingSubmitted: 1, payDepositClicked: 1, paymentSuccess: 1,
      } },
    ]);
    return res.json({ range: { start, end }, services });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Service analytics could not be loaded." });
  }
};

const getAnalyticsPayments = async (req, res) => {
  try {
    const { start, end } = parseDateRange(req.query);
    const rows = await AnalyticsEvent.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end }, eventType: { $in: ["PAY_DEPOSIT_CLICKED", "PAYMENT_SUCCESS", "PAYMENT_FAILED"] } } },
      { $group: { _id: "$eventType", count: { $sum: 1 } } },
    ]);
    const summary = eventSummary(rows);
    return res.json({
      range: { start, end },
      payDepositClicks: summary.PAY_DEPOSIT_CLICKED,
      successfulPayments: summary.PAYMENT_SUCCESS,
      failedPayments: summary.PAYMENT_FAILED,
      conversionPercent: summary.PAY_DEPOSIT_CLICKED ? Number(((summary.PAYMENT_SUCCESS / summary.PAY_DEPOSIT_CLICKED) * 100).toFixed(1)) : 0,
    });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Payment analytics could not be loaded." });
  }
};

module.exports = {
  trackEvent,
  getAnalyticsOverview,
  getAnalyticsServices,
  getAnalyticsPayments,
  buildEventData,
  parseDateRange,
  recordAnalyticsEvent,
};
