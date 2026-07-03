const test = require("node:test");
const assert = require("node:assert/strict");
const { anonymizeBusinessList } = require("../src/utils/anonymousBusiness");

test("public service data preserves seller-uploaded gallery images", () => {
  const uploadedImages = [
    "https://cdn.example.com/provider/service-1.jpg",
    "https://cdn.example.com/provider/service-2.jpg",
    "https://cdn.example.com/provider/service-3.jpg",
  ];
  const [service] = anonymizeBusinessList([{
    _id: "507f1f77bcf86cd799439055",
    type: "tours",
    location: "Kigali",
    images: uploadedImages,
    promotion: {
      enabled: true,
      title: "Happy Hours!",
      description: "Buy 3 bottles and get 1 free.",
      startAt: new Date("2026-07-01T17:00:00Z"),
      endAt: new Date("2026-07-31T20:00:00Z"),
    },
    approvalStatus: "approved",
    status: "available",
    bookingMode: "automatic",
  }]);

  assert.deepEqual(service.images, uploadedImages);
  assert.equal(service.images[1], uploadedImages[1]);
  assert.equal(service.promotion.title, "Happy Hours!");
  assert.equal(service.bookingMode, "automatic");
});
