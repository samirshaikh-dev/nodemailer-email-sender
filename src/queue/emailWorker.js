import { Worker } from "bullmq";
import { config } from "../config/env.js";
import { createRedisConnection } from "../config/redis.js";
import { sendRecipients } from "../email/send.js";
import { recordFailures } from "../failures/record.js";
import { logger } from "../logger.js";

const connection = createRedisConnection();

export const emailWorker = connection
  ? new Worker(
      "emailQueue",
      async (job) => {
        const { recipients } = job.data;
        logger.info(`Processing job ${job.id} with ${recipients.length} recipients`);

        const failures = await sendRecipients(recipients);
        await recordFailures(failures);

        const result = {
          total: recipients.length,
          sent: recipients.length - failures.length,
          failed: failures.length,
          failures,
        };

        logger.info(`Completed job ${job.id}: ${result.sent} sent, ${result.failed} failed`);
        return result;
      },
      {
        connection,
        concurrency: config.redis.concurrency,
      }
    )
  : null;

if (emailWorker) {
  emailWorker.on("completed", (job) => {
    logger.info(`Job ${job.id} marked as completed`);
  });

  emailWorker.on("failed", (job, error) => {
    logger.error(`Job ${job?.id} failed: ${error.message}`);
  });

  emailWorker.on("error", (error) => {
    logger.error(`Worker error: ${error.message}`);
  });
}

export const closeEmailWorker = async () => {
  if (emailWorker) {
    await emailWorker.close();
  }
};
