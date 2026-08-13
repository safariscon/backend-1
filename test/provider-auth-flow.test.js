const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const User = require("../src/models/User");
const { createSeller } = require("../src/controllers/adminController");
const {
  completeProviderRegistration,
  verifyEmailOtp,
  login,
  verifyLoginOtp,
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

test("admin seller ID completes service provider onboarding and email verification enables login", async (context) => {
  process.env.JWT_SECRET = "provider-auth-flow-test-secret";
  process.env.AUTH_OTP_RESEND_COOLDOWN_SECONDS = "0";
  let storedUser = null;
  const originalFindOne = User.findOne;
  const originalCreate = User.create;
  const originalExists = User.exists;
  const originalRandomInt = crypto.randomInt;

  User.findOne = async (query) => {
    if (!storedUser || query.email !== storedUser.email) return null;
    if (query.sellerId && query.sellerId !== storedUser.sellerId) return null;
    if (query.mustSetPassword !== undefined && query.mustSetPassword !== storedUser.mustSetPassword) return null;
    if (query.role?.$in && !query.role.$in.includes(storedUser.role)) return null;
    return storedUser;
  };
  User.exists = async (query) => {
    if (storedUser && query.sellerId === storedUser.sellerId) return { _id: storedUser._id };
    return null;
  };
  User.create = async (data) => {
    storedUser = {
      ...data,
      _id: "507f1f77bcf86cd799439011",
      async save() {},
    };
    return storedUser;
  };
  crypto.randomInt = () => 123456;

  context.after(() => {
    User.findOne = originalFindOne;
    User.create = originalCreate;
    User.exists = originalExists;
    crypto.randomInt = originalRandomInt;
  });

  const createResponse = response();
  await createSeller(
    { body: { providerName: "Demo Provider", providerEmail: "provider@example.com" } },
    createResponse
  );
  assert.equal(createResponse.statusCode, 201);
  assert.match(createResponse.body.credentials.sellerId, /^SP\d{3,4}$/);
  assert.equal(createResponse.body.credentials.generatedPassword, undefined);
  assert.equal(storedUser.password, "");
  assert.equal(storedUser.mustSetPassword, true);

  const blockedLoginResponse = response();
  await login(
    { body: { email: "provider@example.com", password: "NewProviderPassword123!" } },
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
        confirmPassword: newPassword,
      },
    },
    completionResponse
  );
  assert.equal(completionResponse.statusCode, 200);
  assert.equal(completionResponse.body.user.sellerId, createResponse.body.credentials.sellerId);
  assert.equal(storedUser.mustSetPassword, false);
  assert.equal(storedUser.emailVerified, false);
  assert.equal(completionResponse.body.emailVerification.sent, true);

  const unverifiedLoginResponse = response();
  await login(
    { body: { email: "provider@example.com", password: newPassword } },
    unverifiedLoginResponse
  );
  assert.equal(unverifiedLoginResponse.statusCode, 403);
  assert.equal(unverifiedLoginResponse.body.code, "EMAIL_NOT_VERIFIED");

  const verifyResponse = response();
  await verifyEmailOtp({ body: { email: "provider@example.com", otp: "123456" } }, verifyResponse);
  assert.equal(verifyResponse.statusCode, 200);
  assert.equal(storedUser.emailVerified, true);

  const loginResponse = response();
  await login(
    { body: { email: "provider@example.com", password: newPassword } },
    loginResponse
  );
  assert.equal(loginResponse.statusCode, 200);
  assert.equal(loginResponse.body.code, "LOGIN_OTP_REQUIRED");
  assert.ok(storedUser.loginOtpHash);

  const verifyLoginResponse = response();
  await verifyLoginOtp(
    { body: { email: "provider@example.com", otp: "123456" } },
    verifyLoginResponse
  );
  assert.equal(verifyLoginResponse.statusCode, 200);
  assert.equal(verifyLoginResponse.body.user.role, "hotel");
  assert.ok(verifyLoginResponse.body.accessToken);
  assert.equal(verifyLoginResponse.body.refreshToken, null);
});
