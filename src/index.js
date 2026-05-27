require("dotenv").config({ quiet: true });
const http = require("http");
const app = require("./app");
const connectDB = require("./config/db");
const seedAdmin = require("./utils/seedAdmin");
const { initRealtime } = require("./utils/realtime");
const { setDbReady } = require("./middleware/databaseMiddleware");

const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === "production";
const requireDbOnStartup =
  String(process.env.REQUIRE_DB_ON_STARTUP || (isProduction ? "true" : "false")).toLowerCase() ===
  "true";

const startServer = async () => {
  try {
    await connectDB();
    setDbReady(true);
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

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

startServer();
