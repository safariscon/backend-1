const mongoose = require("mongoose");
const dns = require("dns");

const SRV_LOOKUP_ERROR_CODES = new Set([
  "ETIMEOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ESERVFAIL",
]);

const buildConnectionOptions = () => ({
  serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 10000),
  family: 4,
});

const shouldRetryWithDirectUri = (error) => {
  if (!error) return false;

  const message = String(error.message || "");
  return (
    SRV_LOOKUP_ERROR_CODES.has(error.code) ||
    message.includes("querySrv") ||
    message.includes("_mongodb._tcp")
  );
};

const connectDB = async () => {
  const srvUri = process.env.MONGODB_URI;
  const directUri = process.env.MONGODB_URI_DIRECT;
  const preferDirect = String(process.env.MONGODB_PREFER_DIRECT || "true").toLowerCase() === "true";

  if (!srvUri && !directUri) {
    throw new Error("MONGODB_URI or MONGODB_URI_DIRECT must be set.");
  }

  const connectionOptions = buildConnectionOptions();

  if (preferDirect && directUri) {
    await mongoose.connect(directUri, connectionOptions);
    console.log("MongoDB connected using direct URI");
    return;
  }

  // Workaround for environments where Node SRV lookups fail with ECONNREFUSED.
  // You can override with DNS_SERVERS in .env, e.g. DNS_SERVERS=8.8.8.8,1.1.1.1
  const dnsServers = (process.env.DNS_SERVERS || "8.8.8.8,1.1.1.1")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (dnsServers.length > 0) {
    dns.setServers(dnsServers);
    console.log(`Using DNS servers: ${dnsServers.join(", ")}`);
  }

  if (srvUri) {
    try {
      await mongoose.connect(srvUri, connectionOptions);
      console.log("MongoDB connected using SRV URI");
      return;
    } catch (error) {
      if (!directUri || !shouldRetryWithDirectUri(error)) {
        throw error;
      }

      console.warn(
        `Primary Mongo SRV connection failed (${error.code || "unknown"}). Retrying with direct URI...`
      );
    }
  }

  await mongoose.connect(directUri, connectionOptions);
  console.log("MongoDB connected using direct URI");
};

module.exports = connectDB;
