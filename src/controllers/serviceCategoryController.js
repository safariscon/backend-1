const ServiceCategory = require("../models/ServiceCategory");
const Hotel = require("../models/Hotel");
const { ensureSeededCategories } = require("../utils/ensureCategories");
const { slugify } = require("../utils/fieldSchema");
const { enrichCategory, snapshotDomain } = require("../domains");
const { clearCache } = require("../utils/cache");
const {
  normalizeAvailabilityPolicy,
  normalizeConsumptionPolicy,
  defaultAvailabilityPolicy,
  defaultConsumptionPolicy,
} = require("../services/availabilityService");

const syncCategoryToServices = async (category) => {
  const snapshot = snapshotDomain(category);
  await Hotel.updateMany(
    { categoryId: category._id },
    {
      $set: {
        categorySlug: snapshot.categorySlug,
        type: snapshot.categorySlug,
        domain: snapshot.domain,
        subtype: snapshot.subtype,
        supportsOptions: Boolean(snapshot.supportsOptions),
        schemaSnapshot: snapshot,
      },
    }
  );
};

const serializeCategory = (category, { includeInactive = false } = {}) => {
  if (!category) return null;
  const data = typeof category.toObject === "function" ? category.toObject() : { ...category };
  if (!includeInactive && data.isActive === false) return null;
  const enriched = enrichCategory(data);
  return {
    ...enriched,
    id: data._id,
    availabilityPolicy: normalizeAvailabilityPolicy(enriched.availabilityPolicy || defaultAvailabilityPolicy()),
    consumptionPolicy: normalizeConsumptionPolicy(enriched.consumptionPolicy || defaultConsumptionPolicy()),
  };
};

const groupCategories = (categories = []) => {
  const groups = new Map();
  for (const category of categories) {
    const key = category.group || "Other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(category);
  }
  return [...groups.entries()].map(([group, items]) => ({
    group,
    categories: items.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name)),
  }));
};

const listPublicCategories = async (_req, res) => {
  try {
    await ensureSeededCategories();
    const categories = await ServiceCategory.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean();
    const serialized = categories.map((category) => serializeCategory(category)).filter(Boolean);
    return res.json({
      categories: serialized,
      groups: groupCategories(serialized),
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to list service categories.", error: error.message });
  }
};

const getPublicCategory = async (req, res) => {
  try {
    await ensureSeededCategories();
    const key = String(req.params.idOrSlug || "").trim();
    const filter = /^[a-f0-9]{24}$/i.test(key) ? { _id: key } : { slug: slugify(key) };
    const category = await ServiceCategory.findOne({ ...filter, isActive: true }).lean();
    if (!category) return res.status(404).json({ message: "Category not found." });
    return res.json({ category: serializeCategory(category) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch category.", error: error.message });
  }
};

const listAdminCategories = async (_req, res) => {
  try {
    await ensureSeededCategories();
    const categories = await ServiceCategory.find({}).sort({ sortOrder: 1, name: 1 }).lean();
    return res.json({
      categories: categories.map((category) => serializeCategory(category, { includeInactive: true })),
      groups: groupCategories(categories.map((category) => serializeCategory(category, { includeInactive: true }))),
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to list categories.", error: error.message });
  }
};

const getAdminCategory = async (req, res) => {
  try {
    await ensureSeededCategories();
    const key = String(req.params.id || req.params.idOrSlug || "").trim();
    if (!key) {
      return res.status(400).json({ message: "Category id or slug is required." });
    }

    const filter = /^[a-f0-9]{24}$/i.test(key) ? { _id: key } : { slug: slugify(key) };
    const category = await ServiceCategory.findOne(filter).lean();
    if (!category) {
      return res.status(404).json({ message: "Category not found." });
    }

    return res.json({ category: serializeCategory(category, { includeInactive: true }) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch category.", error: error.message });
  }
};

const createAdminCategory = async (_req, res) => {
  return res.status(403).json({
    code: "PLATFORM_CATEGORIES_LOCKED",
    message: "Categories are platform-defined. Activate or deactivate an existing category instead of creating custom field schemas.",
  });
};

const updateAdminCategory = async (req, res) => {
  try {
    const category = await ServiceCategory.findById(req.params.id);
    if (!category) return res.status(404).json({ message: "Category not found." });

    if (req.body.name != null) category.name = String(req.body.name).trim();
    if (req.body.group != null) category.group = String(req.body.group).trim();
    if (req.body.description != null) category.description = String(req.body.description).trim();
    if (req.body.icon !== undefined) category.icon = req.body.icon || null;
    if (req.body.isActive != null) category.isActive = Boolean(req.body.isActive);
    if (req.body.sortOrder != null) category.sortOrder = Number(req.body.sortOrder) || 0;
    if (req.body.slug) {
      return res.status(403).json({
        code: "PLATFORM_CATEGORIES_LOCKED",
        message: "Category slugs are platform-defined and cannot be changed.",
      });
    }
    if (req.body.supportsOptions != null || req.body.listingFieldSchema || req.body.optionFieldSchema || req.body.bookingFieldSchema) {
      return res.status(403).json({
        code: "PLATFORM_FIELDS_LOCKED",
        message: "Listing, inventory, and booking fields are defined by the platform domain, not by admin.",
      });
    }
    await category.save();
    await syncCategoryToServices(category);

    clearCache("public:");
    return res.json({ message: "Category updated.", category: serializeCategory(category, { includeInactive: true }) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update category.", error: error.message });
  }
};

const updateAdminCategoryFields = async (_req, res) => {
  return res.status(403).json({
    code: "PLATFORM_FIELDS_LOCKED",
    message: "Category booking contracts are defined in code. Admin cannot edit listing, inventory, or booking fields.",
  });
};

const deleteAdminCategory = async (req, res) => {
  try {
    const category = await ServiceCategory.findByIdAndUpdate(
      req.params.id,
      { $set: { isActive: false } },
      { returnDocument: "after" }
    );
    if (!category) return res.status(404).json({ message: "Category not found." });
    clearCache("public:");
    return res.json({ message: "Category deactivated.", category: serializeCategory(category, { includeInactive: true }) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to deactivate category.", error: error.message });
  }
};

module.exports = {
  listPublicCategories,
  getPublicCategory,
  listAdminCategories,
  getAdminCategory,
  createAdminCategory,
  updateAdminCategory,
  updateAdminCategoryFields,
  deleteAdminCategory,
  serializeCategory,
  groupCategories,
};
