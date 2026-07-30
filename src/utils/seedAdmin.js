const bcrypt = require("bcrypt");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const User = require("../models/User");
const connectDB = require("../config/db");

dotenv.config({ quiet: true });

const seedAdmin = async () => {
  const adminEmail = (process.env.ADMIN_EMAIL || "theodufi.rw@gmail.com")
    .toLowerCase()
    .trim();
  const adminName = (process.env.ADMIN_NAME || "Theoneste Kalix").trim();
  const adminPassword = process.env.ADMIN_PASSWORD || "admin@1234";

  const existing = await User.findOne({ email: adminEmail });
  const hashedPassword = await bcrypt.hash(adminPassword, 10);
  const verifiedAt = existing?.emailVerifiedAt || new Date();
  const adminFields = {
    name: adminName,
    email: adminEmail,
    password: hashedPassword,
    role: "admin",
    mustSetPassword: false,
    emailVerified: true,
    emailVerifiedAt: verifiedAt,
    emailVerificationOtpHash: "",
    emailVerificationOtpExpiresAt: null,
    emailVerificationOtpAttempts: 0,
    emailVerificationOtpSentAt: null,
    passwordResetOtpHash: "",
    passwordResetOtpExpiresAt: null,
    passwordResetOtpAttempts: 0,
    passwordResetOtpSentAt: null,
    passwordChangedAt: new Date(),
  };

  if (!existing) {
    await User.create(adminFields);

    console.log(`Seeded admin: ${adminEmail}`);
  } else {
    await User.updateOne({ _id: existing._id }, { $set: adminFields });
    console.log(`Updated admin: ${adminEmail}`);
  }

  const helperSeed = [
    {
      name: "Eric Guide",
      email: "eric.helper@safarisconn.com",
      phone: "0780000001",
      role: "tourHelper",
    },
    {
      name: "Diane Helper",
      email: "diane.helper@safarisconn.com",
      phone: "0790000002",
      role: "tourHelper",
    },
    {
      name: "John Support",
      email: "john.helper@safarisconn.com",
      phone: "0720000003",
      role: "tourHelper",
    },
  ];

  for (const helper of helperSeed) {
    const exists = await User.findOne({ email: helper.email });
    if (exists) continue;

    await User.create({
      ...helper,
      password: hashedPassword,
    });
  }
};

module.exports = seedAdmin;

if (require.main === module) {
  (async () => {
    try {
      await connectDB();
      await seedAdmin();
      await mongoose.disconnect();
      console.log("Admin seed complete.");
      process.exit(0);
    } catch (error) {
      console.error("Admin seed failed:", error.message);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    }
  })();
}
