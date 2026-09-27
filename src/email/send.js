import { config } from "../config/env.js";
import { transporter } from "../config/mailer.js";
import { generateEmailPdf } from "./pdf.js";

const DEFAULT_SUBJECT = "Hello";
const DEFAULT_HTML = "<p>Hello</p>";

export const classifyError = (error) => {
  if (error?.code === "EAUTH") return "auth_failed";
  if (error?.code === "ENOTFOUND") return "dns_error";

  const message = (error?.message ?? "").toLowerCase();
  if (message.includes("invalid address")) return "invalid_address";

  return "smtp_error";
};

const sendOne = async (entry) => {
  const {
    to,
    subject = DEFAULT_SUBJECT,
    html = DEFAULT_HTML,
    text,
    attachPdf,
    pdfTitle,
    pdfContent,
    attachments = [],
  } = entry;

  try {
    const emailAttachments = [...attachments];

    if (attachPdf) {
      const pdfBuffer = await generateEmailPdf({
        to,
        subject,
        html,
        text,
        pdfTitle,
        pdfContent,
      });

      const safeFilename = (subject || "document")
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "_")
        .replace(/_+/g, "_")
        .substring(0, 40);

      emailAttachments.push({
        filename: `${safeFilename || "document"}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      });
    }

    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject,
      html,
      text,
      attachments: emailAttachments.length > 0 ? emailAttachments : undefined,
    });
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
  // Concurrency is capped at the pool size: no more messages can be in flight
  // at once than the transport has open SMTP connections.
  const batchSize = config.smtp.maxConnections;
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
