const {
  fail,
  ok,
  asObject,
  cleanText,
  asInteger,
  asNumber,
  asDateTime,
} = require("./shared/helpers");

const splitDateTime = (iso) => {
  if (!iso) return { date: "", time: "" };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  return {
    date: date.toISOString().slice(0, 10),
    time: date.toISOString().slice(11, 16),
  };
};

const validateListing = (input = {}, subtype = "restaurant") => {
  const raw = asObject(input);
  const errors = [];
  const seatingCapacity = asInteger(raw.seatingCapacity);
  if (!Number.isFinite(seatingCapacity) || seatingCapacity < 1) {
    errors.push("Seating capacity must be at least 1.");
  }
  if (subtype === "restaurant" || subtype === "cafe") {
    if (!cleanText(raw.cuisine, 80)) errors.push("Cuisine is required.");
  }
  if (errors.length) return fail(errors);
  return ok({
    cuisine: cleanText(raw.cuisine, 80),
    dressCode: cleanText(raw.dressCode, 80),
    atmosphere: cleanText(raw.atmosphere, 80),
    averagePrice: asNumber(raw.averagePrice),
    seatingCapacity,
    openingHours: cleanText(raw.openingHours, 500),
  });
};

const validateInventory = (input = {}) => ok(asObject(input));

const validateBooking = ({ payload = {}, listing = {} } = {}) => {
  const raw = asObject(payload);
  const listingDetails = asObject(listing.listingAttributes || listing);
  const errors = [];
  const reservationDateTime = asDateTime(raw.reservationDateTime);
  const partySize = asInteger(raw.partySize);
  if (!reservationDateTime) errors.push("Reservation date/time is required.");
  if (reservationDateTime && new Date(reservationDateTime).getTime() < Date.now() - 60 * 1000) {
    errors.push("Reservation cannot be in the past.");
  }
  if (!Number.isFinite(partySize) || partySize < 1) errors.push("Party size must be at least 1.");
  const capacity = asInteger(listingDetails.seatingCapacity);
  if (Number.isFinite(capacity) && Number.isFinite(partySize) && partySize > capacity) {
    errors.push(`This venue seats a maximum of ${capacity} guests.`);
  }
  if (errors.length) return fail(errors);

  const when = splitDateTime(reservationDateTime);
  return ok({
    payload: {
      reservationDateTime,
      partySize,
      allergies: cleanText(raw.allergies, 500),
      specialRequests: cleanText(raw.specialRequests, 1000),
    },
    schedule: {
      startDate: when.date,
      endDate: when.date,
      startTime: when.time,
      endTime: "",
      guests: partySize,
      numberOfPeople: partySize,
      quantity: 1,
    },
  });
};

module.exports = {
  domain: "dining",
  validateListing,
  validateInventory,
  validateBooking,
};
