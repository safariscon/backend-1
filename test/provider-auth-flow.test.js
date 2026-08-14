const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const User = require("../src/models/User");
const Hotel = require("../src/models/Hotel");
const { createSeller } = require("../src/controllers/adminController");
const {
  completeProviderRegistration,
  getProviderOnboarding,
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
  const originalHotelCreate = Hotel.create;
  const originalHotelFindById = Hotel.findById;
  const originalRandomInt = crypto.randomInt;
  let storedHotel = null;

  User.findOne = async (query) => {
    if (!storedUser) return null;
    if (query.email && query.email !== storedUser.email) return null;
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
  Hotel.findById = (id) => {
    const hotel = storedHotel && String(storedHotel._id) === String(id) ? storedHotel : null;
    const query = Promise.resolve(hotel);
    query.select = async () => hotel;
    return query;
  };
  Hotel.create = async (data) => {
    storedHotel = { ...data, _id: "507f1f77bcf86cd799439099", async save() { return this; } };
    return storedHotel;
  };

  context.after(() => {
    User.findOne = originalFindOne;
    User.create = originalCreate;
    User.exists = originalExists;
    Hotel.create = originalHotelCreate;
    Hotel.findById = originalHotelFindById;
    crypto.randomInt = originalRandomInt;
  });

  const createResponse = response();
  await createSeller(
    { body: { providerName: "Demo Provider", providerEmail: "provider@example.com" } },
    createResponse
  );
  assert.equal(createResponse.statusCode, 201);
  assert.match(createResponse.body.credentials.sellerId, /^SP\d{3,4}$/);
  assert.match(createResponse.body.credentials.registrationUrl, /\/provider-register\?sellerId=SP/);
  assert.equal(createResponse.body.credentials.generatedPassword, undefined);
  assert.equal(storedUser.password, "");
  assert.equal(storedUser.mustSetPassword, true);

  const previewResponse = response();
  await getProviderOnboarding(
    { params: {}, query: { sellerId: createResponse.body.credentials.sellerId } },
    previewResponse
  );
  assert.equal(previewResponse.statusCode, 200);
  assert.equal(previewResponse.body.providerName, "Demo Provider");
  assert.equal(previewResponse.body.providerEmail, "provider@example.com");
  assert.equal(previewResponse.body.autocomplete.sellerId, createResponse.body.credentials.sellerId);
  assert.equal(previewResponse.body.fields.providerName.readOnly, true);
  assert.equal(previewResponse.body.fields.providerEmail.readOnly, true);

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
        phone: "0788302208",
        businessName: "Demo Lodge",
        businessType: "hotel",
        location: "Musanze, Rwanda",
        description: "Mountain lodge",
        payoutDetails: {
          method: "momo",
          providerId: "63510",
          accountName: "Demo Provider",
          accountNumber: "0788302208",
        },
        acceptedTerms: true,
      },
    },
    completionResponse
  );
  assert.equal(completionResponse.statusCode, 200);
  assert.equal(completionResponse.body.user.sellerId, createResponse.body.credentials.sellerId);
  assert.equal(completionResponse.body.business, null);
  assert.equal(storedUser.mustSetPassword, false);
  assert.equal(storedUser.termsAccepted, true);
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

test("provider completes registration with seller ID and password only", async (context) => {
  process.env.JWT_SECRET = "provider-auth-flow-test-secret";
  const storedUser = {
    _id: "507f1f77bcf86cd799439011",
    name: "Demo Provider",
    email: "provider@example.com",
    sellerId: "SP321",
    role: "hotel",
    password: "",
    mustSetPassword: true,
    hotelId: null,
    async save() {},
  };
  const originalFindOne = User.findOne;
  const originalHotelCreate = Hotel.create;
  const originalHotelFindById = Hotel.findById;
  let storedHotel = null;
  User.findOne = async (query) => {
    if (query.sellerId && query.sellerId !== storedUser.sellerId) return null;
    if (query.mustSetPassword !== undefined && query.mustSetPassword !== storedUser.mustSetPassword) return null;
    if (query.role?.$in && !query.role.$in.includes(storedUser.role)) return null;
    return storedUser;
  };
  Hotel.findById = (id) => {
    const hotel = storedHotel && String(storedHotel._id) === String(id) ? storedHotel : null;
    const query = Promise.resolve(hotel);
    query.select = async () => hotel;
    return query;
  };
  Hotel.create = async () => {
    throw new Error("Completing provider registration must not create a default service listing.");
  };
  context.after(() => {
    User.findOne = originalFindOne;
    Hotel.create = originalHotelCreate;
    Hotel.findById = originalHotelFindById;
  });

  const completionResponse = response();
  await completeProviderRegistration(
    {
      body: {
        sellerId: "SP321",
        newPassword: "NewProviderPassword123!",
        confirmPassword: "NewProviderPassword123!",
        acceptedTerms: true,
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

  assert.equal(completionResponse.statusCode, 200);
  assert.equal(storedUser.mustSetPassword, false);
  assert.equal(storedUser.hotelId, null);
  assert.equal(completionResponse.body.business, null);
  assert.equal(completionResponse.body.user.email, "provider@example.com");
  assert.equal(completionResponse.body.user.name, "Demo Provider");
});
