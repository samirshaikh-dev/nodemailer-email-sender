import { Router } from "express";
import { getReadiness } from "../health.js";

export const healthRouter = Router();

/**
 * The single health endpoint. Reports the process state and, in the same response, a
 * probe of every configured dependency — so callers get a liveness answer and a
 * readiness answer without a second route.
 *
 * 200 while the process is up and every *configured* dependency is reachable; 503 when a
 * required one is down. An unconfigured MongoDB or Redis reports "disabled" and does not
 * fail the response, which keeps the optional-dependency contract in §9a intact.
 */
healthRouter.get("/", async (_req, res) => {
  const report = await getReadiness();
  res.status(report.ready ? 200 : 503).json({
    status: report.ready ? "ok" : "unavailable",
    uptimeSeconds: report.uptimeSeconds,
    timestamp: report.timestamp,
    checks: report.checks,
  });
});
