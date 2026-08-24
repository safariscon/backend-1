const { getCategoryDefinition, listCategoryDefinitions, DOMAIN_LABELS, toSeedDocument } = require("./catalog");
const accommodation = require("./accommodation");
const { calculateStayQuote, sanitizeListingAttributesForPublic } = accommodation;
const transport = require("./transport");
const experiences = require("./experiences");
const dining = require("./dining");
const venues = require("./venues");
const { fail, asObject } = require("./shared/helpers");
const {
  normalizePaymentPolicy,
  normalizeCancellationPolicy,
  splitBookingAmounts,
  policyFromListing,
} = require("./shared/policies");

const MODULES = { accommodation, transport, experiences, dining, venues };

const resolveSlug = (value) => String(value || "").trim().toLowerCase();

const resolveDefinition = (categoryOrSlug) => {
  if (!categoryOrSlug) return null;
  if (typeof categoryOrSlug === "string") return getCategoryDefinition(categoryOrSlug);
  return (
    getCategoryDefinition(categoryOrSlug.slug) ||
    getCategoryDefinition(categoryOrSlug.categorySlug) ||
    getCategoryDefinition(categoryOrSlug.type)
  );
};

const resolveModule = (categoryOrSlug) => {
  const definition = resolveDefinition(categoryOrSlug);
  return definition ? MODULES[definition.domain] || null : null;
};

const enrichCategory = (category = {}) => {
  const definition = resolveDefinition(category);
  if (!definition) {
    return {
      ...category,
      domain: category.domain || "experiences",
      subtype: category.slug || "",
      formMode: "domain",
      managedByPlatform: true,
    };
  }
  return {
    ...category,
    slug: definition.slug,
    name: category.name || definition.name,
    group: definition.group,
    description: category.description || definition.description,
    domain: definition.domain,
    domainLabel: DOMAIN_LABELS[definition.domain],
    subtype: definition.subtype,
    supportsOptions: definition.supportsOptions,
    inventoryKind: definition.inventoryKind,
    inventoryLabel: definition.inventoryLabel,
    inventoryLabelPlural: definition.inventoryLabelPlural,
    availabilityPolicy: definition.availabilityPolicy,
    consumptionPolicy: definition.consumptionPolicy,
    listingFieldSchema: definition.listingFields,
    optionFieldSchema: definition.inventoryFields,
    bookingFieldSchema: definition.bookingFields,
    defaults: definition.defaults,
    formMode: "domain",
    managedByPlatform: true,
  };
};

const validateListingDetails = (categoryOrSlug, attributes) => {
  const definition = resolveDefinition(categoryOrSlug);
  const domain = resolveModule(definition);
  if (!domain) return fail(["Unknown service category."]);
  return domain.validateListing(asObject(attributes), definition.subtype);
};

const validateInventoryDetails = (categoryOrSlug, attributes) => {
  const definition = resolveDefinition(categoryOrSlug);
  const domain = resolveModule(definition);
  if (!domain) return fail(["Unknown service category."]);
  return domain.validateInventory(asObject(attributes), definition.subtype);
};

const validateBookingDetails = ({ categoryOrSlug, payload, listing, inventory }) => {
  const definition = resolveDefinition(categoryOrSlug);
  const domain = resolveModule(definition);
  if (!domain) return fail(["Unknown service category."]);
  const result = domain.validateBooking({
    payload,
    listing,
    inventory,
    subtype: definition.subtype,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    domain: definition.domain,
    subtype: definition.subtype,
    categorySlug: definition.slug,
    payload: result.value.payload,
    schedule: result.value.schedule,
    errors: [],
  };
};

const snapshotDomain = (category) => {
  const enriched = enrichCategory(category);
  return {
    categoryId: category._id || category.id || null,
    categorySlug: enriched.slug,
    categoryName: enriched.name,
    domain: enriched.domain,
    subtype: enriched.subtype,
    supportsOptions: Boolean(enriched.supportsOptions),
    listingFieldSchema: enriched.listingFieldSchema || [],
    optionFieldSchema: enriched.optionFieldSchema || [],
    bookingFieldSchema: enriched.bookingFieldSchema || [],
    availabilityPolicy: enriched.availabilityPolicy || null,
    consumptionPolicy: enriched.consumptionPolicy || null,
    inventoryKind: enriched.inventoryKind,
    inventoryLabel: enriched.inventoryLabel,
    formMode: "domain",
    snapshottedAt: new Date(),
  };
};

module.exports = {
  DOMAIN_LABELS,
  listCategoryDefinitions,
  getCategoryDefinition,
  resolveDefinition,
  resolveModule,
  resolveSlug,
  enrichCategory,
  validateListingDetails,
  validateInventoryDetails,
  validateBookingDetails,
  snapshotDomain,
  toSeedDocument,
  normalizePaymentPolicy,
  normalizeCancellationPolicy,
  splitBookingAmounts,
  policyFromListing,
  calculateStayQuote,
  sanitizeListingAttributesForPublic,
};
