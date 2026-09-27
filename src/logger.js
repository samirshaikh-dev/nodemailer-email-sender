import winston from "winston";
import { config } from "./config/env.js";

const SENSITIVE_KEYS = new Set([
  "password",
  "pass",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "auth",
  "cookie",
  "smtp_pass",
  "resend_api_key",
]);

const maskString = (str) => {
  if (typeof str !== "string") return str;
  let masked = str
    .replace(/(mongodb(?:\+srv)?:\/\/[^:]+:)([^@]+)(@)/gi, "$1***$3")
    .replace(/(redis:\/\/[^:]+:)([^@]+)(@)/gi, "$1***$3")
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]")
    .replace(/re_[A-Za-z0-9_]{10,}/gi, "re_[REDACTED]");

  if (config.logs.maskEmails) {
    masked = masked.replace(
      /\b([a-zA-Z0-9_.+-])[a-zA-Z0-9_.+-]*@([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)\b/g,
      "$1***@$2"
    );
  }
  return masked;
};

const redactInPlace = (target, seen = new WeakSet()) => {
  if (target === null || typeof target !== "object") return;
  if (seen.has(target)) return;
  seen.add(target);

  if (Array.isArray(target)) {
    for (let i = 0; i < target.length; i++) {
      if (typeof target[i] === "string") {
        target[i] = maskString(target[i]);
      } else if (typeof target[i] === "object" && target[i] !== null) {
        redactInPlace(target[i], seen);
      }
    }
    return;
  }

  for (const [key, value] of Object.entries(target)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      target[key] = "[REDACTED]";
    } else if (typeof value === "string") {
      target[key] = maskString(value);
    } else if (typeof value === "object" && value !== null) {
      redactInPlace(value, seen);
    }
  }
};

const redactFormat = winston.format((info) => {
  redactInPlace(info);
  return info;
});

const standardFieldsFormat = winston.format((info) => {
  info.service = config.serviceName || "email-sender";
  info.environment = config.env;
  info.pid = process.pid;
  info.context = {
    service: info.service,
    environment: info.environment,
    pid: info.pid,
  };
  return info;
});

const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  standardFieldsFormat(),
  redactFormat(),
  winston.format.json()
);

const consoleFormat =
  config.logs.format === "text" || config.logs.format === "pretty"
    ? winston.format.combine(
        winston.format.colorize(),
        winston.format.errors({ stack: true }),
        winston.format.timestamp(),
        standardFieldsFormat(),
        redactFormat(),
        winston.format.printf(({ level, message, timestamp, service, environment, pid, context, ...rest }) => {
          const extras = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
          return `${timestamp} [${service}/${environment}] ${level}: ${message}${extras}`;
        })
      )
    : jsonFormat;

const rotate = { maxsize: 5 * 1024 * 1024, maxFiles: 5, tailable: true };

export const logger = winston.createLogger({
  level: config.logs.level,
  format: jsonFormat,
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    new winston.transports.File({ filename: config.logs.appFile, ...rotate }),
  ],
});

/**
 * Dedicated JSONL sink for failed sends. Kept separate from the application log so the
 * failure stream stays machine-readable and can be replayed into MongoDB later.
 */
export const failureLogger = winston.createLogger({
  level: "info",
  format: jsonFormat,
  transports: [
    new winston.transports.File({
      filename: config.logs.failureFile,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    }),
  ],
});

/**
 * Winston writes asynchronously, so an un-awaited write can be lost if the process exits
 * immediately after responding. Awaiting the transport callback keeps the promise that
 * every failure is durably recorded somewhere.
 *
 * `logger.write(info, callback)` is the only completion signal that actually fires for a
 * File transport: `log(level, msg, meta, cb)` never invokes its callback and the "logged"
 * event does not fire. `write()` returns a backpressure boolean, not a stream.
 */
export const writeFailureLog = (record) =>
  new Promise((resolve, reject) => {
    failureLogger.write({ level: "info", message: "send_failed", ...record }, (error) =>
      error ? reject(error) : resolve()
    );
  });

export const closeLoggers = async () => {
  await Promise.all([logger.close(), failureLogger.close()]);
};
