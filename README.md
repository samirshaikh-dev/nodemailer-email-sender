# Minimal Email Sending Backend

Express API that sends bulk/individual email over pooled SMTP, with optional BullMQ queueing
and durable failure records.

- **Queue**: BullMQ + Redis — `POST /send` returns `202` + `jobId`. Omit `REDIS_URL` or pass
  `?sync=true` to send inline and get `200` with per-recipient results.
  the API directly. Preflights are answered with `204`.
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

### Providers
- **SMTP** (`EMAIL_PROVIDER=smtp`, default): requires `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`.
- **Resend** (`EMAIL_PROVIDER=resend`): requires `RESEND_API_KEY`. Recommended for hosts like Render Free Tier where SMTP ports (25, 465, 587) are blocked.

In `NODE_ENV=production`, `REDIS_URL` and `MONGODB_URI` are required too.

## API

| Route | Purpose |
|---|---|
| `GET /health` | Process state + a bounded Mongo/SMTP/Redis probe → `{"status":"ok", checks}` |
| `POST /send` | `{"emails":["a@b.com",{"to":"c@d.com","subject":"Hi","html":"..."}]}` |
| `GET /send/status/:jobId` | Queued job state and counts |

Errors are `{"ok": false, "error": "..."}`. See [API.md](API.md) for payloads and response shapes.

## More

- [API.md](API.md) — full request/response reference
- [context.md](context.md) — architecture, config table, invariants, and extension guide
