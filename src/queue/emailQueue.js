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
