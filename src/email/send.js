import { config } from "../config/env.js";
import { transporter } from "../config/mailer.js";
import { sendResendEmail } from "../config/resend.js";
import { logger } from "../logger.js";
import { getAutoPdfAttachment } from "./pdf.js";
import { resolveEmailContent } from "./template.js";

export const classifyError = (error) => {
  if (error?.code === "EAUTH" || error?.status === 401) return "auth_failed";
  if (error?.code === "ENOTFOUND") return "dns_error";

  const message = (error?.message ?? "").toLowerCase();
  if (
    message.includes("invalid address") ||
    message.includes("invalid recipient") ||
    message.includes("invalid_to") ||
    message.includes("invalid email")
  ) {
    return "invalid_address";
  }

  return "smtp_error";
};

const sendOne = async (entry) => {
  const {
    to,
    attachPdf,
    pdfTitle,
    pdfContent,
    attachments = [],
  } = entry;

  const { subject, text, html } = resolveEmailContent(entry);
  const providerStart = Date.now();

  try {
    const emailAttachments = [...attachments];

    if (attachPdf) {
      const pdfAttachment = await getAutoPdfAttachment({
        to,
        subject,
        html,
        text,
        pdfTitle,
        pdfContent,
      });

      emailAttachments.push(pdfAttachment);
    }

    if (config.email.provider === "resend") {
      await sendResendEmail({
        to,
        subject,
        html,
        text,
        attachments: emailAttachments,
      });
    } else {
      if (!transporter) {
        throw new Error("SMTP transporter is not initialized. Check your SMTP configuration.");
      }
      await transporter.sendMail({
        from: config.smtp.from,
        to,
        subject,
        html,
        text,
        attachments: emailAttachments.length > 0 ? emailAttachments : undefined,
      });
    }

    const latencyMs = Date.now() - providerStart;
    logger.debug(`Email delivered via ${config.email.provider}`, {
      provider: config.email.provider,
      to,
      subject,
      latencyMs,
      status: "completed",
    });

    return null;
  } catch (error) {
    const latencyMs = Date.now() - providerStart;
    const reason = classifyError(error);

    logger.warn(`Failed to dispatch email via ${config.email.provider}`, {
      provider: config.email.provider,
      to,
      subject,
      latencyMs,
      reason,
      code: error?.code,
      message: error?.message ?? String(error),
      stack: error?.stack,
      status: "failed",
    });

    return {
      email: to,
      subject,
      reason,
      error: error?.message ?? String(error),
    };
  }
};

export const sendRecipients = async (recipients) => {
  // Concurrency is capped at the pool size for SMTP, or 5 for Resend
  const batchSize =
    config.email.provider === "resend" ? 5 : config.smtp.maxConnections;
  const outcomes = new Array(recipients.length);
  const batchStart = Date.now();

  for (let start = 0; start < recipients.length; start += batchSize) {
    const batch = recipients.slice(start, start + batchSize);
    const settled = await Promise.all(batch.map(sendOne));

    // Keep failures in request order regardless of which send resolves first.
    settled.forEach((failure, offset) => {
      outcomes[start + offset] = failure;
    });
  }

  const failures = outcomes.filter(Boolean);
  const durationMs = Date.now() - batchStart;

  logger.info("Batch email delivery completed", {
    total: recipients.length,
    sent: recipients.length - failures.length,
    failed: failures.length,
    durationMs,
    status: failures.length === 0 ? "completed" : failures.length === recipients.length ? "failed" : "completed_with_errors",
  });

  return failures;
};
