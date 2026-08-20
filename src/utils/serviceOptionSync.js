const ServiceOption = require("../models/ServiceOption");
const { serializeSellerOption, buildOptionEngineDefaults } = require("./serviceOptionView");

const optionToAvailabilityRow = (option) => {
  const { normalizeAvailableDays } = require("../services/automaticBookingService");
  const days = normalizeAvailableDays(option.availableDays);
  // Empty or full week = unrestricted (do not write Mon–Sun into the table).
  const availableDays = days.length > 0 && days.length < 7 ? days.join(",") : "";
  return {
    id: String(option._id),
    cells: {
      service: option.name,
      price: option.price,
      // Engine defaults only — sellers do not configure these unless admin adds optionFieldSchema attrs.
      priceType: option.priceType || "fixed",
      calculationField: option.calculationField || "quantity",
      durationUnit: option.durationUnit || "",
      maximumDuration: option.maximumDuration,
      availability: Math.max(1, Number(option.capacity || 1)),
      availableFrom: option.availableFrom || "",
      availableTo: option.availableTo || "",
      availableDays,
      availableStartTime: option.availableStartTime || "",
      availableEndTime: option.availableEndTime || "",
      requiresTime: Boolean(option.requiresTime),
      details: option.details || "",
    },
  };
};

const syncServiceOptionsToAvailabilityTable = async (serviceId) => {
  const options = await ServiceOption.find({ serviceId, isActive: true }).sort({ sortOrder: 1, createdAt: 1 }).lean();
  const rows = options.map(optionToAvailabilityRow);
  const Hotel = require("../models/Hotel");
  await Hotel.updateOne(
    { _id: serviceId },
    {
      $set: {
        availabilityTable: {
          columns: [
            { id: "service", label: "Option name" },
            { id: "price", label: "Price (RWF)" },
            { id: "priceType", label: "Price type" },
            { id: "calculationField", label: "Calculation field" },
            { id: "durationUnit", label: "Duration unit" },
            { id: "maximumDuration", label: "Maximum duration" },
            { id: "availability", label: "Availability / capacity" },
            { id: "availableFrom", label: "Available from" },
            { id: "availableTo", label: "Available until" },
            { id: "availableDays", label: "Weekdays" },
            { id: "availableStartTime", label: "Opens" },
            { id: "availableEndTime", label: "Closes" },
            { id: "requiresTime", label: "Times required" },
            { id: "details", label: "Details / amenities" },
          ],
          rows,
          updatedAt: new Date(),
        },
        availableQuantity: rows.reduce((sum, row) => sum + Number(row.cells.availability || 0), 0) || 1,
        quantityRemaining: rows.reduce((sum, row) => sum + Number(row.cells.availability || 0), 0) || 1,
      },
    }
  );
  return rows;
};

const migrateAvailabilityRowsToOptions = async (service) => {
  const existing = await ServiceOption.countDocuments({ serviceId: service._id });
  if (existing > 0) return existing;

  const rows = service.availabilityTable?.rows || [];
  if (!rows.length) return 0;

  const defaults = buildOptionEngineDefaults();
  const docs = rows.map((row, index) => {
    const cells = row.cells || {};
    return {
      serviceId: service._id,
      name: String(cells.service || cells.name || `Option ${index + 1}`).trim(),
      price: Math.max(0, Number(cells.price || 0)),
      currency: "RWF",
      ...defaults,
      capacity: Math.max(1, Number(cells.availability || 1)),
      attributes: {},
      sortOrder: index,
      isActive: true,
    };
  });

  if (docs.length) await ServiceOption.insertMany(docs);
  return docs.length;
};

module.exports = {
  optionToAvailabilityRow,
  syncServiceOptionsToAvailabilityTable,
  migrateAvailabilityRowsToOptions,
  serializeSellerOption,
};
