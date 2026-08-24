const {
  fail,
  ok,
  asObject,
  cleanText,
  asBoolean,
  asInteger,
  asDateOnly,
  asTime,
  isPastDate,
} = require("./shared/helpers");

const validateListing = (input = {}) => {
  const raw = asObject(input);
  const errors = [];
  const maxCapacity = asInteger(raw.maxCapacity);
  if (!Number.isFinite(maxCapacity) || maxCapacity < 1) errors.push("Max capacity must be at least 1.");
  if (errors.length) return fail(errors);
  return ok({
    maxCapacity,
    amenities: cleanText(raw.amenities, 1000),
    cateringAvailable: asBoolean(raw.cateringAvailable),
  });
};

const validateInventory = (input = {}) => {
  const raw = asObject(input);
  return ok({
    packageName: cleanText(raw.packageName, 120),
  });
};

const validateBooking = ({ payload = {}, listing = {} } = {}) => {
  const raw = asObject(payload);
  const listingDetails = asObject(listing.listingAttributes || listing);
  const errors = [];
  const eventDate = asDateOnly(raw.eventDate);
  const startTime = asTime(raw.startTime);
  const endTime = asTime(raw.endTime);
  const attendees = asInteger(raw.attendees);

  if (!eventDate) errors.push("Event date is required.");
  if (eventDate && isPastDate(eventDate)) errors.push("Event date cannot be in the past.");
  if (!startTime) errors.push("Start time is required.");
  if (!endTime) errors.push("End time is required.");
  if (startTime && endTime && endTime <= startTime) errors.push("End time must be after start time.");
  if (!Number.isFinite(attendees) || attendees < 1) errors.push("Attendees must be at least 1.");
  const capacity = asInteger(listingDetails.maxCapacity);
  if (Number.isFinite(capacity) && Number.isFinite(attendees) && attendees > capacity) {
    errors.push(`This venue holds a maximum of ${capacity} attendees.`);
  }
  if (errors.length) return fail(errors);

  return ok({
    payload: {
      eventDate,
      startTime,
      endTime,
      attendees,
      setupStyle: cleanText(raw.setupStyle, 80),
      avNeeds: cleanText(raw.avNeeds, 1000),
      catering: cleanText(raw.catering, 1000),
    },
    schedule: {
      startDate: eventDate,
      endDate: eventDate,
      startTime,
      endTime,
      guests: attendees,
      numberOfPeople: attendees,
      quantity: 1,
    },
  });
};

module.exports = {
  domain: "venues",
  validateListing,
  validateInventory,
  validateBooking,
};
