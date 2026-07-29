process.env.JWT_SECRET = "auth-otp-flow-test-secret";
process.env.AUTH_OTP_EXPIRY_MINUTES = "10";
process.env.AUTH_OTP_RESEND_COOLDOWN_SECONDS = "0";
process.env.AUTH_OTP_MAX_ATTEMPTS = "5";

const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const User = require("../src/models/User");
const {
  registerTourist,
  verifyEmailOtp,
  forgotPassword,
  resetPassword,
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

test("customer registration sends verification OTP and OTP can verify email", async (context) => {
  const originalFindOne = User.findOne;
  const originalCreate = User.create;
  const originalRandomInt = crypto.randomInt;
  let storedUser = null;

  crypto.randomInt = () => 123456;
  User.findOne = async (query) => {
    if (!storedUser || query.email !== storedUser.email) return null;
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
    crypto.randomInt = originalRandomInt;
  });

  const registerResponse = response();
  await registerTourist(
    { body: { name: "Demo Customer", email: "Customer@Example.com", password: "Password123!", role: "customer" } },
    registerResponse
  );

  assert.equal(registerResponse.statusCode, 201);
  assert.equal(registerResponse.body.user.email, "customer@example.com");
  assert.equal(registerResponse.body.user.emailVerified, false);
  assert.equal(registerResponse.body.emailVerification.sent, true);
  assert.ok(storedUser.emailVerificationOtpHash);

  const blockedLoginResponse = response();
  await login(
    { body: { email: "customer@example.com", password: "Password123!" } },
    blockedLoginResponse
  );

  assert.equal(blockedLoginResponse.statusCode, 403);
  assert.equal(blockedLoginResponse.body.code, "EMAIL_NOT_VERIFIED");

  const verifyResponse = response();
  await verifyEmailOtp({ body: { email: "customer@example.com", otp: "123456" } }, verifyResponse);

  assert.equal(verifyResponse.statusCode, 200);
  assert.equal(verifyResponse.body.user.emailVerified, true);
  assert.equal(storedUser.emailVerificationOtpHash, "");

  const loginResponse = response();
  await login(
    { body: { email: "customer@example.com", password: "Password123!" } },
    loginResponse
  );

  assert.equal(loginResponse.statusCode, 200);
  assert.ok(loginResponse.body.token);
});

test("forgot password issues OTP and reset password updates login credentials", async (context) => {
  const originalFindOne = User.findOne;
  const originalRandomInt = crypto.randomInt;
  const oldPassword = "OldPassword123!";
  const newPassword = "NewPassword123!";
  const storedUser = {
    _id: "507f1f77bcf86cd799439022",
    name: "Reset User",
    email: "reset@example.com",
    role: "customer",
    password: await bcrypt.hash(oldPassword, 10),
    mustSetPassword: false,
    emailVerified: true,
    async save() {},
  };

  crypto.randomInt = () => 654321;
  User.findOne = async (query) => {
    if (query.email !== storedUser.email) return null;
    return storedUser;
  };

  context.after(() => {
    User.findOne = originalFindOne;
    crypto.randomInt = originalRandomInt;
  });

  const forgotResponse = response();
  await forgotPassword({ body: { email: "reset@example.com" } }, forgotResponse);

  assert.equal(forgotResponse.statusCode, 200);
  assert.ok(storedUser.passwordResetOtpHash);

  const resetResponse = response();
  await resetPassword(
    { body: { email: "reset@example.com", otp: "654321", newPassword } },
    resetResponse
  );

  assert.equal(resetResponse.statusCode, 200);
  assert.equal(storedUser.passwordResetOtpHash, "");
  assert.equal(await bcrypt.compare(newPassword, storedUser.password), true);

  const loginResponse = response();
  await login({ body: { email: "reset@example.com", password: newPassword } }, loginResponse);

  assert.equal(loginResponse.statusCode, 200);
  assert.ok(loginResponse.body.token);
});

test("login blocks every unverified role after valid password", async (context) => {
  const originalFindOne = User.findOne;
  const storedUser = {
    _id: "507f1f77bcf86cd799439033",
    name: "Unverified Seller",
    email: "seller@example.com",
    role: "hotel",
    password: await bcrypt.hash("SellerPassword123!", 10),
    mustSetPassword: false,
    emailVerified: false,
    async save() {},
  };

  User.findOne = async (query) => {
    if (query.email !== storedUser.email) return null;
    return storedUser;
  };

  context.after(() => {
    User.findOne = originalFindOne;
  });

  const loginResponse = response();
  await login(
    { body: { email: "seller@example.com", password: "SellerPassword123!" } },
    loginResponse
  );

  assert.equal(loginResponse.statusCode, 403);
  assert.equal(loginResponse.body.code, "EMAIL_NOT_VERIFIED");
});
