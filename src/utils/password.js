const crypto = require("crypto");

const generateRandomPassword = (length = 10) => {
  const raw = crypto.randomBytes(length).toString("base64url");
  return raw.slice(0, length);
};

module.exports = { generateRandomPassword };
