const test = require("node:test");
const assert = require("node:assert/strict");
const User = require("../src/models/User");
const { createSeller } = require("../src/controllers/adminController");
const {
  completeProviderRegistration,
  login,
} = require("../src/controllers/authController");

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

test("admin credentials complete provider onboarding and enable login", async (context) => {
  process.env.JWT_SECRET = "provider-auth-flow-test-secret";
  let storedUser = null;
  const originalFindOne = User.findOne;
  const originalCreate = User.create;

  User.findOne = async (query) => {
    if (!storedUser || query.email !== storedUser.email) return null;
    if (query.sellerId && query.sellerId !== storedUser.sellerId) return null;
    if (query.mustSetPassword !== undefined && query.mustSetPassword !== storedUser.mustSetPassword) return null;
    if (query.role?.$in && !query.role.$in.includes(storedUser.role)) return null;
    return storedUser;
  };
  User.create = async (data) => {
    storedUser = {
      ...data,
      _id: "507f1f77bcf86cd799439011",
      async save() {},
    };
    return storedUser;
  };

  context.after(() => {
    User.findOne = originalFindOne;
    User.create = originalCreate;
  });

  const createResponse = response();
  await createSeller(
    { body: { providerName: "Demo Provider", providerEmail: "provider@example.com" } },
    createResponse
  );
  assert.equal(createResponse.statusCode, 201);
  assert.match(createResponse.body.credentials.sellerId, /^SELLER-/);
  assert.ok(createResponse.body.credentials.generatedPassword);
  assert.equal(storedUser.mustSetPassword, true);

  const blockedLoginResponse = response();
  await login(
    { body: { email: "provider@example.com", password: createResponse.body.credentials.generatedPassword } },
    blockedLoginResponse
  );
  assert.equal(blockedLoginResponse.statusCode, 403);

  const newPassword = "NewProviderPassword123!";
  const completionResponse = response();
  await completeProviderRegistration(
    {
      body: {
        ...createResponse.body.credentials,
        newPassword,
      },
    },
    completionResponse
  );
  assert.equal(completionResponse.statusCode, 200);
  assert.equal(completionResponse.body.user.sellerId, createResponse.body.credentials.sellerId);
  assert.equal(storedUser.mustSetPassword, false);

  const loginResponse = response();
  await login(
    { body: { email: "provider@example.com", password: newPassword } },
    loginResponse
  );
  assert.equal(loginResponse.statusCode, 200);
  assert.equal(loginResponse.body.user.role, "hotel");
  assert.ok(loginResponse.body.token);
});
