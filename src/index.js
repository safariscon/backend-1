const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ quiet: true });

const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  const parsedEnv = dotenv.parse(fs.readFileSync(envPath));
  [
    "MONGODB_URI",
    "MONGODB_URI_DIRECT",
    "MONGODB_PREFER_DIRECT",
    "DNS_SERVERS",
    "JWT_SECRET",
    "ADMIN_EMAIL",
    "ADMIN_PASSWORD",
  ].forEach((key) => {
    if (parsedEnv[key] !== undefined) process.env[key] = parsedEnv[key];
  });
}
const http = require("http");
const app = require("./app");
const connectDB = require("./config/db");
const seedAdmin = require("./utils/seedAdmin");
const { initRealtime } = require("./utils/realtime");
const { setDbReady } = require("./middleware/databaseMiddleware");
const { runRebookExpiryCleanup } = require("./controllers/rebookController");
const { runBookingNoActionRefundCleanup } = require("./controllers/bookingController");

const PORT = process.env.PORT || 5000;
const REBOOK_EXPIRY_INTERVAL_MS = 5 * 60 * 1000;
const isProduction = process.env.NODE_ENV === "production";
const requireDbOnStartup =
  String(process.env.REQUIRE_DB_ON_STARTUP || (isProduction ? "true" : "false")).toLowerCase() ===
  "true";

const logRebookExpirySummary = (summary) => {
  const total =
    Number(summary?.pendingExpired || 0) +
    Number(summary?.cancelExpired || 0) +
    Number(summary?.generatedIdExpired || 0);
  if (!total) return;
  console.log(
    `Re-book cleanup expired ${total} request(s): pending=${summary.pendingExpired}, cancel=${summary.cancelExpired}, generatedId=${summary.generatedIdExpired}`
  );
};

const logBookingRefundSummary = (summary) => {
  const total = Number(summary?.noActionRefunded || 0);
  if (!total) return;
  console.log(`Booking refund cleanup applied ${total} no-action refund(s).`);
};

const startRebookExpiryCleanup = () => {
  let isRunning = false;

  const run = async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      logRebookExpirySummary(await runRebookExpiryCleanup());
      logBookingRefundSummary(await runBookingNoActionRefundCleanup());
    } catch (error) {
      console.warn("Re-book cleanup failed:", error.message);
    } finally {
      isRunning = false;
    }
  };

  run();
  return setInterval(run, REBOOK_EXPIRY_INTERVAL_MS);
};

const startServer = async () => {
  let databaseReady = false;
  try {
    await connectDB();
    setDbReady(true);
    databaseReady = true;
    await seedAdmin();
  } catch (error) {
    setDbReady(false, error.message);
    if (requireDbOnStartup) {
      console.error("Failed to start server:", error.message);
      process.exit(1);
    }

    console.warn(
      `MongoDB is not connected (${error.message}). Starting local server in degraded mode.`
    );
    console.warn(
      "Fix MONGODB_URI credentials or Atlas Network Access before using login, bookings, or dashboards."
    );
  }

  try {
    const server = http.createServer(app);
    initRealtime(server);
    if (databaseReady) startRebookExpiryCleanup();

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

startServer();
