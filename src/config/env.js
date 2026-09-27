import "dotenv/config";
import path from "node:path";

const LOG_LEVELS = new Set(["error", "warn", "info", "http", "verbose", "debug", "silly"]);

const readNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const readBoolean = (value, fallback = false) => {
  if (value === undefined || value === "") return fallback;
  return value === "true";
};

const readRequired = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example for the full list.`
    );
  }
  return value;
};

const smtp = {
  host: readRequired("SMTP_HOST"),
  port: readNumber(process.env.SMTP_PORT, 587),
  secure: readBoolean(process.env.SMTP_SECURE),
  user: readRequired("SMTP_USER"),
  pass: readRequired("SMTP_PASS"),
  maxConnections: readNumber(process.env.SMTP_MAX_CONNECTIONS, 5),
  maxMessages: readNumber(process.env.SMTP_MAX_MESSAGES, 100),
  from: process.env.SMTP_FROM || `"Email Sender" <${process.env.SMTP_USER}>`,
};

const redis = {
  url: process.env.REDIS_URL || null,
  concurrency: readNumber(process.env.QUEUE_CONCURRENCY, 5),
};

// Relative to the process working directory, which is the project root under npm scripts.
// The failure log is the last-resort record of undelivered mail, so it is written to disk
// and never to the database it is standing in for.
const logDir = process.env.LOG_DIR || "logs";

const logs = {
  dir: logDir,
  level: LOG_LEVELS.has(process.env.LOG_LEVEL) ? process.env.LOG_LEVEL : "info",
  appFile: path.join(logDir, "app.log"),
  failureFile: path.join(logDir, "failed-emails.log"),
};

const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";
const isDevelopment = nodeEnv === "development";
const isTest = nodeEnv === "test";

// Production safeguards: enforce essential infrastructure in production
if (isProduction) {
  if (!process.env.REDIS_URL) {
    throw new Error(
      "Missing required environment variable in production: REDIS_URL. Bulk email queues require Redis."
    );
  }
  if (!process.env.MONGODB_URI) {
    throw new Error(
      "Missing required environment variable in production: MONGODB_URI. Failure logging requires MongoDB in production."
    );
  }
}

const email = {
  autoAttachPdf: readBoolean(process.env.AUTO_ATTACH_PDF, true),
};

export const config = {
  env: nodeEnv,
  isProduction,
  isDevelopment,
  isTest,
  port: readNumber(process.env.PORT, 4000),
  smtp,
  email,
  mongo: {
    uri: process.env.MONGODB_URI || null,
    // Bounded so an unreachable MongoDB cannot stall startup. Mongoose otherwise waits
    // 30s by default, which would block the HTTP listener behind an optional dependency.
    timeoutMs: readNumber(process.env.MONGO_TIMEOUT_MS, 5000),
  },
  redis,
  logs,
};
