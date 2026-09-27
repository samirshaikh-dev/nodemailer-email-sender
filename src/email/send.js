import { config } from "../config/env.js";
import { transporter } from "../config/mailer.js";
import { sendResendEmail } from "../config/resend.js";
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
    return null;
  } catch (error) {
    return {
      email: to,
      subject,
      reason: classifyError(error),
      error: error?.message ?? String(error),
    };
  }
};

export const sendRecipients = async (recipients) => {
  // Concurrency is capped at the pool size for SMTP, or 5 for Resend
  const batchSize =
    config.email.provider === "resend" ? 5 : config.smtp.maxConnections;
  const outcomes = new Array(recipients.length);

  for (let start = 0; start < recipients.length; start += batchSize) {
    const batch = recipients.slice(start, start + batchSize);
    const settled = await Promise.all(batch.map(sendOne));

    // Keep failures in request order regardless of which send resolves first.
    settled.forEach((failure, offset) => {
      outcomes[start + offset] = failure;
    });
  }

  return outcomes.filter(Boolean);
};
