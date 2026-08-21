const { FIELD_TYPES, VISIBILITIES, APPLIES_TO } = require("../models/fieldSchemaItem");

const slugify = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const normalizeFieldItem = (raw = {}, index = 0, appliesToDefault = "listing") => {
  const id = slugify(raw.id || raw.key || raw.label || `field-${index + 1}`);
  const type = FIELD_TYPES.includes(raw.type) ? raw.type : "text";
  const visibility = VISIBILITIES.includes(raw.visibility) ? raw.visibility : "public";
  const appliesTo = APPLIES_TO.includes(raw.appliesTo) ? raw.appliesTo : appliesToDefault;
  const options = Array.isArray(raw.options)
    ? raw.options.map((option) => String(option || "").trim()).filter(Boolean)
    : [];

  return {
    id,
    label: String(raw.label || id).trim(),
    type,
    required: Boolean(raw.required),
    placeholder: String(raw.placeholder || "").trim(),
    helpText: String(raw.helpText || "").trim(),
    options,
    validation: {
      min: raw.validation?.min == null || raw.validation?.min === "" ? null : Number(raw.validation.min),
      max: raw.validation?.max == null || raw.validation?.max === "" ? null : Number(raw.validation.max),
      pattern: raw.validation?.pattern == null ? null : String(raw.validation.pattern),
    },
    visibility,
    appliesTo,
    sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : index,
  };
};

const normalizeFieldSchema = (schema = [], appliesToDefault = "listing") => {
  if (!Array.isArray(schema)) return [];
  const seen = new Set();
  return schema
    .map((item, index) => normalizeFieldItem(item, index, appliesToDefault))
    .filter((item) => {
      if (!item.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);
};

const isEmptyValue = (value) => {
  if (value == null) return true;
  if (typeof value === "string") return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  return false;
};

/** Only fields configured for booking forms (ignore listing/option leftovers). */
const filterBookingFieldSchema = (schema = []) =>
  (Array.isArray(schema) ? schema : []).filter(
    (field) => !field?.appliesTo || field.appliesTo === "booking"
  );

/**
 * Category configuration is the source of truth for required booking fields.
 * Prefer the live category schema whenever the category document was loaded
 * (including an empty schema). Fall back to the service snapshot only when
 * the live category cannot be resolved.
 */
const resolveBookingFieldSchema = ({
  liveBookingFieldSchema,
  snapshotBookingFieldSchema,
  hasLiveCategory = false,
} = {}) => {
  if (hasLiveCategory) {
    return filterBookingFieldSchema(liveBookingFieldSchema || []);
  }
  return filterBookingFieldSchema(snapshotBookingFieldSchema || []);
};

const validateAttributesAgainstSchema = (attributes = {}, schema = [], { label = "attributes", appliesTo = null } = {}) => {
  const attrs = attributes && typeof attributes === "object" && !Array.isArray(attributes) ? attributes : {};
  const errors = [];
  const cleaned = {};
  // Schemas are usually already scoped (listing / option / booking).
  // Optionally narrow further when callers pass a mixed schema + appliesTo.
  const activeSchema = (Array.isArray(schema) ? schema : []).filter((field) => {
    if (!appliesTo) return true;
    return !field?.appliesTo || field.appliesTo === appliesTo;
  });

  for (const field of activeSchema) {
    const raw = attrs[field.id];
    if (isEmptyValue(raw)) {
      if (field.required) errors.push(`${field.label} is required.`);
      continue;
    }

    let value = raw;
    switch (field.type) {
      case "number": {
        value = Number(raw);
        if (!Number.isFinite(value)) {
          errors.push(`${field.label} must be a number.`);
          continue;
        }
        if (field.validation?.min != null && value < field.validation.min) {
          errors.push(`${field.label} must be at least ${field.validation.min}.`);
        }
        if (field.validation?.max != null && value > field.validation.max) {
          errors.push(`${field.label} must be at most ${field.validation.max}.`);
        }
        break;
      }
      case "boolean":
      case "checkbox":
        value = raw === true || raw === "true" || raw === 1 || raw === "1" || raw === "yes";
        break;
      case "select":
      case "radio":
        value = String(raw).trim();
        if (field.options.length && !field.options.includes(value)) {
          errors.push(`${field.label} must be one of: ${field.options.join(", ")}.`);
        }
        break;
      case "email":
        value = String(raw).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          errors.push(`${field.label} must be a valid email.`);
        }
        break;
      case "url":
      case "file":
        value = String(raw).trim();
        if (!/^https?:\/\//i.test(value)) {
          errors.push(`${field.label} must be a valid URL.`);
        }
        break;
      default:
        value = typeof raw === "string" ? raw.trim() : raw;
        if (field.validation?.pattern) {
          try {
            const re = new RegExp(field.validation.pattern);
            if (!re.test(String(value))) {
              errors.push(`${field.label} format is invalid.`);
            }
          } catch {
            /* ignore bad pattern in schema */
          }
        }
    }

    cleaned[field.id] = value;
  }

  if (errors.length) {
    return { ok: false, message: `${label} validation failed: ${errors[0]}`, errors, attributes: cleaned };
  }
  return { ok: true, attributes: cleaned };
};

const snapshotCategorySchemas = (category) => ({
  categoryId: category._id,
  categorySlug: category.slug,
  categoryName: category.name,
  supportsOptions: Boolean(category.supportsOptions),
  listingFieldSchema: category.listingFieldSchema || [],
  optionFieldSchema: category.optionFieldSchema || [],
  bookingFieldSchema: category.bookingFieldSchema || [],
  availabilityPolicy: category.availabilityPolicy || null,
  consumptionPolicy: category.consumptionPolicy || null,
  snapshottedAt: new Date(),
});

module.exports = {
  slugify,
  normalizeFieldItem,
  normalizeFieldSchema,
  filterBookingFieldSchema,
  resolveBookingFieldSchema,
  validateAttributesAgainstSchema,
  snapshotCategorySchemas,
};
