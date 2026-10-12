const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const pinoHttp = require("pino-http");
const config = require("./config");
const { pool } = require("./db");
const { notFound, errorHandler } = require("./middleware/errors");

const auth = require("./routes/auth");
const venues = require("./routes/venues");
const bookings = require("./routes/bookings");
const owner = require("./routes/owner");
const admin = require("./routes/admin");
const images = require("./routes/images");

const app = express();
app.set("trust proxy", 1);
app.use(
  pinoHttp({
    level: config.logLevel,
    redact: ["req.headers.authorization", "req.headers.cookie"],
  }),
);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(
  cors({ origin: config.corsOrigin.split(",").map((item) => item.trim()) }),
);
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(
  "/api",
  rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: "draft-8" }),
);

app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
app.get("/health/ready", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ready" });
  } catch (_error) {
    res.status(503).json({ status: "not-ready" });
  }
});

app.use("/api/auth", auth);
app.use("/api/images", images);
app.use("/api/venues", venues);
app.use("/api/bookings", bookings);
app.use("/api/owner", owner);
app.use("/api/admin", admin);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
