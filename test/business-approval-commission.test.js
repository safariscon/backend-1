const test = require("node:test");
const assert = require("node:assert/strict");
const Hotel = require("../src/models/Hotel");
const ServiceOption = require("../src/models/ServiceOption");
const Room = require("../src/models/Room");
const HotelService = require("../src/models/HotelService");
const ServiceAvailability = require("../src/models/ServiceAvailability");
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

const chainLean = (value) => ({
  sort() {
    return this;
  },
  lean: async () => value,
});

test("admin business approval stores commission percentage for service provider terms", async (context) => {
  const originalFindById = Hotel.findById;
  const originalOptionCount = ServiceOption.countDocuments;
  const originalOptionFind = ServiceOption.find;
  const originalRoomFind = Room.find;
  const originalHotelServiceFind = HotelService.find;
  const originalAvailabilityFind = ServiceAvailability.find;

  const business = {
    _id: "business-1",
    name: "Lake Kivu Stay",
    sellerContactEmail: "seller@example.com",
    ownerEmail: "seller@example.com",
    commissionPercentage: 7,
    supportsOptions: false,
    bookingRules: {},
    async populate() {
      this.ownerUserId = { name: "Service Provider", email: "seller@example.com" };
      return this;
    },
    async save() {
      return this;
    },
  };

  Hotel.findById = async () => business;
  ServiceOption.countDocuments = async () => 0;
  ServiceOption.find = () => chainLean([]);
  Room.find = () => chainLean([]);
  HotelService.find = () => chainLean([]);
  ServiceAvailability.find = () => chainLean([]);

  context.after(() => {
    Hotel.findById = originalFindById;
    ServiceOption.countDocuments = originalOptionCount;
    ServiceOption.find = originalOptionFind;
    Room.find = originalRoomFind;
    HotelService.find = originalHotelServiceFind;
    ServiceAvailability.find = originalAvailabilityFind;
  });

  const result = response();
  await updateBusinessVerification(
    {
      params: { businessId: "business-1" },
      body: { status: "approved", cancelPenaltyPercent: 20, platformCommissionPercent: 7 },
      user: { _id: "admin-1", role: "admin" },
    },
    result
  );

  assert.equal(result.statusCode, 200);
  assert.equal(business.commissionPercentage, 7);
  assert.equal(result.body.business.commissionPercentage, 7);
  assert.match(result.body.message, /posted publicly/i);
});
