  # API Documentation — nodemailer-email-sender

  Complete reference for all HTTP endpoints, payload formats, query parameters, and response structures.

  ---

  ## Base URLs

  - **Local (Docker / Native):** `http://localhost:4000`
  - **Production (Render):** `https://<your-service-name>.onrender.com`

  ---

  ## Common Headers

  | Header | Value | Description |
  | :--- | :--- | :--- |
  | `Content-Type` | `application/json` | Required for all `POST` requests |

  ---

  ## Table of Endpoints

  | Method | Endpoint | Description | Default Status |
  | :--- | :--- | :--- | :--- |
  | `GET` | [`/health`](#1-get-health) | Liveness and health probe | `200 OK` |
  | `POST` | [`/send`](#2-post-send-async-queue-mode) | Dispatch bulk or single emails (async queue) | `202 Accepted` |
  | `POST` | [`/send?sync=true`](#3-post-sendsynctrue-synchronous-mode) | Send emails immediately inline (synchronous) | `200 OK` |
  | `GET` | [`/send/status/:jobId`](#4-get-sendstatusjobid) | Query background job state and results | `200 OK` / `404` |

  ---

  ## 1. `GET /health`

  Checks if the web server process is alive and accepting incoming connections.

  ### Request

  ```http
  GET /health HTTP/1.1
  Host: localhost:4000
  ```

  #### cURL Example:
  ```bash
  curl http://localhost:4000/health
  ```

  ### Response (`200 OK`)

  ```json
  {
    "status": "ok"
  }
  ```

  ---

  ## 2. `POST /send` (Async Queue Mode)

  Enqueues an array of recipients into **BullMQ** for asynchronous delivery by the background worker. This is the **default mode** when `REDIS_URL` is configured. It prevents HTTP timeouts when processing large email lists.

  ### Request URL
  ```http
  POST /send
  Content-Type: application/json
  ```

  ### Request Payloads

  #### Option A: Simple Array of Email Strings
  ```json
  {
    "emails": [
      "alex@example.com",
      "sarah@example.com",
      "developer@example.com"
    ]
  }
  ```

  #### Option B: Array of Custom Email Objects
  ```json
  {
    "emails": [
      {
        "to": "alex@example.com",
        "subject": "Welcome to our Platform!",
        "html": "<h1>Welcome Alex!</h1><p>We are thrilled to have you on board.</p>",
        "text": "Welcome Alex! We are thrilled to have you on board."
      },
      {
        "to": "sarah@example.com",
        "subject": "Monthly Statement",
        "html": "<p>Hi Sarah, your monthly statement is ready.</p>"
      }
    ]
  }
  ```

  #### Option C: Mixed Array (Strings + Custom Objects)
  ```json
  {
    "emails": [
      "plain-user@example.com",
      {
        "to": "custom-user@example.com",
        "subject": "Special Offer",
        "html": "<b>50% off this weekend only!</b>"
      }
    ]
  }
  ```

  #### Option D: PDF Attachment Customization
  By default, a styled delivery record PDF is **automatically generated and attached** to each email. You can customize the title/content or disable it:
  ```json
  {
    "emails": [
      {
        "to": "client@example.com",
        "subject": "Invoice #1042",
        "html": "<p>Please find your invoice attached.</p>",
        "attachPdf": true,
        "pdfTitle": "OFFICIAL INVOICE #1042",
        "pdfContent": "Services rendered: Web Development & API Integration.\nAmount Due: $1,250.00\nDue Date: October 15, 2026."
      },
      {
        "to": "no-attachment@example.com",
        "subject": "Quick Ping",
        "text": "Hello, no PDF needed here.",
        "attachPdf": false
      }
    ]
  }
  ```

  #### cURL Example:
  ```bash
  curl -X POST http://localhost:4000/send \
    -H "Content-Type: application/json" \
    -d '{
      "emails": [
        "user1@example.com",
        {
          "to": "user2@example.com",
          "subject": "Important Notice",
          "html": "<h3>Account Update</h3><p>Your details have been saved.</p>"
        }
      ]
    }'
  ```

  ### Response (`202 Accepted`)

  ```json
  {
    "ok": true,
    "message": "Email batch accepted and queued for background sending",
    "jobId": "1",
    "total": 2,
    "statusUrl": "/send/status/1"
  }
  ```

  ---

  ## 3. `POST /send?sync=true` (Synchronous Mode)

  Bypasses the background queue and sends all emails **synchronously** in the current HTTP request using connection pooling.

  > [!NOTE]
  > Synchronous mode is also used automatically if `REDIS_URL` is omitted from the environment.

  ### Request URL
  ```http
  POST /send?sync=true
  Content-Type: application/json
  ```

  ### Request Payload
  ```json
  {
    "emails": [
      "valid-recipient@example.com",
      "invalid-recipient@bad-domain",
      "not-an-email"
    ]
  }
  ```

  #### cURL Example:
  ```bash
  curl -X POST "http://localhost:4000/send?sync=true" \
    -H "Content-Type: application/json" \
    -d '{
      "emails": [
        "user@example.com",
        "invalid-recipient"
      ]
    }'
  ```

  ### Response (`200 OK`)

  The response returns HTTP 200 even if some or all recipients fail delivery. Partial failures are normal and reported in the `failures` array:

  ```json
  {
    "ok": true,
    "total": 2,
    "sent": 1,
    "failed": 1,
    "failures": [
      {
        "email": "invalid-recipient",
        "subject": "Hello",
        "reason": "invalid_address",
        "error": "No recipients defined"
      }
    ]
  }
  ```

  #### Failure Classification Reasons:
  | `reason` | Description |
  | :--- | :--- |
  | `auth_failed` | SMTP credentials or authentication rejected (`EAUTH`) |
  | `dns_error` | SMTP host could not be resolved (`ENOTFOUND`) |
  | `invalid_address` | Malformed or unrecognized email address format |
  | `smtp_error` | Other SMTP transmission or connection errors |

  ---

  ## 4. `GET /send/status/:jobId`

  Retrieves the processing state, retry attempts, and completion statistics of a queued background job.

  ### Request URL
  ```http
  GET /send/status/1 HTTP/1.1
  Host: localhost:4000
  ```

  #### cURL Example:
  ```bash
  curl http://localhost:4000/send/status/1
  ```

  ### Responses

  #### State A: Job In Progress (`active` or `waiting`)
  ```json
  {
    "ok": true,
    "jobId": "1",
    "state": "active",
    "progress": 0,
    "result": null,
    "failedReason": null,
    "attemptsMade": 0,
    "timestamp": "2026-09-27T08:30:15.000Z"
  }
  ```

  #### State B: Job Completed (`completed`)
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
    "timestamp": "2026-09-27T08:30:15.000Z"
  }
  ```

  #### State C: Job Failed (`failed`)
  ```json
  {
    "ok": true,
    "jobId": "1",
    "state": "failed",
    "progress": 0,
    "result": null,
    "failedReason": "Connection closed unexpectedly",
    "attemptsMade": 3,
    "timestamp": "2026-09-27T08:30:15.000Z"
  }
  ```

  #### State D: Job Not Found (`404 Not Found`)
  ```json
  {
    "ok": false,
    "error": "Job with ID '999' not found."
  }
  ```

  #### State E: Redis Inactive (`503 Service Unavailable`)
  Returned if `GET /send/status/:jobId` is called when Redis/BullMQ is not enabled:
  ```json
  {
    "ok": false,
    "error": "Redis/BullMQ is not enabled. Background jobs are inactive."
  }
  ```

  ---

  ## 5. Error Responses

  All error responses consistently return `{ "ok": false, "error": "<message>" }`.

  ### 400 Bad Request — Missing or Invalid `emails`
  ```json
  // If 'emails' is missing:
  {
    "ok": false,
    "error": "Body must be an object with an 'emails' array."
  }

  // If 'emails' is empty:
  {
    "ok": false,
    "error": "'emails' array must not be empty."
  }

  // If an item in 'emails' is malformed:
  {
    "ok": false,
    "error": "Invalid email entry in 'emails' array. Each item must be a string or an object with a 'to' property."
  }
  ```

  ### 400 Bad Request — Malformed JSON Body
  ```json
  {
    "ok": false,
    "error": "Malformed JSON body."
  }
  ```

  ### 404 Not Found — Unknown Route
  ```json
  {
    "ok": false,
    "error": "Cannot POST /invalid-route"
  }
  ```

  ### 500 Internal Server Error
  ```json
  {
    "ok": false,
    "error": "Internal server error"
  }
  ```
