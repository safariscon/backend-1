const ServiceCategory = require("../models/ServiceCategory");
const { listCategoryDefinitions, toSeedDocument } = require("../domains/catalog");
const { normalizeFieldSchema } = require("./fieldSchema");

const toPersisted = (definition) => {
  const seed = toSeedDocument(definition);
  return {
    ...seed,
    listingFieldSchema: normalizeFieldSchema(seed.listingFieldSchema, "listing"),
    optionFieldSchema: normalizeFieldSchema(seed.optionFieldSchema, "option"),
    bookingFieldSchema: normalizeFieldSchema(seed.bookingFieldSchema, "booking"),
  };
};

const ensureSeededCategories = async () => {
  const definitions = listCategoryDefinitions();
  const slugs = definitions.map((item) => item.slug);
  let upserts = 0;

  for (const definition of definitions) {
    const doc = toPersisted(definition);
    const result = await ServiceCategory.updateOne(
      { slug: definition.slug },
      { $set: doc },
      { upsert: true }
    );
    if (result.upsertedCount || result.modifiedCount) upserts += 1;
  }

  const deactivated = await ServiceCategory.updateMany(
    { slug: { $nin: slugs } },
    { $set: { isActive: false } }
  );

  return {
    seeded: upserts > 0,
    count: definitions.length,
    deactivated: deactivated.modifiedCount || 0,
  };
};

module.exports = { ensureSeededCategories };
