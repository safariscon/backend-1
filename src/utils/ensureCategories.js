const ServiceCategory = require("../models/ServiceCategory");
const { CATEGORY_SEED } = require("./categorySeed");
const { normalizeFieldSchema } = require("./fieldSchema");

const ensureSeededCategories = async () => {
  const count = await ServiceCategory.countDocuments();
  if (count > 0) return { seeded: false, count };

  const docs = CATEGORY_SEED.map((item) => ({
    ...item,
    listingFieldSchema: normalizeFieldSchema(item.listingFieldSchema, "listing"),
    optionFieldSchema: normalizeFieldSchema(item.optionFieldSchema, "option"),
    bookingFieldSchema: normalizeFieldSchema(item.bookingFieldSchema, "booking"),
  }));
  await ServiceCategory.insertMany(docs);
  return { seeded: true, count: docs.length };
};

module.exports = { ensureSeededCategories };
