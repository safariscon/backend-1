require("dotenv").config();
const http = require("http");
const app = require("./app");
const connectDB = require("./config/db");
const seedAdmin = require("./utils/seedAdmin");
const { initRealtime } = require("./utils/realtime");

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    app.locals.dbReady = false;

    try {
      await connectDB();
      app.locals.dbReady = true;
      await seedAdmin();
    } catch (error) {
      console.warn(`MongoDB unavailable: ${error.message}`);
      console.warn("Starting server without database-backed routes.");
    }

    const server = http.createServer(app);
    initRealtime(server);

    server.on("error", (error) => {
      console.error("Failed to start server:", error.message);
      process.exit(1);
    });

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

startServer();
