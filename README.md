# Minimal Email Sending Backend

Express API that sends bulk/individual email over pooled SMTP, with optional BullMQ queueing
and durable failure records.

- **Queue**: BullMQ + Redis — `POST /send` returns `202` + `jobId`. Omit `REDIS_URL` or pass
  `?sync=true` to send inline and get `200` with per-recipient results.
- **Failures**: stored in MongoDB `failedemails`, falling back to `logs/failed-emails.log`.
- **Templates/attachments**: subject and body default to `data/subject.txt` and `data/body.txt`
  (live reload); a PDF in `data/` is attached automatically.

## Run

```bash
npm install
cp .env.example .env      # fill in SMTP credentials
npm run docker:up         # app + mongo + redis + mailpit, no real SMTP needed
```

Mailpit UI: http://localhost:8025. Native instead: `npm run dev`.

`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` are required; the process exits at startup without them.
In `NODE_ENV=production`, `REDIS_URL` and `MONGODB_URI` are required too.

## API

| Route | Purpose |
|---|---|
| `GET /health` | Liveness → `{"status":"ok"}` |
| `POST /send` | `{"emails":["a@b.com",{"to":"c@d.com","subject":"Hi","html":"..."}]}` |
| `GET /send/status/:jobId` | Queued job state and counts |

Errors are `{"ok": false, "error": "..."}`. See [API.md](API.md) for payloads and response shapes.

## More

- [API.md](API.md) — full request/response reference
- [context.md](context.md) — architecture, config table, invariants, and extension guide
