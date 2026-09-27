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
        const jobStart = Date.now();
        logger.info(`Processing job ${job.id} with ${recipients.length} recipients`, {
          jobId: job.id,
          recipientCount: recipients.length,
        });

        const failures = await sendRecipients(recipients);
        await recordFailures(failures);

        const durationMs = Date.now() - jobStart;
        const result = {
          total: recipients.length,
          sent: recipients.length - failures.length,
          failed: failures.length,
          failures,
        };

        logger.info(`Completed job ${job.id}: ${result.sent} sent, ${result.failed} failed`, {
          jobId: job.id,
          durationMs,
          total: result.total,
          sent: result.sent,
          failed: result.failed,
          status: failures.length === 0 ? "completed" : "completed_with_errors",
        });
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
    logger.info(`Job ${job.id} marked as completed`, {
      jobId: job.id,
      status: "completed",
    });
  });

  emailWorker.on("failed", (job, error) => {
    logger.error(`Job ${job?.id} failed: ${error.message}`, {
      jobId: job?.id,
      code: error?.code,
      message: error?.message,
      stack: error?.stack,
      status: "failed",
    });
  });

  emailWorker.on("error", (error) => {
    logger.error(`Worker error: ${error.message}`, {
      code: error?.code,
      message: error?.message,
      stack: error?.stack,
      status: "failed",
    });
  });
}

export const closeEmailWorker = async () => {
  if (emailWorker) {
    await emailWorker.close();
  }
};
