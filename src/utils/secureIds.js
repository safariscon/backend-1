const crypto = require("crypto");

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const randomCode = (length = 10) => {
  let value = "";
  const bytes = crypto.randomBytes(length);
  for (let index = 0; index < length; index += 1) {
    value += alphabet[bytes[index] % alphabet.length];
  }
  return value;
};

const prefixedCode = (prefix, length = 10) => `${prefix}-${randomCode(length)}`;

const secureToken = (parts = []) =>
  crypto
    .createHash("sha256")
    .update(`${parts.join("|")}|${crypto.randomBytes(32).toString("hex")}`)
    .digest("hex");

module.exports = {
  prefixedCode,
  randomCode,
  secureToken,
};
