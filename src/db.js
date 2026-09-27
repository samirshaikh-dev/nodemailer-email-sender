import mongoose from "mongoose";
import { config } from "./config/env.js";
import { logger } from "./logger.js";

export const connectToDatabase = async () => {
  if (!config.mongo.uri) {
    logger.warn("MONGODB_URI is not set, failed sends will be recorded to file", {
      file: config.logs.failureFile,
    });
    return false;
  }

  try {
    await mongoose.connect(config.mongo.uri, {
      serverSelectionTimeoutMS: config.mongo.timeoutMs,
      connectTimeoutMS: config.mongo.timeoutMs,
    });
    logger.info("MongoDB connected");
    return true;
  } catch (error) {
    logger.error("MongoDB connection failed, falling back to file logging", {
      message: error.message,
      file: config.logs.failureFile,
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
