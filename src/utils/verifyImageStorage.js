require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Hotel = require("../models/Hotel");
const Supplier = require("../models/Supplier");

const DATA_IMAGE_PATTERN = /^data:image\/[a-zA-Z0-9.+-]+;base64,/;

const run = async () => {
  await connectDB();
  const [hotelsWithInlineImages, suppliersWithInlineImages] = await Promise.all([
    Hotel.countDocuments({
      images: { $elemMatch: { $regex: DATA_IMAGE_PATTERN } },
    }),
    Supplier.countDocuments({
      $or: [
        { "profile.logo": { $regex: DATA_IMAGE_PATTERN } },
        { "profile.coverImage": { $regex: DATA_IMAGE_PATTERN } },
      ],
    }),
  ]);

  console.log(
    JSON.stringify(
      { hotelsWithInlineImages, suppliersWithInlineImages },
      null,
      2
    )
  );
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("Image storage verification failed:", error.message);
  await mongoose.disconnect();
  process.exit(1);
});
