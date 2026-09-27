# context.md — nodemailer-email-sender

Engineering context for a **Minimal Email Sending Backend**: a Node.js/Express service that sends
bulk or individual email over **either** pooled SMTP (Nodemailer) **or** the Resend HTTPS API, and
durably records every delivery failure to MongoDB with a file fallback.

> **Status:** 23 modules, dual-provider. The original single-file `app.js` has since been split
> (§10), then grown four more ways: a provider abstraction, a Bull Board dashboard, request
> tracing, and generated PDF attachments. See [Refactor History](#10-refactor-history).

---

## 1. Purpose

Accept a batch of recipients over HTTP, deliver a message to each through a pooled SMTP
connection **or** the Resend REST API, and guarantee that **every** failure is both returned in the
response and durably recorded. A partial batch failure is a normal, expected outcome — not an
error — so the endpoint reports per-recipient results and returns HTTP 200 even when every send
fails.

The transport is a **startup-time decision** (`EMAIL_PROVIDER`), not a per-request one. There is
one transport per process; switching provider means restarting.

Non-goals: templating beyond `data/*.txt`, scheduling, bounce/webhook processing, delivery
receipt tracking, per-recipient-domain rate limiting.

---

## 2. Tech Stack

| Layer | Choice | Installed |
|---|---|---|
| Runtime | Node.js (ESM, `"type": "module"`) | v24.16.0 (Dockerfile pins `node:20-alpine`) |
| Package manager | npm | 11.13.0 |
| HTTP | Express | 4.21.2 |
| CORS | cors | 2.8.5 |
| Mailing (SMTP) | Nodemailer (pooled) | 6.10.0 |
| Mailing (Resend) | native `fetch` → `api.resend.com` | — (see §12.1 on the unused `resend` SDK) |
| PDF | pdfkit | 0.20.2 |
| Database | MongoDB via Mongoose | 8.9.5 |
| Task Queue | BullMQ + ioredis | 6.3.9 / 6.0.0 |
| Queue Dashboard | Bull Board (`@bull-board/api`, `/express`) | 9.10.1 |
| Config | dotenv | 16.4.7 |
| Logging | Winston | 3.19.0 |
| Containers | Docker + Docker Compose | Compose v5.5.1 |
| Local Mock Mail | Mailpit | `latest` |
| Local Queue Inspection | RedisInsight | `latest` |

There is **no** build step, transpiler, test runner, or linter. Source is plain ESM run directly by
Node. Do not introduce a build step without explicit agreement — it changes the deployment
contract.

`npm audit` currently reports **3 findings** (1 moderate, 2 high) — see §12.9.

---

## 3. Running

### Native:
```bash
npm install
cp .env.example .env     # then fill in real credentials
npm run dev              # node --watch src/server.js
npm start                # node src/server.js
```

Default port `4000`. Verify with `curl http://localhost:4000/health` → `{"status":"ok", ...}`.

### Docker (App + MongoDB + Redis + Mailpit + RedisInsight):
```bash
npm run docker:up        # starts all 5 containers with live reload
npm run docker:logs      # stream application logs
npm run docker:down      # stop all containers
```
Mailpit Web UI: `http://localhost:8025`. RedisInsight Web UI: `http://localhost:5540`.
Bull Board dashboard: `http://localhost:4000/admin/queues`.

**The app container reads the host `.env`.** `docker-compose.yml` bind-mounts `./:/app`, so
`dotenv/config` loads the developer's `.env` inside the container and it takes precedence over the
compose `environment:` block for any key present in both. Compose defaults only fill the gaps.
This is why the container can come up on a real SMTP host instead of Mailpit.

**`data/` is writable and the app writes to it.** The template and PDF resolvers `rename` stray
root-level files into `data/` at runtime (§9c). Under the bind mount that lands in the working
tree and can dirty `git status`.

---

## 4. Architecture

```
data/
├── Samir_Shaikh_FullStack_Developer.pdf   Resume PDF auto-attached (git-tracked)
├── resume.tex                             LaTeX source — NOT read by any code (§12.6)
├── body.txt                               Cover-letter template (live reload)
└── subject.txt                            Subject line (live reload)

src/
├── app.js                 Express assembly: middleware + route mounting only
├── server.js              Bootstrap, DB/queue/worker lifecycle, graceful shutdown
├── db.js                  Mongoose connection lifecycle + readyState probe
├── health.js              Bounded dependency probes backing GET /health
├── logger.js              Winston loggers: app log + failed-send fallback file
├── config/
│   ├── env.js             Loads dotenv, validates env once, exports `config`
│   ├── mailer.js          Pooled Nodemailer SMTP transport (null when unconfigured)
│   ├── redis.js           Redis connection factory (TLS/Upstash/Render)
│   └── resend.js          Resend REST client: sendResendEmail() + verifyResend()
├── email/
│   ├── normalize.js       Payload validation + normalization → recipient entries
│   ├── pdf.js             PDF discovery ladder + pdfkit generator fallback
│   ├── send.js            Batching, provider dispatch, error classification
│   └── template.js        body.txt/subject.txt loading, linkify, HTML, placeholders
├── failures/
│   └── record.js          Records failed sends to MongoDB, falls back to file
├── middleware/
│   ├── cors.js            Permissive CORS: all origins, preflight short-circuit
│   ├── errorHandler.js    JSON 404 + centralized error responses
│   └── requestLogger.js   X-Request-Id + per-request timing/trace logs
├── models/
│   └── FailedEmail.js     Mongoose schema for failure records
├── queue/
│   ├── emailQueue.js      BullMQ Queue (module-level) + isQueueReady()
│   └── emailWorker.js     Background worker dispatching queued batches
└── routes/
    ├── dashboard.js       Bull Board UI mounted at config.bullBoard.basePath
    ├── health.js          GET /health (liveness + dependency probe)
    └── send.js            POST /send, GET /send/status/:jobId
```

| Module | Lines | Single responsibility |
|---|---|---|
| `email/pdf.js` | 258 | 5-step PDF discovery ladder, mtime-cached read, pdfkit generator fallback |
| `email/template.js` | 199 | Load `body.txt`/`subject.txt` live, linkify, HTML-ify, substitute placeholders |
| `health.js` | 154 | Bounded Mongo/SMTP/Resend/Redis probes, uptime, aggregate readiness |
| `logger.js` | 148 | Recursive redaction, Winston app logger, awaited failure-log writes |
| `email/send.js` | 139 | Bounded batching, provider dispatch, PDF attach, failure classification |
| `config/env.js` | 124 | Parse + validate `process.env` once; provider selection; prod safeguards |
| `config/resend.js` | 116 | `fetch`-based Resend client; `sendResendEmail`, `verifyResend` |
| `routes/send.js` | 101 | Route queued vs. sync dispatch; job status lookup |
| `failures/record.js` | 89 | Persist failures to MongoDB, fall back to awaited JSONL file |
| `queue/emailWorker.js` | 81 | Process queued batches, lifecycle event logs, BullMQ retry |
| `server.js` | 56 | Bootstrap log, signal handling, ordered teardown, logger flush |
| `email/normalize.js` | 56 | Validate `emails`; normalize to `{to, attachPdf, pdfTitle, …}` |
| `queue/emailQueue.js` | 55 | Queue construction, retry/backoff policy, bounded Redis probe |
| `middleware/errorHandler.js` | 49 | Map thrown errors to JSON HTTP responses |
| `db.js` | 43 | Connect / disconnect / report connection readiness |
| `middleware/requestLogger.js` | 40 | `X-Request-Id` in/out, `recipientCount`, `durationMs` on finish |
| `app.js` | 28 | Wire middleware, redirects, and routers |
| `routes/dashboard.js` | 27 | Mount Bull Board, or a JSON 503 when the queue is disabled |
| `routes/health.js` | 23 | GET /health — compose the readiness report into a status code |
| `config/redis.js` | 22 | Redis connection factory |
| `config/mailer.js` | 18 | Construct the pooled SMTP transport (`null` when unconfigured) |
| `models/FailedEmail.js` | 14 | Schema definition |
| `middleware/cors.js` | 13 | Permissive CORS, all origins, preflight short-circuit |

**Layering rule (top → bottom):** `server` → `app` → `routes` → `health`/`email`/`failures` →
`db`/`models`/`queue` → `config`. Dependencies point downward only. Routes orchestrate; they
contain no logic. Nothing below `routes` imports from `routes` or `app`. Verified: the import
graph contains no back-edges.

**Import-time side effects still exist below `app.js`.** `app.js` itself only wires middleware,
but importing it transitively runs `createBullBoard()` (`routes/dashboard.js`), constructs the
BullMQ `Queue` and its ioredis connection (`queue/emailQueue.js`), and constructs the SMTP
transporter (`config/mailer.js`). `config/env.js` can also **throw** (§6). So a test that imports
`app.js` will open a Redis connection and must set `REDIS_URL` to avoid one.

---

## 5. Request Lifecycle — `POST /send`

`sendRouter` picks one of two dispatch modes. With `emailQueue` present (i.e. `REDIS_URL` set) and
`?sync=true` absent, the batch is enqueued to BullMQ and the client gets `202` plus a `jobId`; the
worker then performs steps 4–5 out of band. Otherwise the work happens inline and the client gets
`200` with the per-recipient breakdown. Steps 1–3 and 6 are common to both.

0. `corsMiddleware` runs first, before the body parser. A preflight `OPTIONS` short-circuits with
   `204` — **before `requestLogger` is mounted**, so preflights carry CORS headers but no
   `X-Request-Id` and produce no log line.
1. `express.json()` parses the body. Malformed JSON short-circuits to the error middleware.
2. `requestLogger` assigns `req.id` (inbound `X-Request-Id` or a fresh `crypto.randomUUID()`),
   echoes it on the response, and logs on `res.finish` with `durationMs`.
3. `sendRouter` calls `normalizeRecipients(req.body?.emails)`. Any shape violation throws a
   `ValidationError` carrying `status = 400`.
4. `sendRecipients(recipients)` dispatches. The list is split into **sequential** batches; each
   batch runs concurrently via `Promise.all`. A rejected send is captured as a failure object,
   never propagated — one bad recipient cannot abort the batch.
5. `recordFailures(failures)` persists non-empty failure lists. No-ops if Mongo is unconfigured or
   disconnected. Persistence errors are logged, never surfaced to the client.
6. Response: `{ ok, total, sent, failed, failures[] }` with HTTP 200 (sync) or
   `{ ok, message, jobId, total, statusUrl }` with HTTP 202 (queued).
7. Any thrown error reaches `errorHandler` via `next(error)`.

**Concurrency invariant:** batch size is `config.smtp.maxConnections` on the SMTP path. There is no
benefit to in-flight messages exceeding the pool's open connections, and exceeding the pool would
queue. On the Resend path the batch size is a **hardcoded literal `5`** in `email/send.js` — it is
not configurable and does not read `SMTP_MAX_CONNECTIONS`. See §12.3.

**Ordering invariant:** `failures[]` is returned in **request order**, not completion order. The
implementation writes results back by index into a pre-sized `outcomes` array rather than
filtering a completion-ordered array.

**Both modes are non-atomic.** A job retried by BullMQ re-sends to *every* recipient in the
payload, including ones that already succeeded. `sendRecipients` never throws, so a retry only
follows a crash between the SMTP call and the job returning — but the blast radius is the whole
batch. See §12.4.

---

## 6. Configuration Reference

All environment access is confined to `src/config/env.js`, with one documented exception:
`email/pdf.js:96` reads `RESUME_PDF_PATH` directly (§12.2). Verify with a grep for `process\.env`.

| Variable | Required | Default | Parsing rule |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development`, `production`, or `test`. Requires `REDIS_URL` + `MONGODB_URI` when `production` |
| `EMAIL_PROVIDER` | no | auto | `smtp` or `resend`. Auto: `resend` if `RESEND_API_KEY` is set **and** `SMTP_HOST` is not, else `smtp` |
| `RESEND_API_KEY` | **yes if provider=resend** | `null` | Non-empty string |
| `RESEND_FROM` | no | `SMTP_FROM`, else `onboarding@resend.dev` | Literal `From` header for Resend |
| `SMTP_HOST` | **yes if provider=smtp** | `""` | Non-empty string; `""` when provider is `resend` |
| `SMTP_USER` | **yes if provider=smtp** | `""` | Non-empty string |
| `SMTP_PASS` | **yes if provider=smtp** | `""` | Non-empty string |
| `SMTP_FROM` | no | `"Email Sender" <SMTP_USER>` | Falls back to `onboarding@resend.dev` when `SMTP_USER` is unset |
| `SMTP_PORT` | no | `587` | Positive integer |
| `SMTP_SECURE` | no | `false` | Exactly the string `true` |
| `SMTP_MAX_CONNECTIONS` | no | `5` | Positive integer; batch size on the SMTP path only |
| `SMTP_MAX_MESSAGES` | no | `100` | Positive integer |
| `AUTO_ATTACH_PDF` | no | `true` | Boolean (`true`/`false`). Default for per-entry `attachPdf` |
| `MONGODB_URI` | **yes in prod** | `null` | Optional in dev (file sink when unset) |
| `MONGO_TIMEOUT_MS` | no | `5000` | Positive integer; bounds the startup connect attempt. **Missing from `.env.example`** (§12.5) |
| `REDIS_URL` | **yes in prod** | `null` | Optional in dev (unset ⇒ synchronous sends + no dashboard) |
| `QUEUE_CONCURRENCY` | no | `5` | Positive integer; BullMQ worker concurrency |
| `BULL_BOARD_PATH` | no | `/admin/queues` | Mount path for the Bull Board UI |
| `HEALTH_PROBE_TIMEOUT_MS` | no | `5000` | Positive integer; bounds each probe round trip. Does **not** bound sends (§12.3) |
| `SERVICE_NAME` | no | `email-sender` | Value of the `service` log field |
| `LOG_LEVEL` | no | `info` | One of `error/warn/info/http/verbose/debug/silly`; unknown values fall back to `info` |
| `LOG_DIR` | no | `logs` | Log directory, relative to the working directory |
| `LOG_FORMAT` | no | `json` | `json` (default) or `text`/`pretty` for the console transport |
| `MASK_EMAILS` | no | `false` | Boolean. When true, recipient addresses are masked in log output |
| `PORT` | no | `4000` | Positive integer |

### Provider selection

`EMAIL_PROVIDER` is the explicit switch; the fallback is a two-variable heuristic. Both paths were
verified by booting `config/env.js` against a scrubbed environment (`DOTENV_CONFIG_PATH` pointed at
an empty file):

| Environment | Result |
|---|---|
| `RESEND_API_KEY` only | `provider=resend`, `smtp.host=""` |
| `SMTP_*` only | `provider=smtp`, `from="Email Sender" <u>` |
| Nothing set | **throws** `Missing required environment variable: SMTP_HOST` |
| `EMAIL_PROVIDER=resend`, no `RESEND_API_KEY` | **throws** `Missing required environment variable: RESEND_API_KEY` |
| `NODE_ENV=production`, no `REDIS_URL` | **throws** `Missing required environment variable in production: REDIS_URL` |

### Parsing helpers

- `readNumber` returns the fallback unless the value is a **positive integer**. `""`, `abc`, `0`,
  `-1`, and `5.5` all fall back. A fractional pool size is rejected rather than silently truncated.
- `readBoolean` treats only the exact string `true` as true. `TRUE`, `1`, `yes` are all **false**.
  This is a common misconfiguration trap.
- `readRequired` throws at **import time**, so a missing credential aborts the process during
  module loading, before `listen`.
- **Conditional requirement:** `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` are required only when the
  resolved provider is `smtp`, and `RESEND_API_KEY` only when it is `resend`. The inactive
  provider's fields are coerced to `""`/`null` rather than validated, so a half-configured
  deployment does not fail-fast on the provider it is not using.
- **Production Safeguards:** in `NODE_ENV=production`, `config/env.js` asserts `REDIS_URL` then
  `MONGODB_URI`, throwing on the first missing one. In development both remain optional.

---

## 7. API Reference

### `GET /health`

One endpoint, two answers. It confirms the process is alive **and** reports whether every
configured dependency is reachable, so a caller never needs a second route.

```json
{
  "status": "ok",
  "uptimeSeconds": 687.068,
  "timestamp": "2026-09-27T17:04:20.762Z",
  "checks": {
    "mongo":  { "status": "ok", "required": true,  "latencyMs": 0 },
    "smtp":   { "status": "ok", "required": true,  "latencyMs": 2457, "cached": false },
    "resend": { "status": "disabled", "required": false, "latencyMs": 0 },
    "redis":  { "status": "ok", "required": true,  "latencyMs": 0 }
  }
}
```

`status` is `"ok"` with HTTP `200`, or `"unavailable"` with HTTP `503` when any **required**
check is `unavailable`. `status: "ok"` remains the success value, so a client that only asserts on
that field is unaffected by the added fields.

There are now **four** checks, not three. Exactly one of `smtp` / `resend` is ever `required: true`
— the one matching the active provider — and the other reports `disabled` without probing. Both
appear in every response so the shape is stable across providers.

**Required means configured, not present.** `mongo` is `required: false` when `MONGODB_URI` is
unset and `redis` is `required: false` when `REDIS_URL` is unset, because the service is designed
to run without them (§5, §9a). An unconfigured dependency reports `"disabled"` and never causes a
`503`. In production both are mandatory by config, so all configured checks gate.

Per-check `status` is `"ok"`, `"unavailable"`, or `"disabled"`. `latencyMs` is the probe round
trip; `cached: true` means that provider's 15s result cache was reused — see §7a.

Probe error text is **not** returned. A provider rejection can name the rejected account, and this
endpoint is unauthenticated with a wildcard CORS policy (§7 CORS), so the detail goes to
`logs/app.log` via `logger.warn` and the response carries only the status.

### 7a. Health Probe Behaviour

- **Bounded.** Every network probe races against `HEALTH_PROBE_TIMEOUT_MS`, so a hung SMTP server
  or dead Redis cannot hold the request open. Verified: with `HEALTH_PROBE_TIMEOUT_MS=2000` and
  both Mongo and Redis pointed at closed ports, the request completed in 2.01s → `503`. Timers are
  `unref()`d so a pending probe never delays shutdown.
- **SMTP is verified, not inferred.** `transporter.verify()` performs a real SMTP auth, so it
  catches a revoked password that a socket check would miss. Results are cached for 15s
  (`PROBE_TTL_MS` in `src/health.js`) because orchestrators poll every few seconds and repeated
  auth attempts resemble credential probing to providers. `cached: true` marks a reused result.
- **Resend is verified, with a least-privilege carve-out.** `verifyResend()` calls
  `GET https://api.resend.com/api-keys` under an `AbortController` bounded by the probe timeout. A
  key scoped to "Sending access" is rejected there with `restricted_api_key` / *"This API key is
  restricted to only send emails"*; that response is **treated as healthy**, because it proves the
  key is authentic and outbound HTTPS works. Any other non-2xx throws.
  **Consequence:** a `resend: ok` check confirms key authenticity and network reachability, *not*
  that the key still holds sending permission. It cannot predict whether `/send` will succeed.
- **Two independent caches.** `smtpProbeCache` and `resendProbeCache` are separate module-level
  variables with the same 15s TTL, so the inactive provider's cache is never warmed. Mongo and
  Redis read local connection state and are never cached.
- **Probes are parallel.** `Promise.all` over the four checks, so response time is the slowest
  probe, not their sum.
- **`503` depends on dependencies, not just the process.** An orchestrator using this as a
  readiness gate will pull the instance out of rotation when Mongo or the active provider is down —
  that is the intent, but it also means this endpoint should not double as a container *liveness*
  gate, or a healthy process gets restarted during a dependency outage.
- **Redis is probed through BullMQ** via `isQueueReady()` in `queue/emailQueue.js`, which bounds
  `emailQueue.waitUntilReady()`. It returns `false` rather than throwing; a probe must never be
  able to fail the health request.

### `POST /send`

Request body — `emails` must be a non-empty array whose items are either a string address or an
object with a `to` property:

```json
{
  "emails": [
    "user1@example.com",
    { "to": "user2@example.com", "subject": "Hi", "html": "<h1>Hi</h1>", "text": "Hi" }
  ]
}
```

**Object entries accept five more fields** beyond `subject`/`html`/`text`, all coerced with
`String(...)` and all optional:

| Field | Type | Effect |
|---|---|---|
| `attachPdf` | boolean | Per-recipient override of `AUTO_ATTACH_PDF`. `false` is honoured; a non-boolean falls back to the config default |
| `pdfTitle` | string | Overrides the generated-PDF banner heading |
| `pdfContent` | string | Replaces the generated-PDF body entirely (wins over `text` and `html`) |
| `attachments` | array | Passed straight through to the transport. Not validated |
| `to` | string | Required on object entries; `Boolean(entry.to)` gates addressability, so `""`/`0` fail |

With `subject`, `html` and `text` all omitted, the server fills them from `data/subject.txt` and
`data/body.txt` and attaches a PDF — see §9c.

Rejected with `400` if `emails` is absent, not an array, empty, or contains an item that is not a
string / addressable object (numbers, `null`, nested arrays, and objects lacking `to` all fail).

**Success (sync) — `200`, returned even when every send fails:**

```json
{
  "ok": true,
  "total": 2,
  "sent": 1,
  "failed": 1,
  "failures": [
    { "email": "bad@example.com", "subject": "Hello", "reason": "invalid_address", "error": "..." }
  ]
}
```

**Success (queued) — `202`:**

```json
{
  "ok": true,
  "message": "Email batch accepted and queued for background sending",
  "jobId": "1",
  "total": 2,
  "statusUrl": "/send/status/1"
}
```

All errors share the shape `{ "ok": false, "error": "<message>" }`.

### `GET /send/status/:jobId`

`503` when `emailQueue` is null; `404` when the job id is unknown. Otherwise `200` with
`{ ok, jobId, state, progress, result, failedReason, attemptsMade, timestamp }`. `state` is a raw
BullMQ state (`waiting`, `active`, `completed`, `failed`, `delayed`, …). `result` is the worker's
`{ total, sent, failed, failures }` payload once completed.

`progress` is **always** `0`/empty — the worker never calls `job.updateProgress()`. See §12.7.

### `GET /admin/queues` — Bull Board

`config.bullBoard.basePath` (default `/admin/queues`) serves the Bull Board React UI plus its
`/api/...` subpaths. `GET /admin` and `GET /dashboard` both `302` to it.

When `emailQueue` is null (no `REDIS_URL`), the same mount path returns
`503 {"ok":false,"error":"BullMQ dashboard is unavailable because Redis is not configured."}`
instead of the UI.

**This surface is unauthenticated** and, combined with the wildcard CORS policy, exposes job
payloads (full recipient lists), job retry, and queue purge to anyone who can reach the port.
`API.md` advertises optional Basic auth via `BULL_BOARD_USERNAME`/`BULL_BOARD_PASSWORD`; that is
**not implemented** and those variables are never read. See §12.8.

### CORS

`corsMiddleware` in `middleware/cors.js` is mounted in `app.js` **before** `express.json()` and
applies to every route, including 404s and errors.

| Header (request / response) | Value |
|---|---|
| `Access-Control-Allow-Origin` (res) | `*` |
| `Access-Control-Allow-Methods` (res) | `GET,POST,PUT,PATCH,DELETE,OPTIONS` |
| `Access-Control-Allow-Headers` (res) | `Content-Type,Authorization` |
| `Access-Control-Max-Age` (res) | `86400` (24 h) |

`OPTIONS` preflights return `204 No Content` with an empty body and **no `X-Request-Id`** — the
`cors` package answers before `requestLogger` is reached.

**No credentials.** The policy is a literal wildcard, and the Fetch spec forbids pairing `*` with
`Access-Control-Allow-Credentials`. If cookie or `Authorization`-header auth is ever added, the
wildcard must be replaced with an origin allowlist (the `cors` package takes an array of origins and
then permits credentials) — at that point move the list into `config/env.js` rather than hardcoding
it. The service is currently unauthenticated, so no browser client needs credentials.

Note that the allowed-methods list advertises `PUT`/`PATCH`/`DELETE` that no route implements. It
is a blanket list, not a per-route description of the API.

---

## 8. Failure Classification

`classifyError()` in `email/send.js` maps a transport error to one of four reasons, checked in
order:

| `reason` | Condition |
|---|---|
| `auth_failed` | `err.code === "EAUTH"` **or** `err.status === 401` |
| `dns_error` | `err.code === "ENOTFOUND"` |
| `invalid_address` | message contains `invalid address`, `invalid recipient`, `invalid_to`, or `invalid email` (all case-insensitive) |
| `smtp_error` | anything else — the catch-all |

The `err.status === 401` clause and the extra message patterns were added for Resend, whose REST
errors arrive as HTTP status codes and prose messages rather than Nodemailer error codes. The
Resend client sets `error.status = response.status` before throwing (`config/resend.js:63`), which
is what makes the first clause fire.

`sent + failed === total` always holds. Classification is intentionally shallow string/code
matching on the error surface, not a taxonomy of SMTP reply codes. Extending it means adding a
branch **above** the `smtp_error` fallback, otherwise new branches become unreachable.

**`smtp_error` is now a misnomer.** It is the catch-all for both providers, so a Resend 429 rate
limit and a Resend 422 validation error are both reported as `smtp_error`. The `reason` is
persisted verbatim to MongoDB and to the failure log, so renaming it later is a data migration.
See §12.10.

---

## 9. Data Model

`models/FailedEmail.js` → collection `failedemails`:

| Field | Type | Notes |
|---|---|---|
| `email` | String, required, **indexed** | Recipient address |
| `subject` | String | Subject used for the attempt |
| `reason` | String, required | One of the four reasons above |
| `error` | String | Raw transport error message |
| `attemptedAt` | Date | Defaults to `Date.now` in the schema |
| `createdAt` / `updatedAt` | Date | Mongoose `timestamps: true` |

`recordFailures` deliberately does **not** set `attemptedAt` — the schema default covers it. The
`email` index exists for the expected query pattern (retry/replay by address); add further indexes
here rather than at query sites.

---

## 9a. Failure Sink Resolution

MongoDB is **optional**. `recordFailures()` in `failures/record.js` picks the first sink that
works, and never throws — the HTTP response has already been composed by the time it runs.

| Condition | Sink |
|---|---|
| `MONGODB_URI` set, `readyState === 1`, `insertMany` resolves | MongoDB `failedemails` |
| `MONGODB_URI` not set | `logs/failed-emails.log` |
| `readyState !== 1` (never connected, or dropped) | `logs/failed-emails.log` |
| `insertMany` throws | `logs/failed-emails.log` |

**Invariants:**

- A record is written to **both** sinks only when the Mongo write itself fails. There is no
  unconditional write-behind.
- The fallback is a safety net, not a mirror. `source: "file-fallback"` marks those lines.
- `logs/failed-emails.log` is JSONL (one JSON object per line) and is the only durable record
  when Mongo is down. Replaying it into Mongo is a future task, not yet implemented.
- The fallback path warns **once** per process (module-level `hasWarnedAboutFallback`) to avoid
  log flooding.
- `recordFailures` is called from both `routes/send.js` (sync) and `queue/emailWorker.js` (async),
  so the fallback covers both dispatch modes.
- The file write is **awaited per record** through `writeFailureLog()`, so a 500-recipient total
  failure serializes 500 transport callbacks. That is the deliberate price of not losing a
  failure record; see §9b for why a single awaited call is the only mechanism that works.

**Ephemeral-filesystem caveat:** on Render/Heroku/container hosts, `logs/` is wiped on redeploy.
The file sink is diagnostic and short-term; real durability requires `MONGODB_URI`.

---

## 9b. Logging & Observability

`src/logger.js` exports two Winston loggers:

| Export | Destination | Format | Rotation |
|---|---|---|---|
| `logger` | console + `logs/app.log` | Single-line JSON (`LOG_FORMAT=json` default, `text`/`pretty` fallback) | 5 MB × 5 |
| `failureLogger` | `logs/failed-emails.log` | Single-line JSONL | 10 MB × 5 |

### Standard Log Fields
Every log entry emitted by `logger` contains:
`timestamp` (ISO-8601), `level`, `message`, `service` (`SERVICE_NAME` or `email-sender`),
`environment` (`NODE_ENV`), `pid`, and a `context` object holding `{ service, environment, pid }`.
Injected by `standardFieldsFormat()`, which runs before the redaction format.

### Sensitive Data Redaction
A recursive redaction format scrubs sensitive fields before any log write. It walks the `info`
object in place with a `WeakSet` cycle guard, so circular metadata cannot hang a log call.
- Redacts by key (case-insensitive): `password`, `pass`, `secret`, `token`, `apikey`, `api_key`,
  `authorization`, `auth`, `cookie`, `smtp_pass`, `resend_api_key` → `"[REDACTED]"`.
- Scrubs embedded credentials from MongoDB (`mongodb://…:***@`) and Redis (`redis://…:***@`).
- Masks `Bearer <token>` and `re_*` Resend keys inside any string value.
- When `MASK_EMAILS=true`, masks local-parts in addresses: `a***@example.com`.

### Request Tracing
`src/middleware/requestLogger.js` is mounted **after** `express.json()` — it must be, because it
reads `req.body.emails.length` to log `recipientCount`. It generates or propagates `X-Request-Id`
onto `req.id` and the response headers, then logs on `res.finish` with `statusCode`, `durationMs`,
and a level chosen by status (≥500 `error`, ≥400 `warn`, else `info`). Both `routes/send.js` and
`middleware/errorHandler.js` then attach `requestId` to their own records, so a single request's
lines are greppable by id.

### External Call Tracing
Provider and dependency calls log `latencyMs` plus a `status` of `completed` / `failed` /
`completed_with_errors`: MongoDB connect, per-recipient dispatch (`email/send.js`), batch
aggregate, BullMQ `add`, worker lifecycle events, queue readiness probe, and both health probes.

`console.*` is banned outside `logger.js`; verify with a grep for `console\.` under `src/`.

**Winston completion-signal gotcha (verified empirically on winston 3.19.0):**

- `logger.write(info, callback)` — the callback **does** fire. This is the only reliable way to
  await a File write. Used by `writeFailureLog()`.
- `logger.log(level, msg, meta, callback)` — the callback **never** fires; the record is still
  written.
- The `"logged"` event — does not fire for the File transport in this version.
- `logger.write(info)` returns a **boolean** (backpressure), *not* a stream. Calling `.once()` on
  it throws `stream.once is not a function`.
- `logger.write("string")` throws `TypeError: Cannot create property 'Symbol(level)' on string`.
  Always pass an object.

Because the response is returned before the write completes, the write is awaited inside
`recordFailures`, and `server.js` calls `closeLoggers()` during shutdown to flush buffers before
`process.exit(0)`.

---

## 9c. Email Content & Attachment Resolution

`email/template.js` owns content; `email/pdf.js` owns attachments. Both resolve against `data/`
first, then the project root, and **move** a root-level file into `data/` as a side effect of
finding it.

### Content precedence (`resolveEmailContent`)

1. **Subject:** `entry.subject` → `data/subject.txt` → a `Subject:` line at the top of
   `data/body.txt` → `"Full Stack Developer Application — Samir Shaikh"`.
2. **Body:** if the entry supplies *neither* `text` nor `html`, both are taken from
   `data/body.txt`; if there is no template, `text = "Hello"` and `html = "<p>Hello</p>"`. If only
   one of `text`/`html` is supplied, the other is derived: `text` → `textToHtml(text)`,
   `html` → tags stripped and whitespace collapsed.
3. **Placeholders:** `{to}`, `{{to}}`, `{email}`, `{{email}}` are replaced with the recipient
   address in subject, text, and html (global, case-insensitive).
4. `body.txt` is treated as a template only when its **first line** starts with `subject:`; that
   line is stripped from the body.

`textToHtml` escapes `&`, `<`, `>` per paragraph, linkifies `https?://…` into
`<a target="_blank" rel="noopener noreferrer">`, converts newlines to `<br/>`, and wraps each
paragraph in an inline-styled `<p>` inside a `max-width: 650px` div. **Escaping happens before
linkification**, so a URL's `&` becomes `&amp;` inside the `href` — correct HTML, and worth
preserving if the function is refactored.

Both files are cached against `mtimeMs` + path, so editing `data/body.txt` changes every
subsequent email with no restart.

### PDF discovery ladder (`findRepoPdf`)

Checked in order, first hit wins:

1. `data/Samir_Shaikh_FullStack_Developer.pdf` (the `DEFAULT_PDF_NAME`)
2. `data/Samir_Full_Stack_Developer_Resume.pdf` (legacy name, still honoured)
3. Either of those names in the project root — **moved** into `data/` (`renameSync`, falling back
   to `copyFileSync` + `unlinkSync`, then to returning the root path)
4. Any other `.pdf` in `data/`, then any other `.pdf` in the project root (moved into `data/`)
5. `process.env.RESUME_PDF_PATH`, if set and it exists — **effectively dead code** (§12.2)

`getAutoPdfAttachment` caches the file's `Buffer` against `mtimeMs`, so a 1 MB resume is read from
disk once, not once per recipient. If discovery or the read fails, it falls through to
`generateEmailPdf()`, which renders an A4 document with pdfkit: a blue header banner, a
recipient/subject/timestamp metadata card, a "Message Details" section, and a centered footer.
Its body is `pdfContent` → `text` → `stripHtml(html)` → a fixed confirmation sentence.
`stripHtml` removes `<style>`/`<script>` blocks wholesale before stripping remaining tags.

---

## 9d. Queue Dashboard

`routes/dashboard.js` is 27 lines and does one thing: wrap `emailQueue` in a `BullMQAdapter`, hand
it to `createBullBoard()` with an `ExpressAdapter`, and mount the resulting router at
`config.bullBoard.basePath`. The `if (emailQueue)` branch is decided **once at import time**, so
the mount cannot change without a restart.

Bull Board is the in-process dashboard for the same `emailQueue` that RedisInsight inspects at
the protocol level. The division of labour:

| Tool | Shows | Port |
|---|---|---|
| Bull Board | Jobs, payloads, retry/purge actions | `:4000/admin/queues` |
| RedisInsight | Raw `bull:emailQueue:*` keys, arbitrary Redis commands | `:5540` |

Bull Board ships as a dependency of the app process, so it is available in any environment where
the app runs — including production, where RedisInsight is not. That is deliberate, and it is
also the reason the missing auth in §12.8 matters.

`@bull-board/ui` is declared in `package.json` but never imported; the UI arrives transitively
through `@bull-board/api`. It is a harmless but removable entry.

---

## 10. Refactor History

### Phases 1–7 (previously recorded)

Phase 1 split the original 132-line `app.js` — which held app construction, the MongoDB
connection, both routes, validation, normalization, batching, dispatch, classification, and
persistence, with a live `mongoose.connect()` firing as an import side effect — into 16
single-purpose modules. Behavior changes, all deliberate and individually revertible:

1. **Fail-fast on missing SMTP config.** `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` became required.
2. **Deterministic failure ordering.** `failures[]` follows request order, not `Promise.all`
   completion order.
3. **Consistent JSON errors.** Unknown routes and malformed JSON returned Express's default HTML;
   both now return `{ ok: false, error }`.
4. **No persistence stall when Mongo is down.** `recordFailures` checks readiness and drops to a
   log line instead of hitting Mongoose's ~10s command-buffer timeout per request.
5. **Graceful shutdown.** `SIGINT`/`SIGTERM` close the HTTP server, SMTP pool, and Mongo.
6. **New optional `SMTP_FROM`,** defaulting to the prior hardcoded `"Email Sender" <SMTP_USER>`.
7. **Mongo stays optional,** now with an explicit startup warning.

> **Correction to the original claim.** Phase 1 asserted `app.js` was "pure assembly with no side
> effects on import." That was true in Phase 1 and is **no longer true**: `routes/dashboard.js` runs
> `createBullBoard()` at module scope and `queue/emailQueue.js` opens a Redis connection at module
> scope, both reached transitively from `app.js`. See §4.

Phase 2 moved all logging to Winston with zero `console.*` under `src/`, made the failure log a
real fallback rather than a discard, added `MONGO_TIMEOUT_MS`, and flushed loggers on shutdown.

Phase 3 added the BullMQ queue: `202` + `jobId` responses, `GET /send/status/:jobId`, a `?sync=true`
inline path, worker concurrency via `QUEUE_CONCURRENCY`, and TLS support for `rediss://`.

Phase 4 added the local Docker ecosystem (`app`, `mongodb`, `redis`, `mailpit`), the
`docker:*` npm scripts, `NODE_ENV` handling, and the production fail-fast safeguards.

Phase 5 added permissive CORS mounted ahead of the body parser, with no credentials.

Phase 6 added `src/health.js` and the bounded dependency probe behind the single `GET /health`
route, which can now return `503` where it previously always returned `200`.

Phase 7 added the `redisinsight` compose service with its connection preconfigured through
`RI_REDIS_*` env vars, and no application code touched.

### Phase 8 — Resend as an alternative transport

Added because SMTP ports 25/465/587 are blocked on hosts like the Render free tier, so the service
was undeployable there despite working locally.

- **`EMAIL_PROVIDER`** selects `smtp` or `resend` at startup, with auto-detection when unset:
  `resend` iff `RESEND_API_KEY` is present and `SMTP_HOST` is absent.
- **`src/config/resend.js`** (116 lines) is a hand-rolled REST client over Node's built-in
  `fetch` — `POST /emails` to send, `GET /api-keys` to probe. No SDK. Buffer attachments are
  base64-encoded inline, per the API's JSON contract.
- **Conditional requirement.** Each provider's credentials are required only when that provider is
  active; the inactive provider's fields are coerced to `""`/`null`. This is the single most
  important consequence of the abstraction, and it is why the Phase 1 "fail-fast on missing SMTP
  config" invariant now reads "fail-fast on missing config **for the selected provider**."
- **A fourth health check.** `checkResend()` mirrors `checkSmtp()` with its own 15s cache. Exactly
  one of the two is ever `required`; the other reports `disabled` without probing, so the
  response shape is identical across providers.
- **`classifyError` extended** with `err.status === 401` and three extra message patterns, since
  Resend surfaces HTTP status codes and prose where Nodemailer surfaces `err.code`.
- **Least-privilege probe carve-out.** A "Sending access" key cannot read `/api-keys`; that
  rejection is interpreted as success. Without this, the recommended key shape would have made
  `GET /health` return `503` forever. See §7a for the limitation this introduces.
- **Batch size diverged.** The Resend path batches 5 at a time via a hardcoded literal rather than
  `SMTP_MAX_CONNECTIONS`, because there is no connection pool to size. See §12.3.

### Phase 9 — Bull Board dashboard

- **`src/routes/dashboard.js`** mounts the Bull Board UI at `BULL_BOARD_PATH`, with a JSON `503`
  at the same path when `emailQueue` is null, so the mount is never a bare 404.
- **`/admin` and `/dashboard` redirect** to the base path, since those are the URLs people try
  first.
- **Zero changes to the queue or worker** — Bull Board is an out-of-process-style observer that
  talks to the same Redis keys.
- **Authentication was specified and not built.** `API.md` documents optional Basic auth via
  `BULL_BOARD_USERNAME`/`BULL_BOARD_PASSWORD`; nothing reads them. See §12.8.

### Phase 10 — Request tracing and external-call latency

- **`src/middleware/requestLogger.js`** generates or propagates `X-Request-Id`, echoes it on the
  response, and logs method, path, `recipientCount`, `statusCode`, and `durationMs` on
  `res.finish`. Mounted after `express.json()` so it can count recipients.
- **Both the success path and the error path now carry `requestId`** — `routes/send.js` and
  `middleware/errorHandler.js` were updated together, so a failure is greppable back to its
  request line.
- **`latencyMs` + `status` were threaded through every external call** (Mongo connect, per-recipient
  dispatch, batch aggregate, queue add, worker lifecycle, queue readiness, both health probes) so
  slow dependencies are visible in the log stream rather than only in wall-clock latency.
- **The `resend` path's error logs** carry `status: "failed"` plus the Resend error `code` and
  stack, matching the SMTP path's shape.

### Phase 11 — Generated PDF and template resolution

- **`email/pdf.js` grew from 105 to 258 lines**, becoming a 5-step discovery ladder plus a full
  pdfkit generator. The generator is the fallback, so the service still attaches a professional-
  looking document when no resume PDF is committed.
- **`email/template.js` grew from 120 to 199 lines**, gaining `subject.txt` support, the
  `Subject:`-header-in-`body.txt` convention, `{to}`/`{email}` placeholder substitution, and
  html↔text derivation when only one is supplied.
- **`normalize.js` gained five optional per-entry fields** (`attachPdf`, `pdfTitle`, `pdfContent`,
  `attachments`) so a single batch can mix "attach the resume" and "attach nothing" recipients.
  `attachPdf` is a real per-recipient override of `AUTO_ATTACH_PDF`, not just a boolean.
- **The default PDF name was normalized** to `Samir_Shaikh_FullStack_Developer.pdf`, matching the
  committed file. The older `Samir_Full_Stack_Developer_Resume.pdf` is still accepted as a
  fallback candidate.
- **`data/resume.tex`** was added as the LaTeX source of truth, but no compilation step exists and
  nothing reads it. See §12.6.

---

## 11. Extending This Codebase

- **New env var** → add to `config/env.js` with an explicit default, then to `.env.example` *and*
  the table in §6. Never read `process.env` outside `config/env.js` (`email/pdf.js` is the
  existing exception; do not add more).
- **New endpoint** → add a router in `routes/`, mount it in `app.js`, and delegate. Keep business
  logic out of the router.
- **New failure reason** → add a branch above the `smtp_error` fallback in `classifyError()`. If it
  applies to only one provider, keep the branch provider-agnostic where possible so both transports
  benefit; `smtp_error` is already the shared catch-all.
- **New provider** → add a `config/<provider>.js` exposing a send and a verify function, add a
  check in `health.js` mirroring `checkSmtp`/`checkResend`, add the branch in
  `email/send.js:sendOne`, and extend the `provider` resolution in `env.js`. The two existing
  providers' touchpoints (4 files) are the template to copy.
- **New persistent field** → extend the schema in `models/FailedEmail.js` and map it in the
  projection inside `failures/record.js` (`toDocuments`), *and* in `toLogEntries` — the file sink
  is a separate projection and will silently drop anything added to only one of them.
- **Templating / attachments** → extend the normalized entry shape in `email/normalize.js`, then
  `sendOne()` in `email/send.js`. Both are intentionally small extension points.
- **New log destination** → add a transport in `logger.js`. If the failure sink gains a new
  fallback, update the table in §9a and the README together.
- **Tightening CORS** → edit the single options object in `middleware/cors.js`. If it becomes
  environment-dependent, the origin list belongs in `config/env.js`.
- **Protecting the dashboard** → add auth inside `routes/dashboard.js` *before* the `ExpressAdapter`
  mount, and read any new credentials from `config/env.js`. Do not read `process.env` in the route.

---

## 12. Known Gaps

Ordered by how much they matter in production.

### 12.1 `resend` SDK is a dead dependency
`package.json` declares `resend@^4.1.2` (4.8.0 installed), but `config/resend.js` uses native
`fetch` and never imports it. The declared dependency is misleading and pulls an unused transitive
tree into the image. Either drop it or switch the client to the SDK — do not leave both.

### 12.2 `RESUME_PDF_PATH` breaks the config boundary and is unreachable
`email/pdf.js:96` reads `process.env.RESUME_PDF_PATH` directly, the only `process.env` access
outside `config/env.js`. It is also placed at **step 5** of the discovery ladder, *after* steps 1–4
have already scanned both `data/` and the project root for any `.pdf`. It can therefore only be
reached when every scan came up empty — at which point an explicit path is exactly what an operator
would want. It is also absent from `.env.example`. Move it into `config` and promote it to step 0.

### 12.3 The Resend send path is unbounded
`sendResendEmail()` has no `AbortController` and no timeout. `verifyResend()` in the same file
does. A hung Resend endpoint therefore holds a BullMQ worker concurrency slot indefinitely, and in
`?sync=true` mode it holds the HTTP request open — while `HEALTH_PROBE_TIMEOUT_MS` gives false
confidence by bounding only the *probe*. Add a send timeout. Related: the Resend batch size is a
hardcoded `5` rather than a config value, and nothing honors Resend's actual per-domain quota
(100/day on the free tier), so a large batch fails wholesale at the provider with a `smtp_error`.

### 12.4 Batch retries are not idempotent
BullMQ retries a job up to 3 times with exponential backoff, re-sending to **every** recipient in
the payload. `sendRecipients` never throws by design, so a retry only follows a crash between a
successful SMTP call and the job returning — but the consequence is duplicate mail to recipients
who already received it. There is no per-recipient job granularity and no idempotency key.

### 12.5 `MONGO_TIMEOUT_MS` is undocumented
It is read by `config/env.js` and is the one variable that keeps an unreachable MongoDB from
stalling startup for Mongoose's default 30s, yet it is the only env var in `env.js` missing from
`.env.example`. Add it.

### 12.6 `data/resume.tex` is not compiled
The LaTeX source of truth for the resume is committed but unused. `findRepoPdf` only discovers
`.pdf` files. Anyone editing the `.tex` expects the attachment to change; it will not. Either add
a build step (which §2 forbids without agreement) or document that the `.tex` is a source-of-record
only.

### 12.7 Job progress is never reported
The worker never calls `job.updateProgress()`, so `GET /send/status/:jobId` always returns
`progress: 0`. A client polling a 500-recipient job has no way to tell progress from a stall.

### 12.8 The dashboard is unauthenticated, contrary to the docs
`API.md` advertises "Optional **HTTP Basic Authentication** via `BULL_BOARD_USERNAME` &
`BULL_BOARD_PASSWORD`." It does not exist — `config/env.js` never reads those variables and
`routes/dashboard.js` mounts the adapter with no auth. Both keys are present-but-empty in the
repo's `.env`, so the intent is documented but unbuilt. Combined with wildcard CORS (§7) and the
Bull Board's job-retry and queue-purge actions, anyone who can reach port 4000 can read full
recipient lists from job payloads, re-run jobs, and destroy the queue. This is the highest-priority
item on this list. Note it is also **not** dev-only: Bull Board runs in production too, since it
ships inside the app process.

### 12.9 Dependency advisories
`npm audit` currently reports three findings, all pre-existing and none introduced by the work
above:

| Package | Severity | Notes |
|---|---|---|
| `nodemailer@6.10.0` | high (12 advisories) | SMTP command injection / CRLF header injection family, `addressparser` DoS, IDN allow-list bypass, TLS validation in OAuth2. Fix is `nodemailer@10`, a breaking major. Partly mitigated in practice because `EMAIL_PROVIDER=resend` does not use Nodemailer at all |
| `mongoose@8.9.5` | high (2) | `sanitizeFilter` `$nor` NoSQL injection; `__proto__`-prefixed dotted-path prototype pollution |
| `express@4.21.2` | moderate | via `body-parser`, `qs`, `path-to-regexp` |

### 12.10 `smtp_error` is a provider-agnostic misnomer
Resend rate limits (429) and validation errors (422) are both reported as `smtp_error`. The value
is persisted to MongoDB and to the failure log, so it has already become part of the data format.

### 12.11 The 100 KB request limit is now much easier to hit
`express.json()` still runs with its default 100 KB cap. `normalize.js` now accepts an arbitrary
`attachments` array per entry, and `config/resend.js` base64-encodes Buffer content, inflating it
by ~33%. A modest batch with inline attachments will now `413`.

### 12.12 Also still open
- **No tests.** `node:test` is built in and needs no dependency. Natural first targets are
  `email/normalize.js` and `classifyError()` (both pure). Route-level tests are now harder than
  they were: importing `app.js` opens Redis and constructs the Bull Board (§4).
- **No linter/formatter.** Prettier-compatible by convention (double quotes, semicolons, 2-space
  indent) but unenforced.
- **No CI.**
- **No retries on synchronous sends.** `?sync=true` (or no `REDIS_URL`) fails permanently on the
  first `smtp_error`.
- **No deduplication** of repeated addresses within one request.
- **No replay of `logs/failed-emails.log` into MongoDB.** When Mongo is down, records live only in
  the file; nothing reads it back. This is the main outstanding gap in the fallback.
- **No distinction between liveness and readiness.** A single `GET /health` answers both, so there
  is no dependency-free endpoint for a container *liveness* gate during an outage. Deliberate;
  see §7a.
- **`errorHandler` echoes `error.message` for any status < 500,** including provider error text
  that can name the configured `From` address.
- **`GET /send/status/:jobId` does not validate `job.name`.** Harmless today (only one job name is
  enqueued) but it would matter the moment a second job type is added.

---

## 13. Verification Status

### Syntax and structure
All 23 modules pass `node --check`. The import graph was extracted and contains no back-edges
against the §4 layering rule. `grep 'console\.'` under `src/` returns nothing.

### Live verification against the running compose stack
Performed against `email_sender_app` (Mongo + Redis + Mailpit up, `EMAIL_PROVIDER=smtp`):

| Probe | Result |
|---|---|
| `GET /health` | `200`, `status: "ok"`, all **four** checks present, `mongo`/`smtp`/`redis` `ok` (SMTP `latencyMs` 2457, live auth), `resend` `disabled` |
| `GET /health` again | `X-Request-Id` present; inbound `X-Request-Id: probe-e2e-1` echoed back verbatim |
| `OPTIONS /send` | `204`, all four CORS headers, `Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS`, and **no** `X-Request-Id` — confirms the preflight short-circuit ordering |
| `GET /unknown` | `404` `{"ok":false,"error":"Cannot GET /unknown"}` |
| `POST /send` `{}` | `400` "Body must be an object with an 'emails' array." |
| `POST /send` `{"emails":[]}` | `400` "'emails' array must not be empty." |
| `POST /send` `{"emails":[123]}` | `400` "Invalid email entry in 'emails' array…" |
| `POST /send` malformed JSON | `400` `{"ok":false,"error":"Malformed JSON body."}` |
| `GET /send/status/999` | `404` `{"ok":false,"error":"Job with ID '999' not found."}` — reached Redis, so the queue is live |
| `GET /admin/queues` | `200`, 2254 bytes of Bull Board UI |
| `GET /admin` | `302` → `http://localhost:4000/admin/queues` |
| `GET /admin/queues/api/queues` | `200`, one queue `emailQueue`, 8 status buckets, `completed: 3` |

**No send was executed.** Every request above short-circuits before dispatch, so no mail was
delivered and no failure records were created. The `auth_failed` / `invalid_address` classification
paths and the Mongo-vs-file sink selection have therefore **not** been re-verified since the
provider and PDF work; they rest on the earlier manual pass recorded below.

### Provider resolution, verified in isolation
Booted `config/env.js` directly with `DOTENV_CONFIG_PATH` pointed at an empty file, so the repo's
real `.env` could not mask a case. All five rows of the §6 table were reproduced, including both
throw cases.

### Carried forward from the earlier manual pass
These predate the provider/PDF/dashboard work and were not re-run:

- Health probe matrix: Mongo + Redis up → `200`; both at closed ports with
  `HEALTH_PROBE_TIMEOUT_MS=2000` → `503` in 2.01s; neither configured → `200` with both
  `disabled`; `GET /health/ready` → `404`.
- Failure sink resolution: `MONGODB_URI` reachable → record in `failedemails`; unset → JSONL file
  with `source: "file-fallback"`; dead port → connect fails in ~5s, file fallback used.
- Eight malformed-input cases → `400` with original messages (four re-confirmed above).

### Two bugs found and fixed during that earlier pass
1. `writeFailureLog` called `.once()` on the return of `logger.write()`, which is a **boolean**,
   not a stream. Every fallback write threw `stream.once is not a function` and was swallowed by
   the surrounding `try/catch`, producing a 0-byte failure log that still reported success. See §9b.
2. An unreachable MongoDB blocked startup for Mongoose's default 30s `serverSelectionTimeoutMS`,
   so the server never called `listen()`. Fixed with `MONGO_TIMEOUT_MS`.

There is no automated suite, so all of the above is manual and one-off. The most valuable next
step is `node:test` coverage for `normalize.js` and `classifyError()` (pure, no I/O) followed by a
non-network send against Mailpit, which would make the classification and sink-selection paths
re-verifiable without a real provider.
