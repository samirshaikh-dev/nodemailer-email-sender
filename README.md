# Minimal Email Sending Backend

A lightweight, production-ready backend service designed to send bulk or individual emails via Nodemailer with SMTP, connection pooling, BullMQ asynchronous background queues, and automatic failure logging into MongoDB.

## Features

- **Asynchronous Task Queue (BullMQ + Redis)**: Offloads large email batches to background workers, immediately returning `202 Accepted` to prevent HTTP request timeouts.
- **Connection Pooling & Concurrency**: Nodemailer SMTP transport reuses pooled connections with controlled batch concurrency.
- **Flexible Payload**: Accepts recipient lists as plain email strings or customized objects (with specific subject, html, or text).
- **Automatic Resume PDF Attachment**: Automatically detects any PDF file in the repository (prioritizing `Samir_Full_Stack_Developer_Resume.pdf`) and attaches it to outgoing emails with the filename **`Samir_Full_Stack_Developer_Resume.pdf`**, using in-memory caching for zero-overhead bulk sending.
- **Quick Subject & Message Editing via `subject.txt` & `body.txt`**: When `subject`, `html`, or `text` is omitted in the request, the server automatically loads the subject from `subject.txt` and the body from `body.txt` with live reloads, linkifies URLs, and formats clean HTML paragraphs.
- **Automated Failure Logging**: Errors during delivery (SMTP authentication, invalid recipient address, DNS issues, network errors) are caught, classified, and stored in MongoDB under the `failedemails` collection.
- **File Fallback for Failures**: If MongoDB is unconfigured, unreachable, or the insert fails, failed sends are written to `logs/failed-emails.log` (JSONL) instead — records are never silently dropped.
- **Structured Logging**: Winston logger writing human-readable output to the console and JSON to `logs/app.log`.
- **Job Status Tracking**: `GET /send/status/:jobId` to check background job state (`waiting`, `active`, `completed`, `failed`) and view sent/failed counts.
- **Synchronous Fallback**: Supports immediate synchronous sending when Redis is absent or via `POST /send?sync=true`.
- **Health Check**: `GET /health` endpoint for monitoring and uptime probes.
- **Modern JavaScript**: Built using ES Modules (`import`/`export`) on Node.js and Express.

---

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Queue & Background Worker**: BullMQ + Redis (via ioredis)
- **Database**: MongoDB (via Mongoose)
- **Mailing**: Nodemailer (SMTP with connection pooling)
- **Logging**: Winston
- **Configuration**: Dotenv

---

## Project Structure

```
data/
├── Samir_Shaikh_FullStack_Developer.pdf   Resume PDF automatically attached to emails
├── body.txt                              Default email cover letter template (live reload)
├── subject.txt                           Default email subject line (live reload)
└── req.txt                               Project requirements and scope document

src/
├── app.js                 Express app assembly (middleware + routes)
├── server.js              Process startup, DB/Queue/Worker lifecycle, graceful shutdown
├── db.js                  Mongoose connection lifecycle
├── logger.js              Winston loggers: app log + failed-send fallback file
├── config/
│   ├── env.js             Validates env variables, exports config
│   ├── mailer.js          Nodemailer pooled SMTP transport
│   └── redis.js           Redis connection factory (supports TLS/Upstash/Render)
├── email/
│   ├── normalize.js       Request payload validation + normalization
│   ├── pdf.js             Auto-discovers data/ resume PDF & fallback PDF generator
│   ├── send.js            Batching, dispatch, SMTP error classification
│   └── template.js        Loads & live-reloads body.txt & subject.txt from data/
├── failures/
│   └── record.js          Persists failed sends to MongoDB, falls back to file
├── middleware/
│   └── errorHandler.js    JSON 404 + centralized error responses
├── models/
│   └── FailedEmail.js     Mongoose schema for failure records
├── queue/
│   ├── emailQueue.js      BullMQ Queue instance with retries & backoff
│   └── emailWorker.js     Background worker processing jobs asynchronously
└── routes/
    ├── health.js          GET /health
    └── send.js            POST /send & GET /send/status/:jobId
```

---

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Update `.env` with your SMTP, MongoDB, and Redis credentials:

```env
MONGODB_URI=mongodb://localhost:27017/email-sender
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
SMTP_FROM="Email Sender" <your_email@gmail.com>
SMTP_MAX_CONNECTIONS=5
SMTP_MAX_MESSAGES=100
PORT=4000

# Redis connection (Required for async background queue)
REDIS_URL=redis://127.0.0.1:6379
QUEUE_CONCURRENCY=5

# Logging
LOG_LEVEL=info
LOG_DIR=logs
```

- `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS` are required.
- `MONGODB_URI` is optional — without it the API still sends mail, and failed sends are recorded to `logs/failed-emails.log`.
- `REDIS_URL` is optional — if omitted, the API processes requests synchronously without BullMQ.
- `MONGO_TIMEOUT_MS` (default `5000`) bounds the startup connection attempt, so an unreachable MongoDB cannot stall the server.

### 3. Run the Server

- **Development mode** (with auto-reload):
  ```bash
  npm run dev
  ```

- **Production mode**:
  ```bash
  npm start
  ```

Server will run on `http://localhost:4000`.

---

### 4. Running Locally with Docker (Recommended)

Run the complete local ecosystem (App + MongoDB + Redis + Mailpit mock SMTP) with a single command:

