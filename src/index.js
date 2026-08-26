const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const envPath = path.resolve(__dirname, "../.env");
dotenv.config({ path: envPath, quiet: true });

if (fs.existsSync(envPath)) {
  const parsedEnv = dotenv.parse(fs.readFileSync(envPath));
  [
    "MONGODB_URI",
    "MONGODB_URI_DIRECT",
    "MONGODB_PREFER_DIRECT",
    "MONGODB_TLS_ALLOW_INVALID_CERTS",
    "DNS_SERVERS",
    "JWT_SECRET",
    "ADMIN_EMAIL",
    "ADMIN_PASSWORD",
    "XENTRIPAY_ENV",
    "XENTRIPAY_API_KEY",
    "XENTRIPAY_BASE_URL",
    "XENTRIPAY_SIMULATE_SUCCESS",
    "XENTRIPAY_CURRENCY",
    "XENTRIPAY_MIN_AMOUNT",
    "XENTRIPAY_CHARGES_INCLUDED",
    "XENTRIPAY_MERCHANT_NAME",
    "XENTRIPAY_MERCHANT_EMAIL",
    "XENTRIPAY_MERCHANT_PHONE",
    "FRONTEND_URL",
    "PUBLIC_FRONTEND_URL",
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
const { getXentripayPublicStatus } = require("./services/xentripayService");
const { runRebookExpiryCleanup } = require("./controllers/rebookController");
const { runBookingNoActionRefundCleanup, runPendingPaymentSync, runReleasedProviderPayouts } = require("./controllers/bookingController");
const { runUnpaidBookingHoldCleanup } = require("./services/bookingHoldService");

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

const logUnpaidHoldSummary = (summary) => {
  const released = Number(summary?.releasedOrphans || 0);
  const expired = Number(summary?.expiredUnpaid || 0);
  if (!released && !expired) return;
  console.log(`Unpaid booking holds released: orphans=${released}, expired=${expired}`);
};

const startRebookExpiryCleanup = () => {
  let isRunning = false;

  const run = async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      logRebookExpirySummary(await runRebookExpiryCleanup());
      logBookingRefundSummary(await runBookingNoActionRefundCleanup());
      logUnpaidHoldSummary(await runUnpaidBookingHoldCleanup());
      await runPendingPaymentSync();
      try {
        await runReleasedProviderPayouts();
      } catch (payoutError) {
        console.warn("Held provider payout job failed:", payoutError.message);
      }
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
    try {
      const { ensureSeededCategories } = require("./utils/ensureCategories");
      const seeded = await ensureSeededCategories();
      if (seeded.seeded) console.log(`Seeded ${seeded.count} service categories.`);
    } catch (seedError) {
      console.warn("Service category seed skipped:", seedError.message);
    }
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
      const payments = getXentripayPublicStatus();
      console.log(`Server running on port ${PORT}`);
      console.log(
        `XentriPay ${payments.configured ? "CONFIGURED" : "NOT CONFIGURED"} (${payments.env}) ${payments.baseUrl}`
      );
      if (!payments.configured) {
        console.warn("MoMo prompts will not reach phones until XENTRIPAY_API_KEY is set in backend .env.");
      }
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

startServer();
