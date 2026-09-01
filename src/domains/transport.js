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
const MOTORBIKE_CATEGORIES = ["scooter", "taxi-moto", "safari-adventure"];
const MOTORBIKE_LICENCE_CLASSES = ["A1", "A"];
const CAR_LICENCE_CLASSES = ["B", "C", "D", "E"];

const licenceClassesFor = (subtype) =>
  (subtype === "motorbike" ? MOTORBIKE_LICENCE_CLASSES : CAR_LICENCE_CLASSES);

/** Keeps only values that appear in `allowed`, with duplicates removed. */
const cleanList = (input, allowed) => {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set();
  return list
    .map((item) => cleanText(item, 40))
    .filter((item) => item && allowed.includes(item) && !seen.has(item) && seen.add(item));
};

const permitRules = (raw, subtype) => ({
  allowedLicenceClasses: cleanList(raw.allowedLicenceClasses, licenceClassesFor(subtype)),
  requireLicenceUpload:
    raw.requireLicenceUpload === undefined || raw.requireLicenceUpload === null
      ? true
      : asBoolean(raw.requireLicenceUpload),
});

/** Provider-configured addresses where customers collect and return vehicles. */
const resolveRentalLocations = (listing = {}) => {
  const record = asObject(listing);
  const attrs = asObject(record.listingAttributes || record);
  const catalog = asObject(record.catalogLocation || record.serviceLocation || {});
  const fallback = cleanText(
    catalog.formattedAddress || catalog.fullAddress || (typeof record.location === "string" ? record.location : ""),
    200
  );
  const pickupLocation = cleanText(attrs.pickupLocation, 200) || fallback;
  const returnLocation = cleanText(attrs.returnLocation, 200) || pickupLocation;
  return { pickupLocation, returnLocation };
};

