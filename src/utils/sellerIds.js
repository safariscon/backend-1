const MAX_SERVICE_PROVIDER_IDS = 1000;

const formatSellerId = (number) => `SP${String(number).padStart(3, "0")}`;

const generateUniqueSellerId = async ({ exists, max = MAX_SERVICE_PROVIDER_IDS } = {}) => {
  if (typeof exists !== "function") {
    throw new Error("generateUniqueSellerId requires an exists function.");
  }

  const start = Math.floor(Math.random() * max);

  for (let offset = 0; offset < max; offset += 1) {
    const value = ((start + offset) % max) + 1;
    const sellerId = formatSellerId(value);
    if (!(await exists(sellerId))) return sellerId;
  }

  throw new Error(`No seller IDs are available. The ${max} service provider ID limit has been reached.`);
};

module.exports = {
  MAX_SERVICE_PROVIDER_IDS,
  formatSellerId,
  generateUniqueSellerId,
};
