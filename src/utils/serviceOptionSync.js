const ServiceOption = require("../models/ServiceOption");

const optionToAvailabilityRow = (option) => ({
  id: String(option._id),
  cells: {
    service: option.name,
    price: option.price,
    priceType: option.priceType || "fixed",
    calculationField: option.calculationField || "quantity",
    durationUnit: option.durationUnit || "",
    maximumDuration: option.maximumDuration,
    availability: option.capacity,
    availableFrom: option.availableFrom || "",
    availableTo: option.availableTo || "",
    availableDays: Array.isArray(option.availableDays) ? option.availableDays.join(",") : "",
    availableStartTime: option.availableStartTime || "",
    availableEndTime: option.availableEndTime || "",
    requiresTime: Boolean(option.requiresTime),
    details: option.details || "",
  },
});

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

  const docs = rows.map((row, index) => {
    const cells = row.cells || {};
    return {
      serviceId: service._id,
      name: String(cells.service || cells.name || `Option ${index + 1}`).trim(),
      price: Math.max(0, Number(cells.price || 0)),
      currency: "RWF",
      priceType: String(cells.priceType || "fixed").trim(),
      calculationField: String(cells.calculationField || "quantity").trim(),
      durationUnit: String(cells.durationUnit || "").trim(),
      maximumDuration: cells.maximumDuration == null ? null : Number(cells.maximumDuration),
      capacity: Math.max(0, Number(cells.availability || 1)),
      availableFrom: String(cells.availableFrom || "").trim(),
      availableTo: String(cells.availableTo || "").trim(),
      availableDays: String(cells.availableDays || "Mon,Tue,Wed,Thu,Fri,Sat,Sun")
        .split(",")
        .map((day) => day.trim())
        .filter(Boolean),
      availableStartTime: String(cells.availableStartTime || "").trim(),
      availableEndTime: String(cells.availableEndTime || "").trim(),
      requiresTime: Boolean(cells.requiresTime),
      details: String(cells.details || "").trim(),
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
};
