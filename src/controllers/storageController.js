const mongoose = require("mongoose");
const configureCloudinary = require("../config/cloudinary");

const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;
const round = (value, digits = 2) => Number((Number(value) || 0).toFixed(digits));
const positiveLimit = (value, fallback) => Math.max(0.01, Number(value) || fallback);
const percentage = (used, limit) => round(Math.min(100, Math.max(0, (used / limit) * 100)), 3);

const getMongoStorageData = async () => {
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB is not connected.");

  const [stats, collectionInfos] = await Promise.all([
    db.command({ dbStats: 1, scale: 1 }),
    db.listCollections({}, { nameOnly: true }).toArray(),
  ]);
  const collections = await Promise.all(
    collectionInfos
      .map((collection) => collection.name)
      .sort()
      .map(async (name) => ({
        name,
        documents: await db.collection(name).estimatedDocumentCount().catch(() => 0),
      }))
  );
  const storageUsedBytes = Math.max(0, Number(stats.storageSize || stats.dataSize || 0));
  const storageUsedMB = round(storageUsedBytes / MB, 4);
  const storageLimitMB = positiveLimit(process.env.MONGODB_STORAGE_LIMIT_MB, 512);
  const remainingStorageMB = round(Math.max(0, storageLimitMB - storageUsedMB), 4);

  return {
    databaseName: db.databaseName || stats.db || "MongoDB",
    storageUsedBytes,
    storageUsedMB,
    storageLimitMB,
    remainingStorageMB,
    usagePercent: percentage(storageUsedMB, storageLimitMB),
    numberOfCollections: collections.length,
    totalDocuments: collections.reduce((sum, collection) => sum + Number(collection.documents || 0), 0),
    collections,
  };
};

const emptyCloudinaryData = (message = "Cloudinary usage is unavailable.") => {
  const storageLimitGB = positiveLimit(process.env.CLOUDINARY_STORAGE_LIMIT_GB, 25);
  const bandwidthLimitGB = positiveLimit(process.env.CLOUDINARY_BANDWIDTH_LIMIT_GB, 25);
  return {
    configured: false,
    message,
    storageUsedGB: 0,
    storageLimitGB,
    remainingStorageGB: storageLimitGB,
    usagePercent: 0,
    totalFiles: 0,
    images: 0,
    pdfs: 0,
    bandwidthUsedGB: 0,
    bandwidthLimitGB,
    remainingBandwidthGB: bandwidthLimitGB,
    bandwidthUsagePercent: 0,
  };
};

const getCloudinaryStorageData = async () => {
  let cloudinary;
  try {
    cloudinary = configureCloudinary();
  } catch (error) {
    return emptyCloudinaryData(error.message);
  }

  try {
    const usage = await cloudinary.api.usage();
    const [imageResult, pdfResult] = await Promise.all([
      cloudinary.api.resources({ resource_type: "image", type: "upload", max_results: 1 }).catch(() => null),
      cloudinary.search.expression("format:pdf").max_results(1).execute().catch(() => null),
    ]);
    const storageUsedGB = round(Number(usage.storage?.usage || 0) / GB, 3);
    const storageLimitGB = usage.storage?.limit
      ? round(Number(usage.storage.limit) / GB, 3)
      : positiveLimit(process.env.CLOUDINARY_STORAGE_LIMIT_GB, 25);
    const bandwidthUsedGB = round(Number(usage.bandwidth?.usage || 0) / GB, 3);
    const bandwidthLimitGB = usage.bandwidth?.limit
      ? round(Number(usage.bandwidth.limit) / GB, 3)
      : positiveLimit(process.env.CLOUDINARY_BANDWIDTH_LIMIT_GB, 25);
    const images = Number(imageResult?.total_count ?? imageResult?.resources?.length ?? 0);
    const pdfs = Number(pdfResult?.total_count ?? pdfResult?.resources?.length ?? 0);
    const totalFiles = Number(usage.resources ?? Math.max(images + pdfs, images));

    return {
      configured: true,
      storageUsedGB,
      storageLimitGB,
      remainingStorageGB: round(Math.max(0, storageLimitGB - storageUsedGB), 3),
      usagePercent: percentage(storageUsedGB, storageLimitGB),
      totalFiles,
      images,
      pdfs,
      bandwidthUsedGB,
      bandwidthLimitGB,
      remainingBandwidthGB: round(Math.max(0, bandwidthLimitGB - bandwidthUsedGB), 3),
      bandwidthUsagePercent: percentage(bandwidthUsedGB, bandwidthLimitGB),
    };
  } catch (error) {
    return emptyCloudinaryData(`Cloudinary usage could not be loaded: ${error.message}`);
  }
};

const getMongoStorage = async (_req, res) => {
  try {
    return res.json(await getMongoStorageData());
  } catch (error) {
    return res.status(503).json({ message: "MongoDB storage information is unavailable.", error: error.message });
  }
};

const getCloudinaryStorage = async (_req, res) => res.json(await getCloudinaryStorageData());

const getStorageOverview = async (_req, res) => {
  const [mongodb, cloudinary] = await Promise.all([
    getMongoStorageData().catch((error) => ({ available: false, message: error.message, storageUsedMB: 0, storageLimitMB: positiveLimit(process.env.MONGODB_STORAGE_LIMIT_MB, 512), remainingStorageMB: positiveLimit(process.env.MONGODB_STORAGE_LIMIT_MB, 512), usagePercent: 0, collections: [] })),
    getCloudinaryStorageData(),
  ]);
  return res.json({ mongodb, cloudinary });
};

module.exports = {
  getMongoStorage,
  getCloudinaryStorage,
  getStorageOverview,
  getMongoStorageData,
  getCloudinaryStorageData,
};
