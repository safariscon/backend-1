const test = require("node:test");
const assert = require("node:assert/strict");
const Hotel = require("../src/models/Hotel");
const { updateBusinessVerification, getServiceDetail } = require("../src/controllers/adminController");
const {
  serializeAdminServiceDetail,
  serializeAdminServiceListItem,
  resolveApprovalStatus,
} = require("../src/utils/adminServiceView");

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

const listing = {
  _id: "6a801e8b33074243a4c093f2",
  name: "Theoneste Hotel service",
  type: "hotel-rooms",
  description: "Rooms in Kigali",
  approvalStatus: "pending",
  status: "available",
  images: ["https://cdn.example.com/one.jpg", "https://cdn.example.com/two.jpg"],
  location: "Gasabo, Kigali",
  locationDetails: { province: "Kigali City", district: "Gasabo", sector: "Kacyiru" },
  serviceLocation: {
    name: "Kigali Heights",
    formattedAddress: "KG 7 Ave, Kigali, Rwanda",
    latitude: -1.9497,
    longitude: 30.0919,
    placeId: "osm:N:123",
    locationSource: "search",
    isExactLocationVerified: true,
    province: "Kigali City",
    district: "Gasabo",
    sector: "Kacyiru",
  },
  ownerUserId: {
    _id: "provider-1",
    name: "Theoneste Provider",
    email: "provider@example.com",
    phone: "0780000000",
    sellerId: "SP123",
  },
  sellerContactEmail: "provider@example.com",
};

test("admin list item exposes provider name for the services table", () => {
  const row = serializeAdminServiceListItem(listing, listing.ownerUserId);
  assert.equal(row.providerName, "Theoneste Provider");
  assert.equal(row.provider.sellerId, "SP123");
  assert.equal(row.providerEmail, "provider@example.com");
});

test("admin service detail includes images, map pin, and provider", () => {
  const detail = serializeAdminServiceDetail(listing, { provider: listing.ownerUserId });
  assert.equal(detail.images.length, 2);
  assert.equal(detail.images[0].url, "https://cdn.example.com/one.jpg");
  assert.equal(detail.map.hasPin, true);
  assert.equal(detail.map.latitude, -1.9497);
  assert.match(detail.map.googleMapsUrl, /google\.com\/maps/);
  assert.equal(detail.provider.name, "Theoneste Provider");
  assert.equal(detail.review.hasExactCoordinates, true);
});

test("approval status is read from body, action, or /approve path", () => {
  assert.equal(resolveApprovalStatus({ body: { status: "approved" } }), "approved");
  assert.equal(resolveApprovalStatus({ body: { action: "reject" } }), "rejected");
  assert.equal(
    resolveApprovalStatus({ body: {}, path: "/api/admin/services/abc/approve" }),
    "approved"
  );
});

test("PUT /api/admin/services/:serviceId/approval updates the listing", async (context) => {
  const originalFindByIdAndUpdate = Hotel.findByIdAndUpdate;
  const business = {
    ...listing,
    commissionPercentage: 5,
    async populate() {
      this.ownerUserId = listing.ownerUserId;
      return this;
    },
  };

  Hotel.findByIdAndUpdate = async (id, update) => {
    assert.equal(id, listing._id);
    business.approvalStatus = update.$set.approvalStatus;
    business.status = update.$set.status;
    return business;
  };

  context.after(() => {
    Hotel.findByIdAndUpdate = originalFindByIdAndUpdate;
  });

  const result = response();
  await updateBusinessVerification(
    {
      params: { serviceId: listing._id },
      body: { status: "approved", commissionPercentage: 5 },
      path: `/api/admin/services/${listing._id}/approval`,
      user: { _id: "admin-1", role: "admin" },
    },
    result
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.service.approvalStatus, "approved");
  assert.equal(result.body.business.provider.name, "Theoneste Provider");
});

test("GET service detail returns 404 when the listing is missing", async (context) => {
  const originalFindById = Hotel.findById;
  Hotel.findById = () => ({
    lean: async () => null,
  });
  context.after(() => {
    Hotel.findById = originalFindById;
  });

  const result = response();
  await getServiceDetail({ params: { serviceId: listing._id } }, result);
  assert.equal(result.statusCode, 404);
});
