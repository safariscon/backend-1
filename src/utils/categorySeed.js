const { listCategoryDefinitions, toSeedDocument } = require("../domains/catalog");

const CATEGORY_SEED = listCategoryDefinitions().map(toSeedDocument);

module.exports = { CATEGORY_SEED };
