/**
 * Clears legacy option schedule fields that sellers no longer edit.
 * Full Mon–Sun availableDays caused false "not available on Friday" errors
 * because Title Case ("Fri") did not match weekday keys ("fri").
 *
 * Run: npm run migrate:clear-option-schedule
 */
require("dotenv").config();
const connectDB = require("../config/db");
const ServiceOption = require("../models/ServiceOption");
const Hotel = require("../models/Hotel");
const { normalizeAvailableDays } = require("../services/automaticBookingService");

const ALL_DAYS = 7;

const clearOption = (option) => {
  const days = normalizeAvailableDays(option.availableDays);
  const clearDays = days.length === 0 || days.length === ALL_DAYS;
  return {
    availableDays: clearDays ? [] : days,
    availableFrom: "",
    availableTo: "",
    availableStartTime: "",
    availableEndTime: "",
    requiresTime: false,
  };
};

const run = async () => {
  await connectDB();

  const options = await ServiceOption.find({}).lean();
  let optionsUpdated = 0;
  for (const option of options) {
    const next = clearOption(option);
    const changed =
      JSON.stringify(option.availableDays || []) !== JSON.stringify(next.availableDays) ||
      option.availableFrom ||
      option.availableTo ||
      option.availableStartTime ||
      option.availableEndTime ||
      option.requiresTime;
    if (!changed) continue;
    await ServiceOption.updateOne({ _id: option._id }, { $set: next });
    optionsUpdated += 1;
  }

  const services = await Hotel.find({ "availabilityTable.rows.0": { $exists: true } }).select(
    "availabilityTable"
  );
  let tablesUpdated = 0;
  for (const service of services) {
    const rows = service.availabilityTable?.rows || [];
    let dirty = false;
    const nextRows = rows.map((row) => {
      const cells = { ...(row.cells || {}) };
      const days = normalizeAvailableDays(cells.availableDays);
      if (days.length === ALL_DAYS || cells.availableDays) {
        if (days.length === ALL_DAYS || days.length === 0) {
          if (cells.availableDays) dirty = true;
          cells.availableDays = "";
        }
      }
      if (cells.availableFrom || cells.availableTo || cells.availableStartTime || cells.availableEndTime) {
        dirty = true;
        cells.availableFrom = "";
        cells.availableTo = "";
        cells.availableStartTime = "";
        cells.availableEndTime = "";
      }
      if (cells.requiresTime && cells.requiresTime !== "no" && cells.requiresTime !== false) {
        dirty = true;
        cells.requiresTime = "no";
      }
      return { ...row, cells };
    });
    if (!dirty) continue;
    await Hotel.updateOne(
      { _id: service._id },
      { $set: { "availabilityTable.rows": nextRows, "availabilityTable.updatedAt": new Date() } }
    );
    tablesUpdated += 1;
  }

  console.log(
    JSON.stringify(
      {
        optionsScanned: options.length,
        optionsUpdated,
        servicesWithTables: services.length,
        tablesUpdated,
      },
      null,
      2
    )
  );
  process.exit(0);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
