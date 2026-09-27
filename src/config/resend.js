import { config } from "./env.js";

const RESEND_API_BASE = "https://api.resend.com";

/**
 * Sends an email via Resend's REST API over HTTPS (port 443).
 *
 * @param {Object} options
 * @param {string|string[]} options.to - Recipient email address(es)
 * @param {string} options.subject - Email subject
 * @param {string} [options.html] - HTML content
 * @param {string} [options.text] - Plain text content
 * @param {Array<{filename: string, content: Buffer|string}>} [options.attachments]
 * @returns {Promise<{id: string}>}
 */
export const sendResendEmail = async ({
  to,
  subject,
  html,
  text,
  attachments = [],
}) => {
  if (!config.resend.apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  const formattedAttachments = attachments.map((att) => {
    let content = att.content;
    if (Buffer.isBuffer(content)) {
      content = content.toString("base64");
    }
    return {
      filename: att.filename,
      content,
    };
  });

  const payload = {
    from: config.resend.from,
    to: Array.isArray(to) ? to : [to],
    subject,
    html: html || undefined,
    text: text || undefined,
    attachments: formattedAttachments.length > 0 ? formattedAttachments : undefined,
  };

  const response = await fetch(`${RESEND_API_BASE}/emails`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.resend.apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "nodemailer-email-sender/1.0",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMsg =
      data?.message || data?.error?.message || `Resend API error (${response.status})`;
    const error = new Error(errorMsg);
    error.status = response.status;
    error.name = data?.name || "ResendError";
    throw error;
  }

  return data;
};

/**
 * Probes the Resend API to verify the API key and outbound HTTPS connectivity.
 *
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
export const verifyResend = async (timeoutMs = 5000) => {
  if (!config.resend.apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${RESEND_API_BASE}/api-keys`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${config.resend.apiKey}`,
        "User-Agent": "nodemailer-email-sender/1.0",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      // Resend API keys created with "Sending access" (recommended least-privilege permission)
      // are rejected on GET /api-keys with "This API key is restricted to only send emails".
      // Receiving this response proves outbound HTTPS works and the key is authentic and active for sending.
      if (
        data?.message?.includes("restricted to only send emails") ||
        data?.name === "restricted_api_key"
      ) {
        return true;
      }

      throw new Error(
        data?.message || `Resend authentication failed with status ${response.status}`
      );
    }

    return true;
  } finally {
    clearTimeout(timer);
  }
};
