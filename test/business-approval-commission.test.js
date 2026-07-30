const test = require("node:test");
const assert = require("node:assert/strict");
const Hotel = require("../src/models/Hotel");
const { updateBusinessVerification } = require("../src/controllers/adminController");

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("admin business approval stores commission percentage for service provider terms", async (context) => {
  const originalFindByIdAndUpdate = Hotel.findByIdAndUpdate;
  let savedUpdate = null;
  const business = {
    _id: "business-1",
    name: "Lake Kivu Stay",
    sellerContactEmail: "seller@example.com",
    ownerEmail: "seller@example.com",
    commissionPercentage: 7,
    async populate() {
      this.ownerUserId = { name: "Service Provider", email: "seller@example.com" };
      return this;
    },
  };

  Hotel.findByIdAndUpdate = async (_id, update) => {
    savedUpdate = update;
    business.approvalStatus = update.$set.approvalStatus;
    business.status = update.$set.status;
    business.commissionPercentage = update.$set.commissionPercentage;
    return business;
  };

  context.after(() => {
    Hotel.findByIdAndUpdate = originalFindByIdAndUpdate;
  });

  const result = response();
  await updateBusinessVerification(
    {
      params: { businessId: "business-1" },
      body: { status: "approved", commissionPercentage: 7 },
      user: { _id: "admin-1", role: "admin" },
    },
    result
  );

  assert.equal(result.statusCode, 200);
  assert.equal(savedUpdate.$set.commissionPercentage, 7);
  assert.equal(result.body.business.commissionPercentage, 7);
  assert.match(result.body.message, /posted publicly/i);
});
