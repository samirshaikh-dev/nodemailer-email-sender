import { config } from "./config/env.js";
import { transporter } from "./config/mailer.js";
import { verifyResend } from "./config/resend.js";
import { isDatabaseReady } from "./db.js";
import { logger } from "./logger.js";
import { isQueueReady } from "./queue/emailQueue.js";

const startedAt = Date.now();

/**
 * Readiness polls arrive every few seconds from orchestrators. Re-authenticating against
 * providers on each one is wasteful and rate-limit prone, so completed probes are
 * reused briefly. The Mongo and Redis checks read local connection state and are never cached.
 */
const PROBE_TTL_MS = 15000;
let smtpProbeCache = null;
let resendProbeCache = null;

/**
 * Releases the caller once `work` settles or `timeoutMs` elapses, whichever comes first.
 * The losing promise is not cancelled — it settles later and is discarded — but the request
 * is freed on time, which is the only property a health endpoint actually needs.
 */
const withTimeout = (work, timeoutMs) => {
  let timer;
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`probe timed out after ${timeoutMs}ms`)), timeoutMs);
    // Never let a pending probe timer hold the process open during shutdown.
    timer.unref?.();
  });

  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
};

const checkMongo = () => {
  // Required only when a URI was supplied. Without one, failures are written to
  // logs/failed-emails.log and the send API is fully functional (see §9a), so an
  // unconfigured database must not fail readiness.
  if (!config.mongo.uri) {
    return { status: "disabled", required: false, latencyMs: 0 };
  }
  return { status: isDatabaseReady() ? "ok" : "unavailable", required: true, latencyMs: 0 };
};

const checkSmtp = async () => {
  if (config.email.provider !== "smtp") {
    return { status: "disabled", required: false, latencyMs: 0 };
  }

  if (!transporter) {
    return { status: "unavailable", required: true, latencyMs: 0 };
  }

  const cached = smtpProbeCache;
  if (cached && Date.now() - cached.at < PROBE_TTL_MS) {
    return { ...cached.result, cached: true };
  }

  const started = Date.now();
  let result;
  try {
    await withTimeout(transporter.verify(), config.health.probeTimeoutMs);
    result = { status: "ok", required: true, latencyMs: Date.now() - started };
  } catch (error) {
    result = { status: "unavailable", required: true, latencyMs: Date.now() - started };
    // The provider's reply can name the rejected account, so it is logged rather than
    // returned: /health is unauthenticated and served to every origin.
    logger.warn("SMTP readiness probe failed", {
      latencyMs: Date.now() - started,
      code: error.code,
      message: error.message,
      stack: error.stack,
      status: "failed",
    });
  }

  smtpProbeCache = { at: Date.now(), result };
  return { ...result, cached: false };
};

const checkResend = async () => {
  if (config.email.provider !== "resend") {
    return { status: "disabled", required: false, latencyMs: 0 };
  }

  if (!config.resend.apiKey) {
    return { status: "unavailable", required: true, latencyMs: 0 };
  }

  const cached = resendProbeCache;
  if (cached && Date.now() - cached.at < PROBE_TTL_MS) {
    return { ...cached.result, cached: true };
  }

  const started = Date.now();
  let result;
  try {
    await verifyResend(config.health.probeTimeoutMs);
    result = { status: "ok", required: true, latencyMs: Date.now() - started };
  } catch (error) {
    result = { status: "unavailable", required: true, latencyMs: Date.now() - started };
    logger.warn("Resend readiness probe failed", {
      latencyMs: Date.now() - started,
      code: error.code,
      message: error.message,
      stack: error.stack,
      status: "failed",
    });
  }

  resendProbeCache = { at: Date.now(), result };
  return { ...result, cached: false };
};

const checkRedis = async () => {
  if (!config.redis.url) {
    return { status: "disabled", required: false, latencyMs: 0 };
  }
  const started = Date.now();
  const ready = await isQueueReady(config.health.probeTimeoutMs);
  const latencyMs = Date.now() - started;
  if (!ready) {
    logger.warn("Redis readiness probe failed", {
      latencyMs,
      status: "failed",
    });
  }
  return { status: ready ? "ok" : "unavailable", required: true, latencyMs };
};

/**
 * Dependency snapshot backing `GET /health`. A dependency is only *required* when it has
 * been configured, so in development an absent MongoDB or Redis reports "disabled" and
 * still yields 200 — mirroring the optional-dependency contract rather than inverting it.
 */
export const getReadiness = async () => {
  const [mongo, smtp, resend, redis] = await Promise.all([
    checkMongo(),
    checkSmtp(),
    checkResend(),
    checkRedis(),
  ]);
  const checks = { mongo, smtp, resend, redis };
  const failing = Object.values(checks).some(
    (check) => check.required && check.status === "unavailable"
  );

  return {
    ready: !failing,
    uptimeSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
    timestamp: new Date().toISOString(),
    checks,
  };
};
