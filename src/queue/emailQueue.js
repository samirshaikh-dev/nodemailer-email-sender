import { Queue } from "bullmq";
import { createRedisConnection } from "../config/redis.js";

const connection = createRedisConnection();

export const emailQueue = connection
  ? new Queue("emailQueue", {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
        removeOnComplete: {
          count: 1000,
          age: 24 * 3600,
        },
        removeOnFail: {
          count: 5000,
        },
      },
    })
  : null;

export const closeEmailQueue = async () => {
  if (emailQueue) {
    await emailQueue.close();
  }
};

/**
 * Bounded readiness probe for Redis, mirroring `isDatabaseReady()` in db.js.
 * BullMQ reconnects on its own, so an already-connected queue resolves immediately; the
 * timeout only bounds the first connection attempt. Returns false rather than throwing —
 * a probe must never be able to fail the health request.
 */
export const isQueueReady = async (timeoutMs) => {
  if (!emailQueue) return false;
  let timer;
  try {
    await Promise.race([
      emailQueue.waitUntilReady(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Redis did not become ready in time")), timeoutMs);
        timer.unref?.();
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};
