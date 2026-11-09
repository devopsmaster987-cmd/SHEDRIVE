// Central place for reading configuration from the environment.
// Nothing secret is ever hard-coded; .env.example documents the keys.
const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const nodeEnv = process.env.NODE_ENV || "development";

const config = {
  nodeEnv,
  port: asNumber(process.env.PORT, 5000),
  mongoUri: process.env.MONGODB_URI || "mongodb://localhost:27017/shedrive",
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:5173,http://localhost:8080")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  jwt: {
    secret: process.env.JWT_SECRET || "",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },
  faceServiceUrl: process.env.FACE_SERVICE_URL || "http://localhost:8000",
  // Optional Redis pub/sub for Socket.IO when the API runs as multiple replicas.
  redisUrl: process.env.REDIS_URL || "",
  faceConfidenceThreshold: asNumber(process.env.FACE_CONFIDENCE_THRESHOLD, 0.85),
  faceTimeoutMs: asNumber(process.env.FACE_TIMEOUT_MS, 20000),
  otpProvider: process.env.OTP_PROVIDER || "mock",
  otpExpiryMinutes: asNumber(process.env.OTP_EXPIRY_MINUTES, 10),
  otpMaxAttempts: asNumber(process.env.OTP_MAX_ATTEMPTS, 5),
  bcryptRounds: asNumber(process.env.BCRYPT_ROUNDS, nodeEnv === "test" ? 4 : 12),
  storageDir: process.env.STORAGE_DIR || path.resolve(__dirname, "../../storage"),
  fare: {
    base: asNumber(process.env.FARE_BASE, 40),
    perKm: asNumber(process.env.FARE_PER_KM, 14),
    roadFactor: asNumber(process.env.FARE_ROAD_FACTOR, 1.25),
    minimum: asNumber(process.env.FARE_MINIMUM, 50),
  },
  ride: {
    searchRadiusKm: asNumber(process.env.RIDE_SEARCH_RADIUS_KM, 5),
    offerTtlSeconds: asNumber(process.env.RIDE_OFFER_TTL_SECONDS, 45),
    requestTtlMinutes: asNumber(process.env.RIDE_REQUEST_TTL_MINUTES, 10),
  },
};

config.isProduction = config.nodeEnv === "production";

if (!config.jwt.secret) {
  throw new Error(
    "JWT_SECRET is required. Copy backend/.env.example to backend/.env and set a long random value."
  );
}

module.exports = config;
