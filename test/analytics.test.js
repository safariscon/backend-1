const test = require("node:test");
const assert = require("node:assert/strict");
const AnalyticsEvent = require("../src/models/AnalyticsEvent");
const {
  buildEventData,
  parseDateRange,
  trackEvent,
  getAnalyticsOverview,
} = require("../src/controllers/analyticsController");

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("analytics event data uses authenticated identity and stores only a hashed IP", () => {
  const event = buildEventData({
    user: { _id: "507f1f77bcf86cd799439011", role: "customer" },
    body: {
      eventType: "SERVICE_VIEW",
      userId: "507f1f77bcf86cd799439099",
      sessionId: "guest-session",
      serviceId: "507f1f77bcf86cd799439022",
      pageUrl: "/hotel/example",
    },
    headers: { "user-agent": "Mozilla/5.0 (iPhone) Safari/605.1", "x-forwarded-for": "192.0.2.1" },
  });

  assert.equal(String(event.userId), "507f1f77bcf86cd799439011");
  assert.equal(event.role, "customer");
  assert.equal(event.deviceType, "mobile");
  assert.equal(event.browser, "Safari");
  assert.equal(event.ipHash.length, 64);
  assert.equal(event.ip, undefined);
});

test("analytics date filters support today, seven days, and custom ranges", () => {
  const sevenDays = parseDateRange({ range: "7d" });
  const custom = parseDateRange({ range: "custom", startDate: "2026-07-01", endDate: "2026-07-15" });
  assert.ok(sevenDays.end > sevenDays.start);
  assert.equal(custom.start.toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal(custom.end.toISOString(), "2026-07-15T23:59:59.999Z");
});

test("tracking endpoint rejects unsupported event types", async () => {
  const result = response();
  await trackEvent({ body: { eventType: "PASSWORD_TYPED" }, headers: {} }, result);
  assert.equal(result.statusCode, 400);
});

test("admin analytics overview returns summarized counts and daily trends", async (context) => {
  const originalAggregate = AnalyticsEvent.aggregate;
  AnalyticsEvent.aggregate = async () => [{
    eventCounts: [
      { _id: "APP_VISIT", count: 12 },
      { _id: "SERVICE_VIEW", count: 8 },
      { _id: "PAYMENT_SUCCESS", count: 2 },
    ],
    uniqueVisitors: [{ count: 7 }],
    daily: [
      { _id: { date: "2026-07-02", eventType: "APP_VISIT" }, count: 12 },
      { _id: { date: "2026-07-02", eventType: "SERVICE_VIEW" }, count: 8 },
      { _id: { date: "2026-07-02", eventType: "PAYMENT_SUCCESS" }, count: 2 },
    ],
  }];
  context.after(() => { AnalyticsEvent.aggregate = originalAggregate; });

  const result = response();
  await getAnalyticsOverview({ query: { range: "custom", startDate: "2026-07-02", endDate: "2026-07-02" } }, result);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.summary.totalVisits, 12);
  assert.equal(result.body.summary.uniqueVisitors, 7);
  assert.equal(result.body.funnel.successfulPayments, 2);
  assert.equal(result.body.trends[0].serviceViews, 8);
});
