const test = require("node:test");
const assert = require("node:assert/strict");
const RebookRequest = require("../src/models/RebookRequest");
const { runRebookExpiryCleanup } = require("../src/controllers/rebookController");

const past = new Date("2026-07-01T00:00:00.000Z");
const now = new Date("2026-07-07T00:00:00.000Z");
const future = new Date("2026-07-10T00:00:00.000Z");

const matchesValue = (actual, expected) => {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    if (expected.$in && !expected.$in.includes(actual)) return false;
    if (Object.prototype.hasOwnProperty.call(expected, "$ne") && actual === expected.$ne) return false;
    if (expected.$lte && !(actual <= expected.$lte)) return false;
    if (expected.$gt && !(actual > expected.$gt)) return false;
    return true;
  }
  return actual === expected;
};

const matchesFilter = (record, filter) => Object.entries(filter).every(([key, expected]) => matchesValue(record[key], expected));

const installRebookRequestMock = (context, records) => {
  const originalFind = RebookRequest.find;
  const originalFindOneAndUpdate = RebookRequest.findOneAndUpdate;

  RebookRequest.find = async (filter) => records.filter((record) => matchesFilter(record, filter));
  RebookRequest.findOneAndUpdate = async (filter, update) => {
    const record = records.find((item) => matchesFilter(item, filter));
    if (!record) return null;

    Object.assign(record, update.$set || {});
    Object.keys(update.$unset || {}).forEach((key) => { delete record[key]; });
    if (update.$push?.auditLogs) record.auditLogs.push(update.$push.auditLogs);
    return record;
  };

  context.after(() => {
    RebookRequest.find = originalFind;
    RebookRequest.findOneAndUpdate = originalFindOneAndUpdate;
  });
};

test("re-book expiry cleanup expires stale deadline and generated ID records only once", async (context) => {
  const records = [
    { _id: "pending-past", requestType: "rebook", status: "pending", deadlineAt: past, usedAt: null, activeKey: "a", auditLogs: [] },
    { _id: "cancel-past", requestType: "cancel", status: "cancel_requested", deadlineAt: past, usedAt: null, activeKey: "b", auditLogs: [] },
    { _id: "id-past", requestType: "rebook", status: "rebook_id_generated", deadlineAt: past, expiresAt: past, usedAt: null, activeKey: "c", redemptionClaimToken: "claim", auditLogs: [] },
    { _id: "pending-future", requestType: "rebook", status: "pending", deadlineAt: future, usedAt: null, activeKey: "d", auditLogs: [] },
    { _id: "rejected-past", requestType: "rebook", status: "rejected", deadlineAt: past, usedAt: null, activeKey: "e", auditLogs: [] },
    { _id: "refunded-past", requestType: "cancel", status: "refund_approved", deadlineAt: past, refundedAt: past, usedAt: null, activeKey: "f", auditLogs: [] },
    { _id: "used-past", requestType: "rebook", status: "used", deadlineAt: past, expiresAt: past, usedAt: past, activeKey: "g", auditLogs: [] },
    { _id: "finalized-past", requestType: "rebook", status: "rebook_id_generated", deadlineAt: past, expiresAt: past, usedAt: past, newBookingId: "booking", activeKey: "h", auditLogs: [] },
    { _id: "completed-past", requestType: "rebook", status: "completed", deadlineAt: past, expiresAt: past, usedAt: null, activeKey: "i", auditLogs: [] },
  ];

  installRebookRequestMock(context, records);

  assert.deepEqual(await runRebookExpiryCleanup({ now }), {
    pendingExpired: 1,
    cancelExpired: 1,
    generatedIdExpired: 1,
  });

  assert.equal(records.find((record) => record._id === "pending-past").status, "expired");
  assert.equal(records.find((record) => record._id === "cancel-past").status, "expired");
  assert.equal(records.find((record) => record._id === "id-past").status, "expired");
  assert.equal(records.find((record) => record._id === "pending-past").activeKey, undefined);
  assert.equal(records.find((record) => record._id === "id-past").redemptionClaimToken, undefined);
  assert.equal(records.find((record) => record._id === "pending-past").auditLogs.length, 1);
  assert.equal(records.find((record) => record._id === "id-past").auditLogs.length, 1);

  assert.equal(records.find((record) => record._id === "pending-future").status, "pending");
  assert.equal(records.find((record) => record._id === "pending-future").reminderSent, true);
  assert.equal(records.find((record) => record._id === "pending-future").reminderSentAt, now);
  assert.equal(records.find((record) => record._id === "rejected-past").status, "rejected");
  assert.equal(records.find((record) => record._id === "refunded-past").status, "refund_approved");
  assert.equal(records.find((record) => record._id === "used-past").status, "used");
  assert.equal(records.find((record) => record._id === "finalized-past").status, "rebook_id_generated");
  assert.equal(records.find((record) => record._id === "completed-past").status, "completed");

  assert.deepEqual(await runRebookExpiryCleanup({ now }), {
    pendingExpired: 0,
    cancelExpired: 0,
    generatedIdExpired: 0,
  });
  assert.equal(records.find((record) => record._id === "pending-past").auditLogs.length, 1);
  assert.equal(records.find((record) => record._id === "id-past").auditLogs.length, 1);
  assert.equal(records.find((record) => record._id === "pending-future").auditLogs.length, 1);
});

test("re-book deadline reminder is sent once before deadline", async (context) => {
  const records = [
    { _id: "pending-future", requestType: "rebook", status: "pending", deadlineAt: future, usedAt: null, reminderSent: false, auditLogs: [] },
    { _id: "cancel-future", requestType: "cancel", status: "cancel_requested", deadlineAt: future, usedAt: null, auditLogs: [] },
    { _id: "already-reminded", requestType: "rebook", status: "pending", deadlineAt: future, usedAt: null, reminderSent: true, reminderSentAt: past, auditLogs: [] },
    { _id: "past-deadline", requestType: "rebook", status: "pending", deadlineAt: past, usedAt: null, reminderSent: false, auditLogs: [] },
    { _id: "generated-id", requestType: "rebook", status: "rebook_id_generated", deadlineAt: future, expiresAt: future, usedAt: null, reminderSent: false, auditLogs: [] },
    { _id: "used-request", requestType: "rebook", status: "pending", deadlineAt: future, usedAt: past, reminderSent: false, auditLogs: [] },
  ];

  installRebookRequestMock(context, records);

  await runRebookExpiryCleanup({ now });

  assert.equal(records.find((record) => record._id === "pending-future").reminderSent, true);
  assert.equal(records.find((record) => record._id === "pending-future").reminderSentAt, now);
  assert.equal(records.find((record) => record._id === "cancel-future").reminderSent, true);
  assert.equal(records.find((record) => record._id === "already-reminded").reminderSentAt, past);
  assert.equal(records.find((record) => record._id === "past-deadline").reminderSent, false);
  assert.equal(records.find((record) => record._id === "generated-id").reminderSent, false);
  assert.equal(records.find((record) => record._id === "used-request").reminderSent, false);
  assert.equal(records.find((record) => record._id === "pending-future").auditLogs.length, 1);
  assert.equal(records.find((record) => record._id === "cancel-future").auditLogs.length, 1);

  await runRebookExpiryCleanup({ now });

  assert.equal(records.find((record) => record._id === "pending-future").auditLogs.length, 1);
  assert.equal(records.find((record) => record._id === "cancel-future").auditLogs.length, 1);
});
