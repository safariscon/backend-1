const ServiceCategory = require("../models/ServiceCategory");
const { ensureSeededCategories } = require("../utils/ensureCategories");
const { normalizeFieldSchema, slugify } = require("../utils/fieldSchema");
const { clearCache } = require("../utils/cache");

const serializeCategory = (category, { includeInactive = false } = {}) => {
  if (!category) return null;
  const data = typeof category.toObject === "function" ? category.toObject() : { ...category };
  if (!includeInactive && data.isActive === false) return null;
  return {
    ...data,
    id: data._id,
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

const createAdminCategory = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const group = String(req.body.group || "Other").trim();
    const slug = slugify(req.body.slug || name);
    if (!name || !slug) {
      return res.status(400).json({ message: "name is required." });
    }

    const exists = await ServiceCategory.findOne({ slug });
    if (exists) return res.status(409).json({ message: "A category with this slug already exists." });

    const category = await ServiceCategory.create({
      slug,
      name,
      group,
      description: String(req.body.description || "").trim(),
      icon: req.body.icon || null,
      isActive: req.body.isActive !== false,
      sortOrder: Number(req.body.sortOrder || 0),
      supportsOptions: req.body.supportsOptions !== false,
      listingFieldSchema: normalizeFieldSchema(req.body.listingFieldSchema, "listing"),
      optionFieldSchema: normalizeFieldSchema(req.body.optionFieldSchema, "option"),
      bookingFieldSchema: normalizeFieldSchema(req.body.bookingFieldSchema, "booking"),
      defaults: {
        suggestedCancelWindowHours: Math.max(
          0,
          Number(req.body.defaults?.suggestedCancelWindowHours ?? 6)
        ),
      },
    });

    clearCache("public:");
    return res.status(201).json({ message: "Category created.", category: serializeCategory(category, { includeInactive: true }) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create category.", error: error.message });
  }
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
    if (req.body.supportsOptions != null) category.supportsOptions = Boolean(req.body.supportsOptions);
    if (req.body.slug) {
      const nextSlug = slugify(req.body.slug);
      if (nextSlug && nextSlug !== category.slug) {
        const clash = await ServiceCategory.findOne({ slug: nextSlug, _id: { $ne: category._id } });
        if (clash) return res.status(409).json({ message: "Slug already in use." });
        category.slug = nextSlug;
      }
    }
    if (req.body.defaults?.suggestedCancelWindowHours != null) {
      category.defaults.suggestedCancelWindowHours = Math.max(
        0,
        Number(req.body.defaults.suggestedCancelWindowHours)
      );
    }
    if (Array.isArray(req.body.listingFieldSchema)) {
      category.listingFieldSchema = normalizeFieldSchema(req.body.listingFieldSchema, "listing");
    }
    if (Array.isArray(req.body.optionFieldSchema)) {
      category.optionFieldSchema = normalizeFieldSchema(req.body.optionFieldSchema, "option");
    }
    if (Array.isArray(req.body.bookingFieldSchema)) {
      category.bookingFieldSchema = normalizeFieldSchema(req.body.bookingFieldSchema, "booking");
    }

    await category.save();
    clearCache("public:");
    return res.json({ message: "Category updated.", category: serializeCategory(category, { includeInactive: true }) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update category.", error: error.message });
  }
};

const updateAdminCategoryFields = async (req, res) => {
  try {
    const category = await ServiceCategory.findById(req.params.id);
    if (!category) return res.status(404).json({ message: "Category not found." });

    if (Array.isArray(req.body.listingFieldSchema)) {
      category.listingFieldSchema = normalizeFieldSchema(req.body.listingFieldSchema, "listing");
    }
    if (Array.isArray(req.body.optionFieldSchema)) {
      category.optionFieldSchema = normalizeFieldSchema(req.body.optionFieldSchema, "option");
    }
    if (Array.isArray(req.body.bookingFieldSchema)) {
      category.bookingFieldSchema = normalizeFieldSchema(req.body.bookingFieldSchema, "booking");
    }
    if (req.body.supportsOptions != null) category.supportsOptions = Boolean(req.body.supportsOptions);

    await category.save();
    clearCache("public:");
    return res.json({ message: "Category field schemas updated.", category: serializeCategory(category, { includeInactive: true }) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update category fields.", error: error.message });
  }
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
