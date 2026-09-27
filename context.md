# context.md — nodemailer-email-sender

Engineering context for the **Minimal Email Sending Backend**: a Node.js/Express service that
sends bulk or individual emails over SMTP via Nodemailer and persists delivery failures to MongoDB.

> **Status:** refactored. `src/app.js` was a single 132-line file mixing six concerns; it is now a
> 14-line assembler over 16 single-purpose modules. See [Refactor History](#10-refactor-history).

---

## 1. Purpose

Accept a batch of recipients over HTTP, deliver a message to each through a **pooled** SMTP
connection, and guarantee that **every** failure is both returned in the response and durably
recorded in MongoDB. A partial batch failure is a normal, expected outcome — not an error — so the
endpoint reports per-recipient results and returns HTTP 200 even when every send fails.

Non-goals: templating, scheduling, retries, bounce/webhook processing, delivery receipt tracking,
rate limiting per recipient domain.

---

## 2. Tech Stack

| Layer | Choice | Installed |
|---|---|---|
| Runtime | Node.js (ESM, `"type": "module"`) | v24.16.0 |
| Package manager | npm | 11.13.0 |
| HTTP | Express | 4.22.3 |
| Mailing | Nodemailer (pooled SMTP) | 6.10.1 |
| Database | MongoDB via Mongoose | 8.24.4 |
| Task Queue | BullMQ + ioredis | 6.3.9 / 6.0.0 |
| Config | dotenv | 16.6.1 |
| Logging | Winston | 3.19.0 |
| Containers | Docker + Docker Compose | Compose v5.5.1 |
| Local Mock Mail | Mailpit | latest |

There is **no** build step, transpiler, test runner, or linter. Source is plain ESM run directly by
Node. Do not introduce a build step without explicit agreement — it changes the deployment contract.

---

## 3. Running

### Native:
```bash
npm install
cp .env.example .env     # then fill in real credentials
npm run dev              # node --watch src/server.js
npm start                # node src/server.js
```

Default port `4000`. Verify with `curl http://localhost:4000/health` → `{"status":"ok"}`.

### Docker (App + MongoDB + Redis + Mailpit):
```bash
npm run docker:up        # starts all 4 containers with live reload
npm run docker:logs      # stream application logs
npm run docker:down      # stop all containers
```
Mailpit Web UI: `http://localhost:8025` captures all outgoing mail safely for inspection.

---

## 4. Architecture

```
data/
├── Samir_Shaikh_FullStack_Developer.pdf   Resume PDF automatically attached to emails
├── body.txt                              Default email cover letter template (live reload)
└── subject.txt                           Default email subject line (live reload)

src/
├── app.js                 Express assembly: middleware + route mounting only
├── server.js              Process startup, DB/queue/worker lifecycle, graceful shutdown
├── db.js                  Mongoose connection lifecycle + readyState probe
├── logger.js              Winston loggers: app log + failed-send fallback file
├── config/
│   ├── env.js             Loads dotenv, validates env once, exports `config`
│   ├── mailer.js          Pooled Nodemailer SMTP transport
│   └── redis.js           Redis connection factory (TLS/Upstash/Render)
├── email/
│   ├── normalize.js       Request payload validation + normalization
│   ├── pdf.js             Dynamic PDF attachment generation (pdfkit)
│   ├── send.js            Batching, dispatch, SMTP error classification
│   └── template.js        Loads body.txt, URL linkification, HTML formatting
├── failures/
│   └── record.js          Records failed sends to MongoDB, falls back to file
├── middleware/
│   └── errorHandler.js    JSON 404 + centralized error responses
├── models/
│   └── FailedEmail.js     Mongoose schema for failure records
├── queue/
│   ├── emailQueue.js      BullMQ Queue with retries and exponential backoff
│   └── emailWorker.js     Background worker dispatching queued batches
└── routes/
    ├── health.js          GET  /health
    └── send.js            POST /send, GET /send/status/:jobId
```

| Module | Lines | Single responsibility |
|---|---|---|
| `email/send.js` | 75 | Dispatch in bounded batches, attach PDFs, classify failures |
| `email/template.js` | 120 | Loads subject.txt and body.txt with live reload, linkifies URLs, formats HTML |
| `email/pdf.js` | 105 | Auto-detects repo PDF (Samir_Full_Stack_Developer_Resume.pdf) with caching & generator fallback |
| `failures/record.js` | 67 | Persist failures to MongoDB, fall back to file |
| `config/env.js` | 90 | Parse + validate `process.env` exactly once |
| `logger.js` | 65 | Winston app logger + durable failure-log writes |
| `email/normalize.js` | 55 | Turn arbitrary input into a validated recipient list with PDF options |
| `server.js` | 38 | Bootstrap, signal handling, logger flush on exit |
| `db.js` | 35 | Connect / disconnect / report connection readiness |
| `queue/emailWorker.js` | 55 | Process queued batches, retry via BullMQ |
| `routes/send.js` | 80 | Route queued vs. sync dispatch; job status lookup |
| `queue/emailQueue.js` | 30 | Queue construction and retry/backoff policy |
| `config/redis.js` | 22 | Redis connection factory |
| `middleware/errorHandler.js` | 28 | Map thrown errors to JSON HTTP responses |
| `config/mailer.js` | 15 | Construct the pooled SMTP transport |
| `app.js` | 14 | Wire middleware and routers |
| `models/FailedEmail.js` | 14 | Schema definition |
| `routes/health.js` | 7 | Liveness probe |

**Layering rule (top → bottom):** `server` → `app` → `routes` → `email`/`failures` → `db`/`models`
→ `config`. Dependencies point downward only. Routes orchestrate; they contain no logic. Nothing
below `routes` imports from `routes` or `app`.

---

## 5. Request Lifecycle — `POST /send`

`sendRouter` picks one of two dispatch modes. With `REDIS_URL` set and `?sync=true` absent, the
batch is enqueued to BullMQ and the client gets `202` plus a `jobId`; the worker then performs
steps 3–4 out of band. Otherwise the work happens inline and the client gets `200` with the
per-recipient breakdown. Steps 1, 2 and 5 are common to both.

1. `express.json()` parses the body. Malformed JSON short-circuits to the error middleware.
2. `sendRouter` calls `normalizeRecipients(req.body?.emails)`. Any shape violation throws a
   `ValidationError` carrying `status = 400`.
3. `sendRecipients(recipients)` dispatches. The list is split into sequential batches of
   `config.smtp.maxConnections`; each batch runs concurrently via `Promise.all`. A rejected send
   is captured as a failure object, never propagated — one bad recipient cannot abort the batch.
4. `recordFailures(failures)` persists non-empty failure lists. No-ops if Mongo is unconfigured or
   disconnected. Persistence errors are logged, never surfaced to the client.
5. Response: `{ ok, total, sent, failed, failures[] }` with HTTP 200.
6. Any thrown error reaches `errorHandler` via `next(error)`.

**Concurrency invariant:** request-level concurrency is deliberately tied to
`SMTP_MAX_CONNECTIONS`. There is no benefit to in-flight messages exceeding the pool's open SMTP
connections, and exceeding the pool would queue. If you add a separate `SEND_BATCH_SIZE` variable,
keep it ≤ `maxConnections`.

**Ordering invariant:** `failures[]` is returned in **request order**, not completion order. The
implementation writes results back by index rather than filtering a completion-ordered array.

---

## 6. Configuration Reference

All environment access is confined to `src/config/env.js`. No other file reads `process.env`
(enforced by convention; verify with a grep for `process\.env` outside `env.js`).

| Variable | Required | Default | Parsing rule |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development`, `production`, or `test`. Enforces presence of `REDIS_URL` and `MONGODB_URI` when set to `production` |
| `SMTP_HOST` | **yes** | — | Non-empty string |
| `SMTP_USER` | **yes** | — | Non-empty string |
| `SMTP_PASS` | **yes** | — | Non-empty string |
| `SMTP_FROM` | no | `"Email Sender" <SMTP_USER>` | Literal `From` header |
| `SMTP_PORT` | no | `587` | Positive integer |
| `SMTP_SECURE` | no | `false` | Exactly the string `true` |
| `SMTP_MAX_CONNECTIONS` | no | `5` | Positive integer |
| `SMTP_MAX_MESSAGES` | no | `100` | Positive integer |
| `AUTO_ATTACH_PDF` | no | `true` | Boolean (`true`/`false`). Automatically generates & attaches a styled PDF to each email |
| `MONGODB_URI` | **yes in prod** | `null` | Required in `production`; optional in `development` (falls back to file sink when unset) |
| `MONGO_TIMEOUT_MS` | no | `5000` | Positive integer; bounds the startup connect attempt |
| `REDIS_URL` | **yes in prod** | `null` | Required in `production`; optional in `development` (unset ⇒ synchronous sends) |
| `QUEUE_CONCURRENCY` | no | `5` | Positive integer; BullMQ worker concurrency |
| `LOG_LEVEL` | no | `info` | One of `error/warn/info/http/verbose/debug/silly` |
| `LOG_DIR` | no | `logs` | Log directory, relative to the working directory |
| `PORT` | no | `4000` | Positive integer |

`LOG_LEVEL` is validated against a known set and silently falls back to `info` if unrecognized.

Parsing helpers and environment safeguards in `config/env.js`:

- `readNumber` returns the fallback unless the value is a **positive integer**. `""`, `abc`, `0`,
  `-1`, and `5.5` all fall back. A fractional pool size is rejected rather than silently truncated.
- `readBoolean` treats only the exact string `true` as true. `TRUE`, `1`, `yes` are all **false**.
  This is a common misconfiguration trap.
- `readRequired` throws at **import time**, so a missing credential aborts the process during
  module loading, before `listen`.
- **Production Safeguards:** When `NODE_ENV === "production"`, `config/env.js` asserts the existence of
  both `REDIS_URL` and `MONGODB_URI` at startup, immediately throwing if either is missing to prevent
  unintended unqueued bulk sending or unpersisted delivery audits in production. In development, both
  remain optional.

---

## 7. API Reference

### `GET /health`

```json
{ "status": "ok" }
```

Always `200` while the process is up. It does **not** probe MongoDB or SMTP — it is a liveness
probe, not a readiness probe. Add a separate readiness route if orchestrator gating on dependencies
is ever needed.

### `POST /send`

Request body — `emails` must be a non-empty array whose items are either a string address or an
object with a `to` property:

```json
{ "emails": ["user1@example.com", { "to": "user2@example.com", "subject": "Hi", "html": "<h1>Hi</h1>", "text": "Hi" }] }
```

`subject` defaults to `"Hello"`, `html` to `"<p>Hello</p>"`. `text` is passed through only if
supplied. Strings are trimmed. Rejected with `400` if `emails` is absent, not an array, empty, or
contains an item that is not a string / addressable object (numbers, `null`, nested arrays, and
objects lacking `to` all fail).

Success — `200`, returned even when every send fails:

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

All errors share the shape `{ "ok": false, "error": "<message>" }`.

---

## 8. Failure Classification

`classifyError()` in `email/send.js` maps a transport error to one of four reasons, checked in
order:

| `reason` | Condition |
|---|---|
| `auth_failed` | `err.code === "EAUTH"` |
| `dns_error` | `err.code === "ENOTFOUND"` |
| `invalid_address` | message contains `invalid address` (case-insensitive) |
| `smtp_error` | anything else — the catch-all |

`sent + failed === total` always holds. Classification is intentionally shallow string/code
matching on the error surface, not a taxonomy of SMTP reply codes. Extending it means adding a
branch **above** the `smtp_error` fallback, otherwise new branches become unreachable.

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
- The fallback path warns **once** per process (module-level flag) to avoid log flooding.
- `recordFailures` is called from both `routes/send.js` (sync) and `queue/emailWorker.js`
  (async), so the fallback covers both dispatch modes.

**Ephemeral-filesystem caveat:** on Render/Heroku/container hosts, `logs/` is wiped on redeploy.
The file sink is diagnostic and short-term; real durability requires `MONGODB_URI`.

---

## 9b. Logging

`src/logger.js` exports two Winston loggers:

| Export | Destination | Format | Rotation |
|---|---|---|---|
| `logger` | console + `logs/app.log` | console: human-readable, file: JSON | 5 MB × 5 |
| `failureLogger` | `logs/failed-emails.log` | JSONL | 10 MB × 5 |

`console.*` is banned outside `logger.js`; verify with a grep for `console\.` under `src/`.

**Winston completion-signal gotcha (verified empirically on winston 3.19.0):**

- `logger.write(info, callback)` — the callback **does** fire. This is the only reliable way to
  await a File write. Used by `writeFailureLog()`.
- `logger.log(level, msg, meta, callback)` — the callback **never** fires; the record is still written.
- The `"logged"` event — does not fire for the File transport in this version.
- `logger.write(info)` returns a **boolean** (backpressure), *not* a stream. Calling
  `.once()` on it throws `stream.once is not a function`.
- `logger.write("string")` throws `TypeError: Cannot create property 'Symbol(level)' on string`.
  Always pass an object.

Because the response is returned before the write completes, the write is awaited inside
`recordFailures`, and `server.js` calls `closeLoggers()` during shutdown to flush buffers before
`process.exit(0)`.

---

## 10. Refactor History

**Before:** `app.js` contained app construction, the MongoDB connection, both routes, payload
validation, normalization, batching, dispatch, error classification, and persistence — 132 lines,
with a live `mongoose.connect()` firing as an import side effect.

**After:** 16 modules, each independently testable. `app.js` is pure assembly with no side
effects on import, so the app can be constructed in a test without binding a port or opening a
database connection.

**Behavior changes** (all deliberate, all individually revertible):

1. **Fail-fast on missing SMTP config.** `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` are now required.
   The process exits at startup with a named-variable message. Previously the server booted and
   every email failed individually with `auth_failed`. *Largest deviation from prior behavior.*
2. **Deterministic failure ordering.** `failures[]` follows request order; it previously followed
   `Promise.all` completion order and varied between identical requests.
3. **Consistent JSON errors.** Unknown routes and malformed JSON previously returned Express's
   default HTML. Both now return `{ ok: false, error }`.
4. **No persistence stall when Mongo is down.** `recordFailures` checks connection readiness and
   drops records with a log line, instead of hitting Mongoose's ~10s command-buffer timeout on
   every request.
5. **Graceful shutdown.** `SIGINT` / `SIGTERM` close the HTTP server, the SMTP pool, and the
   Mongo connection before exit.
6. **New optional `SMTP_FROM`,** defaulting to the prior hardcoded `"Email Sender" <SMTP_USER>`.
7. **Mongo stays optional.** No `MONGODB_URI` still means a working send API, now with an explicit
   startup warning instead of a silent 10s stall per failure.

Public HTTP contract (paths, status codes, response bodies) is unchanged.

### Phase 2 — Winston logging + file fallback

Added at the request "make the MongoDB failure log optional, fall back to logging in the repo":

- **All logging moved to Winston** (`src/logger.js`). Zero `console.*` calls remain under `src/`.
- **Failure records are never dropped.** Previously, when Mongo was unconfigured or disconnected,
  `recordFailures` logged a line and *discarded* the records. They now persist to
  `logs/failed-emails.log` as JSONL, tagged `source: "file-fallback"`.
- **Fallback triggers on insert failure,** not just on an absent configuration. A record appears in
  both MongoDB and the file only when the Mongo write itself throws.
- **New `MONGO_TIMEOUT_MS`** (default 5000) bounds the connect attempt so an unreachable MongoDB
  cannot stall startup for Mongoose's default 30s.
- **Startup log reports real connectivity,** not merely whether a URI was configured.
- **Loggers are flushed on shutdown** via `closeLoggers()` in the `SIGINT`/`SIGTERM` handler.

Note that a failure to write the fallback file is itself only logged, not surfaced — the API must
not fail a request whose mail was already processed.

### Phase 3 — Asynchronous Background Task Queue (BullMQ + Redis)

Added for production reliability when dispatching bulk emails (> 100 recipients):

- **Asynchronous batching:** `POST /send` pushes batches to BullMQ (`emailQueue`) and immediately responds with `202 Accepted` and a `jobId`, preventing HTTP connection timeouts.
- **Job status endpoint:** `GET /send/status/:jobId` allows clients to monitor state (`waiting`, `active`, `completed`, `failed`), retry attempts, and final outcome counters.
- **Synchronous fallback preserved:** If `REDIS_URL` is omitted or if `POST /send?sync=true` is passed, the request executes synchronously as before.
- **Worker lifecycle:** `queue/emailWorker.js` processes jobs with configurable concurrency (`QUEUE_CONCURRENCY`, default `5`), reuses pooled SMTP connections, and records delivery failures. Server shutdown gracefully closes the queue and worker.
- **Cloud & TLS Redis support:** `config/redis.js` detects `rediss://` schemes (used by Upstash, Render Redis, and Redis Cloud) and sets `tls: { rejectUnauthorized: false }`.

### Phase 4 — Local Docker Orchestration & Production Safeguards

Added to streamline local development and ensure production safety:

- **Complete local Docker Compose ecosystem:** Orchestrates `app`, `mongodb` (7.0), `redis` (7-alpine), and `mailpit` (safe mock SMTP on `:1025` + visual Web UI on `:8025`).
- **NPM Docker scripts:** Added `docker:up`, `docker:down`, `docker:logs` to `package.json`.
- **Environment awareness:** Added `NODE_ENV` handling in `config/env.js`.
- **Production fail-fast safeguards:** In `NODE_ENV=production`, `config/env.js` strictly requires `REDIS_URL` and `MONGODB_URI`, immediately throwing on boot if missing to guarantee reliability in production.

---

## 11. Extending This Codebase

- **New env var** → add to `config/env.js` with an explicit default, then to `.env.example` and the
  README table. Never read `process.env` outside `config/env.js`.
- **New endpoint** → add a router in `routes/`, mount it in `app.js`, and delegate. Keep business
  logic out of the router.
- **New failure reason** → add a branch above the `smtp_error` fallback in `classifyError()`.
- **New persistent field** → extend the schema in `models/FailedEmail.js` and map it in the
  projection inside `failures/record.js`.
- **Templating / attachments** → extend the normalized entry shape in `email/normalize.js`, then
  `sendOne()` in `email/send.js`. Both are intentionally small extension points.
- **New log destination** → add a transport in `logger.js`. If the failure sink gains a new
  fallback, update the table in §9a and the README together.

---

## 12. Known Gaps

- **No tests.** `node:test` is built in and needs no dependency. The natural first targets are
  `email/normalize.js` (pure, no I/O) and `classifyError()` (pure). `app.js` is now importable
  without side effects, so route-level tests are also straightforward.
- **No linter/formatter.** Formatting is Prettier-compatible by convention (double quotes,
  semicolons, 2-space indent) but unenforced.
- **No CI.**
- **Transient failure retries:** Queued jobs via BullMQ automatically retry 3 times with exponential backoff (5s delay); however, direct synchronous sends (`?sync=true` or when Redis is absent) fail permanently on `smtp_error` without retries.
- **No request size limit.** `express.json()` runs with its 100kb default; a large `emails` array
  with HTML bodies can approach it.
- **No deduplication** of repeated addresses within one request.
- **No replay of `logs/failed-emails.log` into MongoDB.** When Mongo is down, records live only
  in the file; nothing reads that file back. This is the main outstanding gap in the fallback.

---

## 13. Verification Status

Verified by booting the server and exercising each branch. All 16 modules pass `node --check`,
and the server starts with empty stderr.

**API contract** (against the live MongoDB at `mongodb://localhost:27017/email-sender`):

- `GET /health` → `200 {"status":"ok"}`.
- All eight malformed-input cases → `400` with the original error strings intact.
- `GET /unknown` → `404` JSON; malformed JSON → `400 {"ok":false,"error":"Malformed JSON body."}`.
- A live two-recipient send against `smtp.gmail.com` returned `200` with both recipients correctly
  classified `auth_failed`, in request order.

**Failure sink resolution** — one send per scenario, asserting where the record landed:

| Scenario | Result |
|---|---|
| `MONGODB_URI` set, Mongo reachable | `auth_failed` record confirmed in `failedemails` |
| `MONGODB_URI` unset | record written to `logs/failed-emails.log`, `source: "file-fallback"` |
| `MONGODB_URI` pointed at a dead port | connect failed in ~5s, record written to `logs/failed-emails.log` |

All 7 verification records created during this work were deleted from `failedemails` afterwards;
the collection was left empty.

**Two bugs found and fixed during verification** (both invisible in the happy path):

1. `writeFailureLog` called `.once()` on the return of `logger.write()`, which is a **boolean**,
   not a stream. Every fallback write threw `stream.once is not a function` and was silently
   swallowed by the surrounding `try/catch`, producing a 0-byte failure log that still reported
   success. See §9b.
2. An unreachable MongoDB blocked startup for Mongoose's default 30s `serverSelectionTimeoutMS`,
   so the server never called `listen()`. This defeats the point of making Mongo optional.
   Fixed with `MONGO_TIMEOUT_MS` (default 5000).

**Unrelated pre-existing issue:** `npm audit` reports 1 high-severity advisory against
`nodemailer` 6.10.1 (SMTP command injection / CRLF header injection family). Not introduced by
this work. The fix is `nodemailer@10`, a breaking major upgrade that needs its own pass.

There is no automated suite, so this was manual and one-off — any change after this point should
add coverage rather than relying on re-running it by hand.
