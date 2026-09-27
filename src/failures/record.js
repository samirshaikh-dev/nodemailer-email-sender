import { config } from "../config/env.js";
import { isDatabaseReady } from "../db.js";
import { FailedEmail } from "../models/FailedEmail.js";
import { logger, writeFailureLog } from "../logger.js";

let hasWarnedAboutFallback = false;

const warnAboutFallback = (reason) => {
  if (hasWarnedAboutFallback) return;
  hasWarnedAboutFallback = true;
  logger.warn("MongoDB unavailable, recording failed sends to file instead", {
    reason,
    file: config.logs.failureFile,
  });
};

const toDocuments = (failures) =>
  failures.map(({ email, subject, reason, error }) => ({ email, subject, reason, error }));

const toLogEntries = (failures) => {
  const attemptedAt = new Date().toISOString();

  return failures.map(({ email, subject, reason, error }) => ({
    email,
    subject,
    reason,
    error,
    attemptedAt,
    source: "file-fallback",
  }));
};

const recordToFile = async (failures, reason) => {
  warnAboutFallback(reason);

  try {
    for (const entry of toLogEntries(failures)) {
      await writeFailureLog(entry);
    }
    logger.info(`Recorded ${failures.length} failed send(s) to ${config.logs.failureFile}`);
  } catch (error) {
    logger.error(`Failed to write failure log: ${error.message}`, { file: config.logs.failureFile });
  }
};

/**
 * Records failed sends to MongoDB when it is usable, and to a local JSONL file when it is
 * not. A failure to persist must never propagate: the HTTP response has already been
 * composed, and losing the record is preferable to failing the request.
 */
export const recordFailures = async (failures) => {
  if (failures.length === 0) return;

  if (!config.mongo.uri) {
    return recordToFile(failures, "MONGODB_URI is not set");
  }

  if (!isDatabaseReady()) {
    return recordToFile(failures, "MongoDB is not connected");
  }

  try {
    await FailedEmail.insertMany(toDocuments(failures));
  } catch (error) {
    return recordToFile(failures, `MongoDB insert failed: ${error.message}`);
  }
};
