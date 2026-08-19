const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const rebookRoutes = require("./routes/rebookRoutes");
const hotelRoutes = require("./routes/hotelRoutes");
const publicRoutes = require("./routes/publicRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");
const geoRoutes = require("./routes/geoRoutes");
const { getDbState, requireDatabase } = require("./middleware/databaseMiddleware");
const { getXentripayPublicStatus } = require("./services/xentripayService");

const app = express();

const parseOrigins = () => {
  const configuredOrigins = (
    process.env.CORS_ORIGINS ||
    process.env.CLIENT_URL ||
    process.env.FLUTTER_WEB_URL ||
    process.env.WEB_APP_URL ||
    process.env.MOBILE_APP_URL ||
    process.env.FRONTEND_URL ||
    process.env.PUBLIC_FRONTEND_URL ||
    ""
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return [...new Set([
    ...configuredOrigins,
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
  ])];
};

const allowedOrigins = parseOrigins();

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      if (
        process.env.NODE_ENV !== "production" &&
        (origin.startsWith("http://localhost:") ||
          origin.startsWith("http://127.0.0.1:"))
      ) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept-Language", "X-App-Language"],
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  const database = getDbState();
  const payments = getXentripayPublicStatus();
  res.json({
    status: database.ready ? "ok" : "degraded",
    service: "safariscon-api",
    time: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    database,
    payments,
  });
});

app.use("/api/geo", geoRoutes);

app.use("/api", (req, res, next) => {
  if (req.path === "/health" || req.path.startsWith("/geo")) return next();
  return requireDatabase(req, res, next);
});

app.use("/api/auth", authRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/rebook", rebookRoutes);
app.use("/api/hotel", hotelRoutes);
app.use("/api/seller", hotelRoutes);
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
