const bcrypt = require("bcrypt");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const User = require("../models/User");
const connectDB = require("../config/db");

dotenv.config({ quiet: true });

const DEFAULT_ADMIN = {
  email: "theodufi.rw@gmail.com",
  name: "Theoneste Kalix",
  password: "admin@1234",
};

const SEEDED_NON_ADMIN_EMAILS = [
  "eric.helper@safarisconn.com",
  "diane.helper@safarisconn.com",
  "john.helper@safarisconn.com",
];

const seedAdmin = async () => {
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || DEFAULT_ADMIN.email)
    .toLowerCase()
    .trim();
  const adminName = (process.env.SEED_ADMIN_NAME || DEFAULT_ADMIN.name).trim();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || DEFAULT_ADMIN.password;

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
    loginOtpHash: "",
    loginOtpExpiresAt: null,
    loginOtpAttempts: 0,
    loginOtpSentAt: null,
    loginRememberMe: false,
    refreshTokenHash: "",
    refreshTokenExpiresAt: null,
    passwordChangedAt: new Date(),
    termsAccepted: true,
    termsAcceptedAt: existing?.termsAcceptedAt || verifiedAt,
  };

  if (!existing) {
    await User.create(adminFields);
    console.log(`Seeded admin: ${adminEmail}`);
  } else {
    await User.updateOne({ _id: existing._id }, { $set: adminFields });
    console.log(`Updated admin: ${adminEmail}`);
  }

  const removed = await User.deleteMany({
    email: { $in: SEEDED_NON_ADMIN_EMAILS },
    role: { $ne: "admin" },
  });
  if (removed.deletedCount) {
    console.log(`Removed ${removed.deletedCount} seeded non-admin user(s).`);
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