const isHttpUrl = (value) => /^https?:\/\/\S+$/i.test(String(value || "").trim());

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
    const minimumDriverAge = asInteger(raw.minimumDriverAge) || 18;
    const minRentalDays = asInteger(raw.minRentalDays) || 1;
    const maxRentalDays = asInteger(raw.maxRentalDays) || 30;
    const permits = permitRules(raw, subtype);
    if (minimumDriverAge < 16) errors.push("Minimum rider age must be at least 16.");
    if (minRentalDays < 1) errors.push("Minimum rental must be at least 1 day.");
    if (maxRentalDays < minRentalDays) errors.push("Maximum rental must be at least the minimum.");
    if (!permits.allowedLicenceClasses.length) {
      errors.push("Choose at least one permit class you accept.");
    }
    const pickupLocation = cleanText(raw.pickupLocation, 200);
    const returnLocation = cleanText(raw.returnLocation, 200);
    if (!pickupLocation) errors.push("Pickup location is required.");
    if (!returnLocation) errors.push("Return location is required.");
    if (errors.length) return fail(errors);
    return ok({
      helmetIncluded: asBoolean(raw.helmetIncluded),
      minimumDriverAge,
      pickupTime: cleanText(raw.pickupTime, 8) || "08:00",
      returnTime: cleanText(raw.returnTime, 8) || "18:00",
      minRentalDays,
      maxRentalDays,
      depositNote: cleanText(raw.depositNote, 1000),
      pickupLocation,
      returnLocation,
      ...permits,
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
  const permits = permitRules(raw, subtype);
  if (!permits.allowedLicenceClasses.length) {
    errors.push("Choose at least one permit class you accept.");
  }
  const pickupLocation = cleanText(raw.pickupLocation, 200);
  const returnLocation = cleanText(raw.returnLocation, 200);
  if (!pickupLocation) errors.push("Pickup location is required.");
  if (!returnLocation) errors.push("Return location is required.");
  if (errors.length) return fail(errors);
  return ok({
    ...permits,
    pickupLocation,
    returnLocation,
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

const validateInventory = (input = {}, subtype = "car-rental") => {
  const raw = asObject(input);
  const errors = [];
  const quantity = raw.quantity == null || raw.quantity === "" ? 1 : asInteger(raw.quantity);
  if (!Number.isFinite(quantity) || quantity < 1) errors.push("Number of vehicles must be at least 1.");

  if (subtype === "motorbike") {
    const plateNumber = cleanText(raw.plateNumber, 20).toUpperCase();
    const engineCc = asInteger(raw.engineCc);
    const insuranceExpiry = asDateOnly(raw.insuranceExpiry);
    const motoCategory = cleanText(raw.motoCategory, 40);
    if (!plateNumber) errors.push("Plate number is required.");
    if (!Number.isFinite(engineCc) || engineCc < 30) errors.push("Engine size is required.");
    if (!insuranceExpiry) {
      errors.push("Insurance expiry date is required.");
    } else if (insuranceExpiry <= new Date().toISOString().slice(0, 10)) {
      errors.push("Insurance has expired. Renew it before listing this bike.");
    }
    if (motoCategory && !MOTORBIKE_CATEGORIES.includes(motoCategory)) {
      errors.push("Choose a valid bike category.");
    }
    if (errors.length) return fail(errors);
    return ok({
      make: cleanText(raw.make, 80),
      model: cleanText(raw.model, 80),
      plateNumber,
      chassisNumber: cleanText(raw.chassisNumber, 40).toUpperCase(),
      motoCategory: motoCategory || "scooter",
      engineCc,
      insuranceExpiry,
      helmetsProvided: asInteger(raw.helmetsProvided) || 0,
      quantity,
    });
  }

  const seats = raw.seats == null || raw.seats === "" ? null : asInteger(raw.seats);
  if (seats != null && (!Number.isFinite(seats) || seats < 1)) errors.push("Seats must be at least 1.");
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

const validateBooking = ({ payload = {}, listing = {}, inventory = {}, subtype = "car-rental" } = {}) => {
  const raw = asObject(payload);
  const listingDetails = asObject(listing.listingAttributes || listing);
  const errors = [];
  const rentalLocations = resolveRentalLocations(listing);
  const pickupLocation = subtype === "taxi"
    ? cleanText(raw.pickupLocation, 200)
    : rentalLocations.pickupLocation;
  const returnLocation = subtype === "taxi"
    ? cleanText(raw.returnLocation || raw.dropoffLocation, 200)
    : rentalLocations.returnLocation;
  const pickupDateTime = asDateTime(raw.pickupDateTime);
  const returnDateTime = asDateTime(raw.returnDateTime);
  const dropoffLocation = cleanText(raw.dropoffLocation, 200);

  if (subtype === "taxi") {
    if (!pickupLocation) errors.push("Pickup location is required.");
  } else if (!pickupLocation) {
    errors.push("The provider has not set a pickup location for this rental.");
  }
  if (!pickupDateTime) errors.push("Pickup date/time is required.");

  if (subtype === "taxi") {
    if (!dropoffLocation) errors.push("Drop-off location is required.");
  } else {
    if (!returnLocation) errors.push("The provider has not set a return location for this rental.");
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
  let licenceClass = "";
  let licenceImageFront = "";
  let licenceImageBack = "";
  let selectedCategory = "";

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

  if (subtype === "motorbike") {
    driverAge = asInteger(raw.driverAge);
    driverLicenseNumber = cleanText(raw.driverLicenseNumber, 80).toUpperCase();
    selectedCategory = cleanText(raw.selectedCategory, 40);
    const minimumAge = asInteger(listingDetails.minimumDriverAge) || 16;
    if (!Number.isFinite(driverAge) || driverAge < minimumAge) {
      errors.push(`Rider must be at least ${minimumAge} years old.`);
    }
    if (!driverLicenseNumber) errors.push("Driving licence number is required.");
    if (selectedCategory && !MOTORBIKE_CATEGORIES.includes(selectedCategory)) {
      errors.push("Choose a valid bike category.");
    }
  }

  if (subtype === "car-rental" || subtype === "motorbike") {
    const inventoryDetails = asObject(inventory.attributes || inventory);
    licenceClass = cleanText(raw.licenceClass, 10).toUpperCase();
    const allowed = Array.isArray(listingDetails.allowedLicenceClasses)
      ? listingDetails.allowedLicenceClasses
      : [];
    if (!licenceClass) {
      errors.push("Licence class is required.");
    } else if (!licenceClassesFor(subtype).includes(licenceClass)) {
      errors.push("Choose a valid licence class.");
    } else if (allowed.length && !allowed.includes(licenceClass)) {
      errors.push(`This provider only accepts these licence classes: ${allowed.join(", ")}.`);
    }

    // A bike over 125cc legally needs the full class A permit, not A1.
    const engineCc = asInteger(inventoryDetails.engineCc);
    if (subtype === "motorbike" && Number.isFinite(engineCc) && engineCc > 125 && licenceClass === "A1") {
      errors.push(`A bike of ${engineCc}cc needs a class A permit, not A1.`);
    }

    // An expired insurance sticker blocks the booking outright.
    const insuranceExpiry = String(inventoryDetails.insuranceExpiry || "").slice(0, 10);
    const lastRentalDay = String(raw.returnDateTime || returnDateTime || raw.pickupDateTime || "").slice(0, 10);
    if (insuranceExpiry && lastRentalDay && lastRentalDay > insuranceExpiry) {
      errors.push("This vehicle's insurance expires before the return date.");
    }

    if (listingDetails.requireLicenceUpload !== false) {
      licenceImageFront = cleanText(raw.licenceImageFront, 500);
      licenceImageBack = cleanText(raw.licenceImageBack, 500);
      if (!isHttpUrl(licenceImageFront)) errors.push("A photo of the front of the licence is required.");
      if (!isHttpUrl(licenceImageBack)) errors.push("A photo of the back of the licence is required.");
    } else {
      licenceImageFront = isHttpUrl(raw.licenceImageFront) ? cleanText(raw.licenceImageFront, 500) : "";
      licenceImageBack = isHttpUrl(raw.licenceImageBack) ? cleanText(raw.licenceImageBack, 500) : "";
    }
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
      licenceClass,
      licenceImageFront,
      licenceImageBack,
      selectedCategory,
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
  resolveRentalLocations,
};
