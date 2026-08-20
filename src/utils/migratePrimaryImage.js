require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Hotel = require("../models/Hotel");
const HotelService = require("../models/HotelService");

const missingPrimaryFilter = {
  $and: [
    {
      $or: [
        { primaryImage: { $exists: false } },
        { primaryImage: null },
        { primaryImage: "" },
      ],
    },
    { "images.0": { $exists: true, $nin: [null, ""] } },
  ],
};

const backfillPrimaryImage = (Model) =>
  Model.updateMany(
    missingPrimaryFilter,
    [{ $set: { primaryImage: { $arrayElemAt: ["$images", 0] } } }],
    { updatePipeline: true }
  );

const run = async () => {
  await connectDB();
  const [hotels, services] = await Promise.all([
    backfillPrimaryImage(Hotel),
    backfillPrimaryImage(HotelService),
  ]);

  console.log(
    `Primary image backfill complete. Hotels updated: ${hotels.modifiedCount}. Nested services updated: ${services.modifiedCount}.`
  );
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("Primary image backfill failed:", error.message);
  await mongoose.disconnect();
  process.exit(1);
});
