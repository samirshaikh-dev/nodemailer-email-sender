import { logger } from "../logger.js";

export const notFoundHandler = (req, res) => {
  res.status(404).json({
    ok: false,
    error: `Cannot ${req.method} ${req.originalUrl}`,
  });
};

export const errorHandler = (error, req, res, _next) => {
  if (res.headersSent) return;

  if (error?.type === "entity.parse.failed") {
    logger.warn(`Malformed JSON body on ${req.method} ${req.originalUrl}`, {
      requestId: req?.id,
      method: req?.method,
      path: req?.originalUrl,
      reason: "malformed_json",
      status: "failed",
    });
    return res.status(400).json({ ok: false, error: "Malformed JSON body." });
  }

  const status = error?.status ?? error?.statusCode ?? 500;
  const message = status >= 500 ? "Internal server error" : error.message;

  if (status >= 500) {
    logger.error(`Unhandled error on ${req.method} ${req.originalUrl}`, {
      requestId: req?.id,
      method: req?.method,
      path: req?.originalUrl,
      code: error?.code,
      message: error?.message,
      stack: error?.stack,
      status: "failed",
    });
  } else {
    logger.warn(`Request failed with status ${status} on ${req.method} ${req.originalUrl}`, {
      requestId: req?.id,
      method: req?.method,
      path: req?.originalUrl,
      code: error?.code,
      message: error?.message,
      status: "failed",
    });
  }

  res.status(status).json({ ok: false, error: message });
};
