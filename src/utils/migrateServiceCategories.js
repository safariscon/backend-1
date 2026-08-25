require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Hotel = require("../models/Hotel");
const ServiceCategory = require("../models/ServiceCategory");
const { ensureSeededCategories } = require("./ensureCategories");
const { snapshotCategorySchemas, slugify } = require("./fieldSchema");
const { migrateAvailabilityRowsToOptions } = require("./serviceOptionSync");
const { withCatalogGeo } = require("./catalogLocation");

const run = async () => {
  await connectDB();
  const seeded = await ensureSeededCategories();
  console.log(`Categories: seeded=${seeded.seeded} count=${seeded.count}`);

  const categories = await ServiceCategory.find({}).lean();
  const bySlug = new Map(categories.map((category) => [category.slug, category]));

  const hotels = await Hotel.find({}).lean();
  let linked = 0;
  let optionsMigrated = 0;

  for (const hotel of hotels) {
    const slug = slugify(hotel.categorySlug || hotel.type || "other");
    const category = bySlug.get(slug) || bySlug.get("other");
    if (!category) continue;

    const updates = {
      categoryId: category._id,
      categorySlug: category.slug,
      supportsOptions: category.supportsOptions !== false,
      schemaSnapshot: hotel.schemaSnapshot || snapshotCategorySchemas(category),
      listingAttributes: hotel.listingAttributes || {},
    };

    if (!hotel.catalogLocation?.latitude && hotel.serviceLocation?.latitude != null) {
      updates.catalogLocation = withCatalogGeo({
        latitude: hotel.serviceLocation.latitude,
        longitude: hotel.serviceLocation.longitude,
        latitudeRaw: String(hotel.serviceLocation.latitude),
        longitudeRaw: String(hotel.serviceLocation.longitude),
        formattedAddress: hotel.serviceLocation.formattedAddress || hotel.location || "",
        country: hotel.serviceLocation.country || "Rwanda",
        countryCode: "RW",
        state: hotel.serviceLocation.province || hotel.locationDetails?.province || "",
        city: hotel.serviceLocation.district || hotel.locationDetails?.district || "",
        area: hotel.serviceLocation.sector || hotel.locationDetails?.sector || "",
        placeName: hotel.serviceLocation.name || hotel.name || "",
        placeId: hotel.serviceLocation.placeId || "",
        locationSource: hotel.serviceLocation.locationSource || "map_click",
      });
    } else if (hotel.catalogLocation?.latitude && !hotel.catalogLocation?.geo?.coordinates?.length) {
      updates.catalogLocation = withCatalogGeo(hotel.catalogLocation);
    }

    if (hotel.contactDetails?.phone && !hotel.contactDetails?.phoneE164) {
      updates["contactDetails.phoneE164"] = hotel.contactDetails.phone;
      updates["contactDetails.phoneIso"] = "RW";
    }
    if (hotel.contactDetails?.whatsapp && !hotel.contactDetails?.whatsappE164) {
      updates["contactDetails.whatsappE164"] = hotel.contactDetails.whatsapp;
      updates["contactDetails.whatsappIso"] = "RW";
    }

    await Hotel.updateOne({ _id: hotel._id }, { $set: updates });
    linked += 1;

    const created = await migrateAvailabilityRowsToOptions(hotel);
    optionsMigrated += created;
  }

  console.log(`Linked ${linked} services to categories. Migrated ${optionsMigrated} availability rows to options.`);
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("Category migration failed:", error.message);
  await mongoose.disconnect();
  process.exit(1);
});
