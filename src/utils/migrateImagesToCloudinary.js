require("dotenv").config();
const mongoose = require("mongoose");
const { Readable } = require("stream");
const connectDB = require("../config/db");
const configureCloudinary = require("../config/cloudinary");
const Hotel = require("../models/Hotel");
const Supplier = require("../models/Supplier");

const DATA_IMAGE_PATTERN = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/;

const uploadDataImage = (value, publicIdHint) =>
  new Promise((resolve, reject) => {
    const match = String(value || "").match(DATA_IMAGE_PATTERN);
    if (!match) {
      resolve(value);
      return;
    }

    const cloudinary = configureCloudinary();
    const folder = process.env.CLOUDINARY_FOLDER || "safariservconn";
    const buffer = Buffer.from(match[2], "base64");
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        public_id: publicIdHint,
        unique_filename: true,
        overwrite: false,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result.secure_url);
      }
    );

    Readable.from(buffer).pipe(uploadStream);
  });

const migrateHotelImages = async () => {
  const hotels = await Hotel.find({
    images: { $elemMatch: { $regex: DATA_IMAGE_PATTERN } },
  });
  let migrated = 0;

  for (const hotel of hotels) {
    hotel.images = await Promise.all(
      hotel.images.map((image, index) =>
        uploadDataImage(image, `hotel-${hotel._id}-${index}`)
      )
    );
    await hotel.save();
    migrated += 1;
  }

  return migrated;
};

const migrateSupplierProfileImages = async () => {
  const suppliers = await Supplier.find({
    $or: [
      { "profile.logo": { $regex: DATA_IMAGE_PATTERN } },
      { "profile.coverImage": { $regex: DATA_IMAGE_PATTERN } },
    ],
  });
  let migrated = 0;

  for (const supplier of suppliers) {
    supplier.profile.logo = await uploadDataImage(
      supplier.profile?.logo,
      `supplier-${supplier._id}-logo`
    );
    supplier.profile.coverImage = await uploadDataImage(
      supplier.profile?.coverImage,
      `supplier-${supplier._id}-cover`
    );
    await supplier.save();
    migrated += 1;
  }

  return migrated;
};

const run = async () => {
  await connectDB();
  const [hotels, suppliers] = await Promise.all([
    migrateHotelImages(),
    migrateSupplierProfileImages(),
  ]);

  console.log(`Image migration complete. Hotels updated: ${hotels}. Suppliers updated: ${suppliers}.`);
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("Image migration failed:", error.message);
  await mongoose.disconnect();
  process.exit(1);
});
