const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const hotelRoutes = require("./routes/hotelRoutes");
const publicRoutes = require("./routes/publicRoutes");
const { getDbState, requireDatabase } = require("./middleware/databaseMiddleware");

const app = express();

const parseOrigins = () =>
  (
    process.env.CORS_ORIGINS ||
    process.env.FRONTEND_URL ||
    process.env.PUBLIC_FRONTEND_URL ||
    "https://safariscon.vercel.app,http://localhost:5173,http://localhost:4173"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const allowedOrigins = parseOrigins();

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  const database = getDbState();
  res.json({
    status: database.ready ? "ok" : "degraded",
    service: "safariscon-api",
    time: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    database,
  });
});

app.use("/api", (req, res, next) => {
  if (req.path === "/health") return next();
  return requireDatabase(req, res, next);
});

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/hotel", hotelRoutes);
app.use("/api", publicRoutes);

app.use((req, res) => {
  res.status(404).json({ message: `Route not found: ${req.originalUrl}` });
});

app.use((error, _req, res, _next) => {
  console.error("Unhandled API error:", error);
  res.status(error.status || 500).json({
    message: error.message || "Internal server error.",
  });
});

module.exports = app;
