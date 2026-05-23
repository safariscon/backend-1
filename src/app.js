const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const hpp = require("hpp");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const hotelRoutes = require("./routes/hotelRoutes");
const publicRoutes = require("./routes/publicRoutes");
const serviceRoutes = require("./routes/serviceRoutes");
const businessRoutes = require("./routes/businessRoutes");

const app = express();

const sanitizeMongoOperators = (value) => {
  if (!value || typeof value !== "object") return value;

  Object.keys(value).forEach((key) => {
    if (key.includes("$") || key.includes(".")) {
      delete value[key];
      return;
    }
    sanitizeMongoOperators(value[key]);
  });

  return value;
};

const sanitizeText = (value) => {
  if (typeof value === "string") {
    return value
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
      .replace(/javascript:/gi, "")
      .replace(/\son\w+\s*=/gi, "");
  }
  if (Array.isArray(value)) return value.map(sanitizeText);
  if (value && typeof value === "object") {
    Object.keys(value).forEach((key) => {
      value[key] = sanitizeText(value[key]);
    });
  }
  return value;
};

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(helmet());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);
app.use((req, _res, next) => {
  sanitizeMongoOperators(req.body);
  sanitizeMongoOperators(req.params);
  sanitizeMongoOperators(req.query);
  sanitizeText(req.body);
  sanitizeText(req.params);
  sanitizeText(req.query);
  next();
});
app.use(hpp());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", database: app.locals.dbReady ? "connected" : "unavailable" });
});

app.use("/api", (req, res, next) => {
  if (req.app.locals.dbReady) {
    return next();
  }

  return res.status(503).json({
    message: "Database unavailable. Check the MongoDB connection and try again.",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/businesses", businessRoutes);
app.post("/api/business/register", require("./controllers/authController").registerBusinessOwner);
app.use("/api/hotel", hotelRoutes);
app.use("/api/business", hotelRoutes);
app.use("/api", publicRoutes);

app.use((req, res) => {
  res.status(404).json({ message: `Route not found: ${req.originalUrl}` });
});

module.exports = app;
