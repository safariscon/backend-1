const bcrypt = require("bcrypt");
const User = require("../models/User");

const seedAdmin = async () => {
  const adminEmail = (process.env.ADMIN_EMAIL || "admin@tourconnect.com")
    .toLowerCase()
    .trim();
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";

  const existing = await User.findOne({ email: adminEmail });
  const hashedPassword = await bcrypt.hash(adminPassword, 10);
  if (!existing) {
    await User.create({
      name: "TourConnect Admin",
      email: adminEmail,
      password: hashedPassword,
      role: "admin",
    });

    console.log(`Seeded demo admin: ${adminEmail}`);
  }

  const helperSeed = [
    {
      name: "Eric Guide",
      email: "eric.helper@tourconnect.com",
      phone: "0780000001",
      role: "tourHelper",
    },
    {
      name: "Diane Helper",
      email: "diane.helper@tourconnect.com",
      phone: "0790000002",
      role: "tourHelper",
    },
    {
      name: "John Support",
      email: "john.helper@tourconnect.com",
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
