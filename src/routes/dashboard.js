import { Router } from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { config } from "../config/env.js";
import { emailQueue } from "../queue/emailQueue.js";

export const dashboardRouter = Router();

if (emailQueue) {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(config.bullBoard.basePath);

  createBullBoard({
    queues: [new BullMQAdapter(emailQueue)],
    serverAdapter,
  });

  dashboardRouter.use("/", serverAdapter.getRouter());
} else {
  dashboardRouter.use("/", (_req, res) => {
    res.status(503).json({
      ok: false,
      error: "BullMQ dashboard is unavailable because Redis is not configured.",
    });
  });
}
