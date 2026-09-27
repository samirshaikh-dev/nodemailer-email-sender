import path from "node:path";
import app from "./app.js";
import { config } from "./config/env.js";
import { connectToDatabase, disconnectFromDatabase } from "./db.js";
import { transporter } from "./config/mailer.js";
import { closeEmailQueue } from "./queue/emailQueue.js";
import { closeEmailWorker } from "./queue/emailWorker.js";
import { closeLoggers, logger } from "./logger.js";
import { findRepoPdf } from "./email/pdf.js";
import { loadBodyTemplate, loadSubjectTemplate } from "./email/template.js";

const start = async () => {
  const mongoReady = await connectToDatabase();
  const foundPdf = findRepoPdf();
  const foundBody = loadBodyTemplate();
  const foundSubject = loadSubjectTemplate();

  const server = app.listen(config.port, () => {
    logger.info(`Server listening on port ${config.port}`, {
      mongo: mongoReady ? "connected" : "unavailable (failed sends logged to file)",
      redis: config.redis.url ? "enabled" : "disabled (synchronous sends)",
      resumePdf: foundPdf ? path.basename(foundPdf) : "none (dynamic fallback)",
      template: foundBody ? "loaded" : "default fallback",
      subject: foundSubject || "default fallback",
    });
  });

  const shutdown = (signal) => async () => {
    logger.info(`${signal} received, shutting down`);
    server.close();
    transporter.close();
    await closeEmailWorker();
    await closeEmailQueue();
    await disconnectFromDatabase();
    // Flush buffered log writes before the process exits.
    await closeLoggers();
    process.exit(0);
  };

  process.on("SIGINT", shutdown("SIGINT"));
  process.on("SIGTERM", shutdown("SIGTERM"));
};

start().catch((error) => {
  logger.error(`Failed to start: ${error.message}`, { stack: error.stack });
  process.exit(1);
});
