process.env.JWT_SECRET = "login-otp-session-test-secret";
process.env.AUTH_OTP_EXPIRY_MINUTES = "10";
process.env.AUTH_OTP_RESEND_COOLDOWN_SECONDS = "0";
process.env.AUTH_OTP_MAX_ATTEMPTS = "5";
process.env.JWT_ACCESS_TTL_SECONDS = "7200";
process.env.JWT_REFRESH_TTL_SECONDS = "86400";

const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const User = require("../src/models/User");
const {
  login,
  verifyLoginOtp,
  refreshSession,
  logout,
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

const createStoredUser = async () => ({
  _id: "507f1f77bcf86cd799439044",
  name: "Session User",
  email: "session@example.com",
  role: "customer",
  password: await bcrypt.hash("Password123!", 10),
  mustSetPassword: false,
  emailVerified: true,
  loginOtpHash: "",
  loginOtpExpiresAt: null,
  loginOtpAttempts: 0,
  loginOtpSentAt: null,
  loginRememberMe: false,
  refreshTokenHash: "",
  refreshTokenExpiresAt: null,
  async save() {},
});

const mockUserLookups = (storedUser) => {
  const originalFindOne = User.findOne;
  const originalFindById = User.findById;
  User.findOne = async (query) => {
    if (query.email !== storedUser.email) return null;
    return storedUser;
  };
  User.findById = async (id) => {
    if (String(id) !== String(storedUser._id)) return null;
    return storedUser;
  };
  return () => {
    User.findOne = originalFindOne;
    User.findById = originalFindById;
  };
};

test("login with rememberMe false issues OTP then access token only", async (context) => {
  const storedUser = await createStoredUser();
  const restoreLookups = mockUserLookups(storedUser);
  const originalRandomInt = crypto.randomInt;
  crypto.randomInt = () => 111222;

  context.after(() => {
    restoreLookups();
    crypto.randomInt = originalRandomInt;
  });

  const loginResponse = response();
  await login(
    { body: { email: "session@example.com", password: "Password123!", rememberMe: false } },
    loginResponse
  );

  assert.equal(loginResponse.statusCode, 200);
  assert.equal(loginResponse.body.code, "LOGIN_OTP_REQUIRED");
  assert.equal(loginResponse.body.rememberMe, false);
  assert.equal(loginResponse.body.expiresInMinutes, 10);
  assert.ok(storedUser.loginOtpHash);

  const verifyResponse = response();
  await verifyLoginOtp(
    { body: { email: "session@example.com", otp: "111222" } },
    verifyResponse
  );

  assert.equal(verifyResponse.statusCode, 200);
  assert.ok(verifyResponse.body.accessToken);
  assert.equal(verifyResponse.body.refreshToken, null);
  assert.equal(verifyResponse.body.rememberMe, false);
  assert.equal(verifyResponse.body.accessTokenExpiresIn, 7200);
  assert.equal(verifyResponse.body.refreshTokenExpiresIn, null);
  assert.equal(storedUser.loginOtpHash, "");
  assert.equal(storedUser.refreshTokenHash, "");

  const accessPayload = jwt.verify(verifyResponse.body.accessToken, process.env.JWT_SECRET);
  assert.equal(accessPayload.type, "access");
  assert.equal(accessPayload.email, "session@example.com");
});

test("login with rememberMe true issues refresh token after OTP", async (context) => {
  const storedUser = await createStoredUser();
  const restoreLookups = mockUserLookups(storedUser);
  const originalRandomInt = crypto.randomInt;
  crypto.randomInt = () => 333444;

  context.after(() => {
    restoreLookups();
    crypto.randomInt = originalRandomInt;
  });

  const loginResponse = response();
  await login(
    { body: { email: "session@example.com", password: "Password123!", rememberMe: true } },
    loginResponse
  );

  assert.equal(loginResponse.statusCode, 200);
  assert.equal(loginResponse.body.rememberMe, true);
  assert.equal(storedUser.loginRememberMe, true);

  const verifyResponse = response();
  await verifyLoginOtp(
    { body: { email: "session@example.com", otp: "333444" } },
    verifyResponse
  );

  assert.equal(verifyResponse.statusCode, 200);
  assert.ok(verifyResponse.body.accessToken);
  assert.ok(verifyResponse.body.refreshToken);
  assert.equal(verifyResponse.body.rememberMe, true);
  assert.equal(verifyResponse.body.refreshTokenExpiresIn, 86400);
  assert.ok(storedUser.refreshTokenHash);

  const refreshPayload = jwt.verify(verifyResponse.body.refreshToken, process.env.JWT_SECRET);
  assert.equal(refreshPayload.type, "refresh");
  assert.equal(String(refreshPayload.id), String(storedUser._id));
});

test("refresh rotates tokens and logout invalidates the refresh token", async (context) => {
  const storedUser = await createStoredUser();
  const restoreLookups = mockUserLookups(storedUser);
  const originalRandomInt = crypto.randomInt;
  crypto.randomInt = () => 555666;

  context.after(() => {
    restoreLookups();
    crypto.randomInt = originalRandomInt;
  });

  await login(
    { body: { email: "session@example.com", password: "Password123!", rememberMe: true } },
    response()
  );

  const verifyResponse = response();
  await verifyLoginOtp(
    { body: { email: "session@example.com", otp: "555666" } },
    verifyResponse
  );
  const originalRefreshToken = verifyResponse.body.refreshToken;
  assert.ok(originalRefreshToken);

  const refreshResponse = response();
  await refreshSession({ body: { refreshToken: originalRefreshToken } }, refreshResponse);

  assert.equal(refreshResponse.statusCode, 200);
  assert.ok(refreshResponse.body.accessToken);
  assert.ok(refreshResponse.body.refreshToken);
  assert.notEqual(refreshResponse.body.refreshToken, originalRefreshToken);

  const reusedResponse = response();
  await refreshSession({ body: { refreshToken: originalRefreshToken } }, reusedResponse);
  assert.equal(reusedResponse.statusCode, 401);

  const logoutResponse = response();
  await logout({ body: { refreshToken: refreshResponse.body.refreshToken } }, logoutResponse);
  assert.equal(logoutResponse.statusCode, 200);
  assert.equal(storedUser.refreshTokenHash, "");

  const afterLogout = response();
  await refreshSession(
    { body: { refreshToken: refreshResponse.body.refreshToken } },
    afterLogout
  );
  assert.equal(afterLogout.statusCode, 401);
});

test("expired or invalid login OTP is rejected", async (context) => {
  const storedUser = await createStoredUser();
  const restoreLookups = mockUserLookups(storedUser);
  const originalRandomInt = crypto.randomInt;
  crypto.randomInt = () => 777888;

  context.after(() => {
    restoreLookups();
    crypto.randomInt = originalRandomInt;
  });

  await login(
    { body: { email: "session@example.com", password: "Password123!" } },
    response()
  );

  const invalidResponse = response();
  await verifyLoginOtp(
    { body: { email: "session@example.com", otp: "000000" } },
    invalidResponse
  );
  assert.equal(invalidResponse.statusCode, 400);
  assert.equal(storedUser.loginOtpAttempts, 1);

  storedUser.loginOtpExpiresAt = new Date(Date.now() - 1000);
  const expiredResponse = response();
  await verifyLoginOtp(
    { body: { email: "session@example.com", otp: "777888" } },
    expiredResponse
  );
  assert.equal(expiredResponse.statusCode, 400);
  assert.match(expiredResponse.body.message, /expired/i);
});
