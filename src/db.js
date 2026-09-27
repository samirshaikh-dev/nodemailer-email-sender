import mongoose from "mongoose";
import { config } from "./config/env.js";
import { logger } from "./logger.js";

export const connectToDatabase = async () => {
  if (!config.mongo.uri) {
    logger.warn("MONGODB_URI is not set, failed sends will be recorded to file", {
      file: config.logs.failureFile,
      status: "disabled",
    });
    return false;
  }

  const start = Date.now();
  try {
    await mongoose.connect(config.mongo.uri, {
      serverSelectionTimeoutMS: config.mongo.timeoutMs,
      connectTimeoutMS: config.mongo.timeoutMs,
    });
    const latencyMs = Date.now() - start;
    logger.info("MongoDB connected", { latencyMs, status: "completed" });
    return true;
  } catch (error) {
    const latencyMs = Date.now() - start;
    logger.error("MongoDB connection failed, falling back to file logging", {
      latencyMs,
      message: error.message,
      code: error.code,
      stack: error.stack,
      file: config.logs.failureFile,
      status: "failed",
    });
    return false;
  }
};

export const disconnectFromDatabase = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
};

export const isDatabaseReady = () => mongoose.connection.readyState === 1;
