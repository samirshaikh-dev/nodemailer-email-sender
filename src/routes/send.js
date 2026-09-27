import { Router } from "express";
import { normalizeRecipients } from "../email/normalize.js";
import { sendRecipients } from "../email/send.js";
import { recordFailures } from "../failures/record.js";
import { logger } from "../logger.js";
import { emailQueue } from "../queue/emailQueue.js";

export const sendRouter = Router();

// POST /send - Queue emails or send synchronously
sendRouter.post("/", async (req, res, next) => {
  try {
    const recipients = normalizeRecipients(req.body?.emails);
    logger.info("Recipient payload validated successfully", {
      requestId: req.id,
      recipientCount: recipients.length,
      status: "completed",
    });

    // If BullMQ is available and sync mode isn't explicitly requested, queue the job
    const runAsync = Boolean(emailQueue) && req.query.sync !== "true";

    if (runAsync) {
      const queueStart = Date.now();
      const job = await emailQueue.add("send-bulk-emails", { recipients });
      const latencyMs = Date.now() - queueStart;

      logger.info(`Email batch queued for background processing`, {
        requestId: req.id,
        jobId: job.id,
        recipientCount: recipients.length,
        latencyMs,
        status: "completed",
      });

      return res.status(202).json({
        ok: true,
        message: "Email batch accepted and queued for background sending",
        jobId: job.id,
        total: recipients.length,
        statusUrl: `/send/status/${job.id}`,
      });
    }

    // Synchronous execution fallback (or when ?sync=true)
    logger.info("Processing email batch synchronously", {
      requestId: req.id,
      recipientCount: recipients.length,
    });

    const failures = await sendRecipients(recipients);
    await recordFailures(failures);

    return res.json({
      ok: true,
      total: recipients.length,
      sent: recipients.length - failures.length,
      failed: failures.length,
      failures,
    });
  } catch (error) {
    next(error);
  }
});

// GET /send/status/:jobId - Check BullMQ job progress and results
sendRouter.get("/status/:jobId", async (req, res, next) => {
  try {
    if (!emailQueue) {
      return res.status(503).json({
        ok: false,
        error: "Redis/BullMQ is not enabled. Background jobs are inactive.",
      });
    }

    const { jobId } = req.params;
    const job = await emailQueue.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        ok: false,
        error: `Job with ID '${jobId}' not found.`,
      });
    }

    const state = await job.getState();

    return res.json({
      ok: true,
      jobId: job.id,
      state, // "waiting", "active", "completed", "failed", etc.
      progress: job.progress,
      result: job.returnvalue || null,
      failedReason: job.failedReason || null,
      attemptsMade: job.attemptsMade,
      timestamp: new Date(job.timestamp).toISOString(),
    });
  } catch (error) {
    next(error);
  }
});