```bash
npm run docker:up
# or
docker compose up -d --build
```

#### Services Started:
| Service | Purpose | Port / URL |
| :--- | :--- | :--- |
| **`app`** | Express API & BullMQ worker (live hot reload) | `http://localhost:4000` |
| **`mongodb`** | Database for failure records | `localhost:27017` |
| **`redis`** | In-memory store for BullMQ background queues | `localhost:6379` |
| **`mailpit`** | Mock SMTP server & Webmail UI | SMTP: `localhost:1025`<br>Web UI: `http://localhost:8025` |

> [!TIP]
> **No real SMTP credentials needed for local testing!**
> With Mailpit, any email sent locally will be captured safely. Open `http://localhost:8025` in your browser to inspect delivered emails in real-time.

#### Useful Docker Commands:
- View live application logs:
  ```bash
  npm run docker:logs
  ```
- Stop all containers:
  ```bash
  npm run docker:down
  ```

---

## API Reference

> For comprehensive payload examples, cURL commands, status polling, and error shapes, see [API.md](API.md).

### 1. Health Check

```http
GET /health
```

**Response (`200 OK`)**:
```json
{
  "status": "ok"
}
```

---

### 2. Send Emails

```http
POST /send
Content-Type: application/json
```

#### Example Payload

```json
{
  "emails": [
    "user1@example.com",
    {
      "to": "user2@example.com",
      "subject": "Welcome!",
      "html": "<h1>Welcome</h1>"
    }
  ]
}
```

#### Async Response with Queue (`202 Accepted`)

When `REDIS_URL` is configured:

```json
{
  "ok": true,
  "message": "Email batch accepted and queued for background sending",
  "jobId": "1",
  "total": 2,
  "statusUrl": "/send/status/1"
}
```

#### Sync Response (`200 OK`)

When running in sync mode (`POST /send?sync=true` or without Redis):

```json
{
  "ok": true,
  "total": 2,
  "sent": 1,
  "failed": 1,
  "failures": [
    {
      "email": "invalid-recipient",
      "subject": "Notification",
      "reason": "invalid_address",
      "error": "No recipients defined"
    }
  ]
}
```

---

### 3. Check Job Status

```http
GET /send/status/:jobId
```

**Response (`200 OK`)**:
```json
{
  "ok": true,
  "jobId": "1",
  "state": "completed",
  "progress": 0,
  "result": {
    "total": 2,
    "sent": 2,
    "failed": 0,
    "failures": []
  },
  "failedReason": null,
  "attemptsMade": 1,
  "timestamp": "2026-09-27T08:30:00.000Z"
}
```

---

## Failure Storage & Fallback

Every failed send is recorded, using the first sink that works:

| Condition | Sink |
|---|---|
| `MONGODB_URI` set and connection healthy | MongoDB `failedemails` collection |
| `MONGODB_URI` not set | `logs/failed-emails.log` |
| MongoDB unreachable at startup | `logs/failed-emails.log` |
| MongoDB reachable but `insertMany` throws | `logs/failed-emails.log` |

The fallback file is JSONL — one JSON object per line, carrying the same fields as the Mongo
document plus a `source: "file-fallback"` marker:

```json
{"level":"info","message":"send_failed","email":"bad@example.com","subject":"Hello","reason":"invalid_address","error":"...","attemptedAt":"2026-09-27T08:30:00.000Z","source":"file-fallback"}
```

A record is written to **both** MongoDB and the file only if the Mongo write itself fails.
A persistence failure never propagates to the client: the HTTP response has already been composed,
so losing the record is preferable to failing the request.

> **Deployment caveat:** on platforms with an ephemeral filesystem (Render, Heroku, most
> container hosts) `logs/` is wiped on every redeploy. Treat the file as a diagnostic and
> short-term safety net, not durable storage. Set `MONGODB_URI` for real durability.

---

## Logging

Winston writes to the console (human-readable) and to `logs/app.log` (JSON), rotating at 5 MB
across 5 files. `logs/failed-emails.log` is a separate JSONL sink, rotating at 10 MB across 5 files.

- `LOG_LEVEL` — one of `error`, `warn`, `info`, `http`, `verbose`, `debug`, `silly`; defaults to `info`.
- `LOG_DIR` — destination directory; defaults to `logs` (relative to the working directory).

Both loggers are flushed during graceful shutdown, so buffered writes survive a `SIGTERM`.

---

## Deploying to Render.com

### Step 1: Provision Redis
1. Recommended free option: Create a free Redis database at [Upstash](https://upstash.com) or [Redis Cloud](https://redis.com).
2. Copy the connection URI (e.g. `rediss://default:password@...upstash.io:6379`).

### Step 2: Create Web Service on Render
1. Connect your repository to [Render](https://render.com).
2. Set **Build Command**: `npm install`
3. Set **Start Command**: `npm start`
4. Add Environment Variables:
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `SMTP_FROM`
   - `MONGODB_URI` (from MongoDB Atlas)
   - `REDIS_URL` (from Upstash or Render Redis)
   - `LOG_LEVEL` (optional, defaults to `info`)
5. Deploy! Both the Express API and the BullMQ background worker run inside the single web service, keeping hosting costs at $0 on Render's free tier.

> **Note:** Render's filesystem is ephemeral, so the `logs/` fallback file does not survive a
> redeploy. Keep `MONGODB_URI` configured in production.
