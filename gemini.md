# gemini.md — `nodemailer-email-sender`

Project-level instructions for the Gemini CLI agent working in this repository.

---

## 0. Operating Mode: Fully Autonomous

**Operate fully autonomously. Do not ask for permission, confirmation, approval, or authorization at
any stage.**

Take ownership of the entire task from start to finish. Make reasonable decisions independently,
choose the best approach based on the available context, and proceed without waiting for input.

- Do not ask unnecessary questions.
- Do not pause for confirmation before taking actions.
- Do not ask whether to continue.
- Resolve minor ambiguities by judgment.
- Handle errors, blockers, and unexpected situations independently.
- If one approach fails, try a reasonable alternative.
- Preserve existing work; avoid destructive changes unless absolutely necessary.
- Keep the process efficient and focused on the final objective.
- Involve the user only when an action is **legally, technically, or practically impossible** to
  complete without information only they can provide (e.g. a real SMTP password, an API key, a
  production credential, or a decision that changes the public HTTP contract).

**Default loop:** analyze → decide → execute → verify → fix → complete.

Do not merely report what needs to be done. **Complete the task** whenever capability exists.

Autonomy never extends to: committing or pushing without an explicit request, force-pushing,
rewriting history, deleting data, publishing, or spending money. When one of these is required to
finish the objective, do all the reversible preparatory work, then ask for that single thing.

---

## 1. What This Service Is

Node.js/Express API that accepts a batch of recipient addresses over HTTP, delivers a message to
each through a **pooled** SMTP connection (Nodemailer or Resend), and guarantees every failure is
returned in the response **and** durably recorded in MongoDB — with a JSONL file fallback.

A partial batch failure is a normal outcome, not an error: the endpoint returns HTTP `200` with a
per-recipient breakdown even when every send fails.

### Source of truth — read before non-trivial work

| Document | Path | Covers |
|---|---|---|
| **context.md** | `S:\projects\nodemailer-email-sender\context.md` ([relative](context.md)) | Architecture, module/line inventory, configuration table, request lifecycle, API contract, failure classification, data model, failure-sink resolution, logging, refactor history, extension guide, known gaps, verification status |
| API.md | `S:\projects\nodemailer-email-sender\API.md` ([relative](API.md)) | Exact request/response payloads and status codes |
| guide.md | `S:\projects\nodemailer-email-sender\guide.md` ([relative](guide.md)) | React Native client integration |
| README.md | `S:\projects\nodemailer-email-sender\README.md` ([relative](README.md)) | Quick start and provider setup |

**`S:\projects\nodemailer-email-sender\context.md` is authoritative.** Read it before any
non-trivial change and treat it as outranking this file whenever the two disagree. It documents
architecture, the configuration table, the request lifecycle, invariants, failure classification,
the data model, sink resolution, extension points, and known gaps. Verify anything you rely on
against the code itself — `context.md` is documentation, not a substitute for reading `src/`, and
it can lag a change. Keep it accurate in the same change that alters behaviour (§6).

---

## 2. Commands

| Task | Command |
|---|---|
| Install | `npm install` |
| Run (dev, live reload) | `npm run dev` |
| Run (plain) | `npm start` |
| Full local stack (app + mongo + redis + mailpit) | `npm run docker:up` |
| Stream app logs | `npm run docker:logs` |
| Stop stack | `npm run docker:down` |
| Syntax check a module | `node --check src/<file>.js` |
| Health probe | `curl http://localhost:4000/health` |

Default port `4000`. **Mailpit** (`http://localhost:8025`) captures all outgoing mail locally — use
it instead of a real mailbox when verifying a send. There is no build step, transpiler, linter, or
test runner. Do not introduce one without agreement; it changes the deployment contract.

**Verify your own work before reporting completion.** There is no automated suite, so verification
is manual: `node --check` every touched file, boot the server, and exercise the affected route with
`curl` (both the success path and at least one error path). State what you actually ran and what
it returned.

---

## 3. Non-Negotiable Conventions

- **ESM only.** `"type": "module"`; use `import`/`export`. Prettier-compatible formatting:
  double quotes, semicolons, 2-space indent.
- **All env access lives in `src/config/env.js`.** No other file may read `process.env`. Verify
  with a grep for `process\.env` outside `config/env.js`.
- **No `console.*` outside `src/logger.js`.** Use the exported `logger` / `failureLogger`.
  Verify with a grep for `console\.` under `src/`.
- **Layering points one way only:** `server` → `app` → `routes` → `health`/`email`/`failures` →
  `db`/`models`/`queue` → `config`. Nothing below `routes` imports from `routes` or `app`.
- **Routes orchestrate, they contain no logic.** One responsibility per module, mirroring the
  existing 20-file layout.
- **Persistence failures are logged, never surfaced.** A request whose mail was already processed
  must not fail because MongoDB or the log file is unavailable.
- **Never let a logging or observability change alter the public HTTP contract** — paths, status
  codes, and response bodies are stable. `GET /health` still returns `status: "ok"` on success and
  may return `503` when a required dependency is down.

### Invariants that break loudly if ignored

- **Concurrency:** in-flight messages are tied to `SMTP_MAX_CONNECTIONS`. A separate
  `SEND_BATCH_SIZE`, if introduced, must be ≤ `maxConnections`.
- **Ordering:** `failures[]` is returned in **request order**, not completion order — results are
  written back by index.
- **Accounting:** `sent + failed === total` always holds.
- **Classification:** `classifyError()` in `email/send.js` is a chain ending in the `smtp_error`
  catch-all. New reasons go **above** it, or they are unreachable.
- **No side effects on import:** `app.js` must stay importable without binding a port or opening a
  database connection.

---

## 4. Adding Things

| Change | Where |
|---|---|
| New env var | `config/env.js` (explicit default) + `.env.example` + README table |
| New endpoint | Router in `routes/`, mount in `app.js`, delegate; keep logic out of the router |
| New failure reason | Branch above the `smtp_error` fallback in `classifyError()` |
| New persisted field | `models/FailedEmail.js` + the projection in `failures/record.js` |
| Templating / attachments | Normalized entry shape in `email/normalize.js`, then `sendOne()` in `email/send.js` |
| New log destination | Transport in `logger.js`; update the sink table in `context.md` §9a and the README together |
| Tightening CORS | The single options object in `middleware/cors.js`; an origin list belongs in `config/env.js` |
| Unsure where something belongs | `context.md` §4 architecture tree and §11 extension guide; the module/line inventory there maps every file to one responsibility |

**Prefer editing existing modules over adding new ones.** The value of this codebase is that each
file has one job; a new file needs a correspondingly distinct job.

---

## 5. Housekeeping

- Keep `S:\projects\nodemailer-email-sender\context.md` accurate. When behaviour changes, update the
  config table, invariants, and extension guide in the same change — not in a follow-up.
- After any change, re-check §3's greps and run `node --check` on every touched file.
- Known gaps are listed in `context.md` §12 (no tests, no CI, no request size limit, no
  deduplication, no replay of the file fallback into MongoDB, liveness and readiness not split).
  `node:test` is built in, so adding coverage needs no new dependency — prefer it over ad-hoc
  verification when touching pure modules such as `email/normalize.js` or `classifyError()`.
