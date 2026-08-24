const {
  fail,
  ok,
  asObject,
  cleanText,
  asBoolean,
  asInteger,
  asDateOnly,
  isPastDate,
} = require("./shared/helpers");

const DIFFICULTIES = ["Easy", "Moderate", "Challenging"];
const PACKAGE_TYPES = ["Adult", "Child", "Family"];

const validateListing = (input = {}) => {
  const raw = asObject(input);
  const errors = [];
  const duration = cleanText(raw.duration, 80);
  const meetingPoint = cleanText(raw.meetingPoint, 200);
  if (!duration) errors.push("Duration is required.");
  const difficulty = cleanText(raw.difficulty, 20);
  if (difficulty && !DIFFICULTIES.includes(difficulty)) errors.push("Difficulty is invalid.");
  if (errors.length) return fail(errors);
  return ok({
    duration,
    difficulty: difficulty || "Easy",
    meetingPoint,
    included: cleanText(raw.included, 2000),
    excluded: cleanText(raw.excluded, 2000),
  });
};

const validateInventory = (input = {}) => {
  const raw = asObject(input);
  const packageType = cleanText(raw.packageType, 20);
  if (packageType && !PACKAGE_TYPES.includes(packageType)) {
    return fail(["Package type must be Adult, Child, or Family."]);
  }
  return ok({ packageType: packageType || "Adult" });
};

const validateBooking = ({ payload = {}, inventory = {} } = {}) => {
  const raw = asObject(payload);
  const inventoryDetails = asObject(inventory.attributes || inventory);
  const errors = [];
  const preferredDate = asDateOnly(raw.preferredDate);
  const participants = asInteger(raw.participants);
  const adults = raw.adults == null || raw.adults === "" ? null : asInteger(raw.adults);
  const children = raw.children == null || raw.children === "" ? null : asInteger(raw.children);

  if (!preferredDate) errors.push("Preferred date is required.");
  if (preferredDate && isPastDate(preferredDate)) errors.push("Tour date cannot be in the past.");
  if (!Number.isFinite(participants) || participants < 1) errors.push("Participants must be at least 1.");
  if (adults != null && (!Number.isFinite(adults) || adults < 0)) errors.push("Adults must be 0 or more.");
  if (children != null && (!Number.isFinite(children) || children < 0)) errors.push("Children must be 0 or more.");
  if (Number.isFinite(adults) && Number.isFinite(children) && Number.isFinite(participants)) {
    if (adults + children !== participants) {
      errors.push("Adults plus children must equal the number of participants.");
    }
  }
  const capacity = asInteger(inventory.capacity || inventoryDetails.capacity);
  if (Number.isFinite(capacity) && Number.isFinite(participants) && participants > capacity) {
    errors.push(`This package allows a maximum of ${capacity} participants.`);
  }
  if (errors.length) return fail(errors);

  return ok({
    payload: {
      preferredDate,
      participants,
      adults: adults ?? participants,
      children: children ?? 0,
      language: cleanText(raw.language, 40),
      pickupRequired: asBoolean(raw.pickupRequired),
      specialRequirements: cleanText(raw.specialRequirements, 1000),
      packageType: inventoryDetails.packageType || "",
    },
    schedule: {
      startDate: preferredDate,
      endDate: preferredDate,
      startTime: "",
      endTime: "",
      guests: participants,
      numberOfPeople: participants,
      quantity: 1,
    },
  });
};

module.exports = {
  domain: "experiences",
  validateListing,
  validateInventory,
  validateBooking,
};
