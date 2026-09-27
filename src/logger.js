import winston from "winston";
import { config } from "./config/env.js";

const jsonFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.errors({ stack: true }),
  winston.format.timestamp(),
  winston.format.printf(({ level, message, timestamp, ...rest }) => {
    const extras = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
    return `${timestamp} ${level}: ${message}${extras}`;
  })
);

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
