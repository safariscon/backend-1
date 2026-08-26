const {
  fail,
  ok,
  asObject,
  cleanText,
  asBoolean,
  asInteger,
  asDateOnly,
  asDateTime,
} = require("./shared/helpers");

const VEHICLE_CLASSES = ["Economy", "Compact", "SUV", "Van", "Luxury"];
const TRANSMISSIONS = ["Automatic", "Manual"];
const FUEL_POLICIES = ["Full-to-full", "Same-to-same", "Prepaid"];
const FUEL_TYPES = ["Petrol", "Diesel", "Hybrid / Electric"];

const splitDateTime = (iso) => {
  if (!iso) return { date: "", time: "" };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  return {
    date: date.toISOString().slice(0, 10),
    time: date.toISOString().slice(11, 16),
  };
};

const validateListing = (input = {}, subtype = "car-rental") => {
  const raw = asObject(input);
  const errors = [];

  if (subtype === "taxi") {
    const vehicleType = cleanText(raw.vehicleType, 80);
    if (!vehicleType) errors.push("Vehicle type is required.");
    if (errors.length) return fail(errors);
    return ok({ vehicleType });
  }

  if (subtype === "motorbike") {
    return ok({
      helmetIncluded: asBoolean(raw.helmetIncluded),
      minimumDriverAge: asInteger(raw.minimumDriverAge) || 18,
    });
  }

  const vehicleClass = cleanText(raw.vehicleClass, 40);
  const transmission = cleanText(raw.transmission, 20);
  const minimumDriverAge = asInteger(raw.minimumDriverAge);
  if (!VEHICLE_CLASSES.includes(vehicleClass)) errors.push("Vehicle class is required.");
  if (!TRANSMISSIONS.includes(transmission)) errors.push("Transmission is required.");
  if (!Number.isFinite(minimumDriverAge) || minimumDriverAge < 18) {
    errors.push("Minimum driver age must be at least 18.");
  }
  const pickupTime = cleanText(raw.pickupTime, 8) || "08:00";
  const returnTime = cleanText(raw.returnTime, 8) || "18:00";
  const minRentalDays = asInteger(raw.minRentalDays) || 1;
  const maxRentalDays = asInteger(raw.maxRentalDays) || 30;
  const fuelTypeRaw = cleanText(raw.fuelType, 40);
  const fuelType = FUEL_TYPES.includes(fuelTypeRaw) ? fuelTypeRaw : (fuelTypeRaw ? "" : "Petrol");
  if (fuelTypeRaw && !FUEL_TYPES.includes(fuelTypeRaw)) errors.push("Choose a valid fuel type.");
  if (minRentalDays < 1) errors.push("Minimum rental must be at least 1 day.");
  if (maxRentalDays < minRentalDays) errors.push("Maximum rental must be at least the minimum.");
  if (errors.length) return fail(errors);
  return ok({
    vehicleClass,
    transmission,
    withDriver: asBoolean(raw.withDriver),
    fuelType: fuelType || "Petrol",
    fuelPolicy: FUEL_POLICIES.includes(raw.fuelPolicy) ? raw.fuelPolicy : "Full-to-full",
    insuranceIncluded: asBoolean(raw.insuranceIncluded),
    minimumDriverAge,
    depositNote: cleanText(raw.depositNote, 1000),
    pickupTime,
    returnTime,
    minRentalDays,
    maxRentalDays,
  });
};

const validateInventory = (input = {}) => {
  const raw = asObject(input);
  const errors = [];
  const seats = raw.seats == null || raw.seats === "" ? null : asInteger(raw.seats);
  const quantity = raw.quantity == null || raw.quantity === "" ? 1 : asInteger(raw.quantity);
  if (seats != null && (!Number.isFinite(seats) || seats < 1)) errors.push("Seats must be at least 1.");
  if (!Number.isFinite(quantity) || quantity < 1) errors.push("Number of vehicles must be at least 1.");
  if (errors.length) return fail(errors);
  return ok({
    make: cleanText(raw.make, 80),
    model: cleanText(raw.model, 80),
    seats,
    luggage: cleanText(raw.luggage, 80),
    ac: asBoolean(raw.ac),
    quantity,
  });
};

