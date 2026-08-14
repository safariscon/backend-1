process.env.JWT_SECRET = "terms-acceptance-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const User = require("../src/models/User");
const { registerTourist, completeProviderRegistration, acceptTerms } = require("../src/controllers/authController");
const { hasAcceptedTerms } = require("../src/utils/terms");
const { protect } = require("../src/middleware/authMiddleware");
const { generateAccessToken } = require("../src/utils/auth");

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

test("hasAcceptedTerms reads the register checkbox aliases", () => {
  assert.equal(hasAcceptedTerms({}), false);
  assert.equal(hasAcceptedTerms({ acceptedTerms: false }), false);
  assert.equal(hasAcceptedTerms({ acceptedTerms: true }), true);
  assert.equal(hasAcceptedTerms({ termsAccepted: "yes" }), true);
  assert.equal(hasAcceptedTerms({ acceptedTerms: true, acceptedPrivacy: false }), false);
});

test("customer registration without terms is rejected and does not save the user", async (context) => {
  const originalFindOne = User.findOne;
  const originalCreate = User.create;
  let created = false;

  User.findOne = async () => null;
  User.create = async () => {
    created = true;
    throw new Error("User.create must not run when terms are not accepted.");
  };

  context.after(() => {
    User.findOne = originalFindOne;
    User.create = originalCreate;
  });

  const missingResponse = response();
  await registerTourist(
    { body: { name: "No Terms", email: "noterms@example.com", password: "Password123!", role: "customer" } },
    missingResponse
  );

  assert.equal(missingResponse.statusCode, 400);
  assert.equal(missingResponse.body.code, "TERMS_NOT_ACCEPTED");
  assert.equal(created, false);

  const declinedResponse = response();
  await registerTourist(
    {
      body: {
        name: "No Terms",
        email: "noterms@example.com",
        password: "Password123!",
        role: "customer",
        acceptedTerms: false,
      },
    },
    declinedResponse
  );

  assert.equal(declinedResponse.statusCode, 400);
  assert.equal(declinedResponse.body.code, "TERMS_NOT_ACCEPTED");
  assert.equal(created, false);
});

test("provider cannot complete registration without accepting terms", async (context) => {
  const originalFindOne = User.findOne;
  const storedUser = {
    _id: "507f1f77bcf86cd799439033",
    name: "Demo Provider",
    email: "provider-terms@example.com",
    sellerId: "SP1001",
    role: "hotel",
    mustSetPassword: true,
    password: "",
    termsAccepted: false,
    async save() {},
  };

  User.findOne = async () => storedUser;
  context.after(() => {
    User.findOne = originalFindOne;
  });

  const completionResponse = response();
  await completeProviderRegistration(
    {
      body: {
        providerName: "Demo Provider",
        providerEmail: "provider-terms@example.com",
        sellerId: "SP1001",
        newPassword: "NewProviderPassword123!",
        confirmPassword: "NewProviderPassword123!",
        phone: "0788302208",
        businessName: "Demo Lodge",
        payoutDetails: {
          method: "momo",
          providerId: "63510",
          accountName: "Demo Provider",
          accountNumber: "0788302208",
        },
      },
    },
    completionResponse
  );

  assert.equal(completionResponse.statusCode, 400);
  assert.equal(completionResponse.body.code, "TERMS_NOT_ACCEPTED");
  assert.equal(storedUser.mustSetPassword, true);
  assert.equal(storedUser.termsAccepted, false);
});

test("accept-terms stores the agreement on an existing user", async () => {
  const storedUser = {
    _id: "507f1f77bcf86cd799439044",
    name: "Legacy User",
    email: "legacy@example.com",
    role: "customer",
    hotelId: null,
    supplierId: null,
    sellerId: "",
    phone: "",
    emailVerified: true,
    termsAccepted: false,
    termsAcceptedAt: null,
    async save() {},
  };

  const acceptResponse = response();
  await acceptTerms({ user: storedUser, body: { acceptedTerms: true } }, acceptResponse);

  assert.equal(acceptResponse.statusCode, 200);
  assert.equal(storedUser.termsAccepted, true);
  assert.ok(storedUser.termsAcceptedAt);
  assert.equal(acceptResponse.body.user.termsAccepted, true);
});

test("protected routes reject users who have not accepted terms", async (context) => {
  const originalFindById = User.findById;
  const user = {
    _id: "507f1f77bcf86cd799439055",
    email: "blocked@example.com",
    role: "customer",
    termsAccepted: false,
  };

  User.findById = () => ({
    select: async () => user,
  });
  context.after(() => {
    User.findById = originalFindById;
  });

  const token = generateAccessToken(user);
  const blocked = response();
  let nextCalled = false;
  await protect(
    { headers: { authorization: `Bearer ${token}` } },
    blocked,
    () => {
      nextCalled = true;
    }
  );

  assert.equal(nextCalled, false);
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.body.code, "TERMS_NOT_ACCEPTED");
});
