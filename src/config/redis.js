import IORedis from "ioredis";
import { config } from "./env.js";

export const getRedisOptions = () => {
  const url = config.redis.url;
  if (!url) return null;

  const isTls = url.startsWith("rediss://");

  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    tls: isTls ? { rejectUnauthorized: false } : undefined,
  };
};

export const createRedisConnection = () => {
  const url = config.redis.url;
  if (!url) return null;

  return new IORedis(url, getRedisOptions());
};
