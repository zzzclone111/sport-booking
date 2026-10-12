const dotenv = require("dotenv");

dotenv.config();

function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || String(fallback), 10);
  if (!Number.isFinite(value)) throw new Error(`${name} must be an integer`);
  return value;
}

const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: intEnv("PORT", 3000),
  databaseUrl:
    process.env.DATABASE_URL ||
    "postgres://sporthub:sporthub@localhost:5432/sporthub",
  databaseSsl: process.env.DATABASE_SSL === "true",
  dbPoolMax: intEnv("DB_POOL_MAX", 10),
  jwtSecret: process.env.JWT_SECRET || "dev-only-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "8h",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:8080",
  redisUrl: process.env.REDIS_URL || "",
  logLevel: process.env.LOG_LEVEL || "info",
};

if (
  config.nodeEnv === "production" &&
  config.jwtSecret === "dev-only-change-me"
) {
  throw new Error("JWT_SECRET must be configured in production");
}

module.exports = config;