const validateBooking = ({ payload = {}, listing = {}, subtype = "car-rental" } = {}) => {
  const raw = asObject(payload);
  const listingDetails = asObject(listing.listingAttributes || listing);
  const errors = [];
  const pickupLocation = cleanText(raw.pickupLocation, 200);
  const returnLocation = cleanText(raw.returnLocation || raw.dropoffLocation, 200);
  const pickupDateTime = asDateTime(raw.pickupDateTime);
  const returnDateTime = asDateTime(raw.returnDateTime);
  const dropoffLocation = cleanText(raw.dropoffLocation, 200);

  if (!pickupLocation) errors.push("Pickup location is required.");
  if (!pickupDateTime) errors.push("Pickup date/time is required.");

  if (subtype === "taxi") {
    if (!dropoffLocation) errors.push("Drop-off location is required.");
  } else {
    if (!returnLocation) errors.push("Return location is required.");
    if (!returnDateTime) errors.push("Return date/time is required.");
    if (pickupDateTime && returnDateTime && new Date(returnDateTime) <= new Date(pickupDateTime)) {
      errors.push("Return time must be after pickup time.");
    }
    const minRentalDays = asInteger(listingDetails.minRentalDays) || 1;
    const maxRentalDays = asInteger(listingDetails.maxRentalDays) || 0;
    const pickupDay = String(raw.pickupDateTime || pickupDateTime || "").slice(0, 10);
    const returnDay = String(raw.returnDateTime || returnDateTime || "").slice(0, 10);
    if (pickupDay && returnDay && returnDay <= pickupDay) {
      errors.push("Return date must be after pickup date.");
    }
    if (pickupDay && returnDay && returnDay > pickupDay) {
      const days = Math.round((new Date(`${returnDay}T12:00:00Z`) - new Date(`${pickupDay}T12:00:00Z`)) / 86400000);
      if (days < minRentalDays) errors.push(`Minimum rental is ${minRentalDays} day${minRentalDays === 1 ? "" : "s"}.`);
      if (maxRentalDays > 0 && days > maxRentalDays) errors.push(`Maximum rental is ${maxRentalDays} day${maxRentalDays === 1 ? "" : "s"}.`);
    }
    const openFrom = String(listingDetails.pickupTime || "").slice(0, 5);
    const closeBy = String(listingDetails.returnTime || "").slice(0, 5);
    const pickupClock = String(raw.pickupDateTime || "").includes("T") ? String(raw.pickupDateTime).slice(11, 16) : splitDateTime(pickupDateTime).time;
    const returnClock = String(raw.returnDateTime || "").includes("T") ? String(raw.returnDateTime).slice(11, 16) : splitDateTime(returnDateTime).time;
    if (openFrom && pickupClock && pickupClock < openFrom) errors.push(`Pickup starts from ${openFrom}.`);
    if (closeBy && returnClock && returnClock > closeBy) errors.push(`Return by ${closeBy}.`);
  }

  if (new Date(pickupDateTime).getTime() < Date.now() - 60 * 1000) {
    errors.push("Pickup cannot be in the past.");
  }

  let driverAge = null;
  let driverLicenseNumber = "";
  let numberOfDrivers = 1;
  if (subtype === "car-rental") {
    driverAge = asInteger(raw.driverAge);
    driverLicenseNumber = cleanText(raw.driverLicenseNumber, 80);
    numberOfDrivers = asInteger(raw.numberOfDrivers);
    if (!Number.isFinite(driverAge) || driverAge < 18) errors.push("Driver age must be at least 18.");
    const minimumAge = asInteger(listingDetails.minimumDriverAge);
    if (Number.isFinite(minimumAge) && Number.isFinite(driverAge) && driverAge < minimumAge) {
      errors.push(`Driver must be at least ${minimumAge} years old.`);
    }
    if (!listingDetails.withDriver && !driverLicenseNumber) errors.push("Driver license number is required.");
    if (!Number.isFinite(numberOfDrivers) || numberOfDrivers < 1) errors.push("Number of drivers must be at least 1.");
  }

  if (errors.length) return fail(errors);

  const pickup = splitDateTime(pickupDateTime);
  const dropoff = splitDateTime(returnDateTime || pickupDateTime);
  return ok({
    payload: {
      pickupLocation,
      returnLocation: subtype === "taxi" ? dropoffLocation : returnLocation,
      dropoffLocation: subtype === "taxi" ? dropoffLocation : "",
      pickupDateTime,
      returnDateTime: returnDateTime || pickupDateTime,
      driverAge,
      driverLicenseNumber,
      numberOfDrivers,
    },
    schedule: {
      startDate: pickup.date || asDateOnly(raw.pickupDateTime),
      endDate: dropoff.date || pickup.date,
      startTime: pickup.time,
      endTime: dropoff.time,
      guests: numberOfDrivers || 1,
      numberOfPeople: numberOfDrivers || 1,
      quantity: 1,
    },
  });
};

module.exports = {
  domain: "transport",
  validateListing,
  validateInventory,
  validateBooking,
};
