const contract = require("./accommodationContract");

module.exports = {
  domain: "accommodation",
  validateListing: contract.validateListing,
  validateInventory: contract.validateInventory,
  validateBooking: contract.validateBooking,
  calculateStayQuote: contract.calculateStayQuote,
  sanitizeListingAttributesForPublic: contract.sanitizeListingAttributesForPublic,
  PROPERTY_KINDS: contract.PROPERTY_KINDS,
  PROPERTY_AMENITIES: contract.PROPERTY_AMENITIES,
};
