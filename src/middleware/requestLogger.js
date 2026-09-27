import crypto from "node:crypto";
import { logger } from "../logger.js";

/**
 * Middleware that traces incoming HTTP requests and responses with execution timing,
 * request IDs, recipient counts, and completion status.
 */
export const requestLogger = (req, res, next) => {
  const requestId = req.headers["x-request-id"] || crypto.randomUUID();
  req.id = requestId;
  res.setHeader("X-Request-Id", requestId);

  const startTime = Date.now();
  const recipientCount = Array.isArray(req.body?.emails) ? req.body.emails.length : undefined;

  logger.info(`Incoming ${req.method} ${req.originalUrl || req.url}`, {
    requestId,
    method: req.method,
    path: req.originalUrl || req.url,
    recipientCount,
  });

  res.on("finish", () => {
    const durationMs = Date.now() - startTime;
    const isError = res.statusCode >= 400;

    const logFn = isError && res.statusCode >= 500 ? logger.error : isError ? logger.warn : logger.info;

    logFn(`HTTP ${req.method} ${req.originalUrl || req.url} ${res.statusCode}`, {
      requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs,
      status: isError ? "failed" : "completed",
    });
  });

  next();
};
