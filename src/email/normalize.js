import { config } from "../config/env.js";

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
  }
}

const normalizeEntry = (entry) => {
  if (typeof entry === "string") {
    return {
      to: entry.trim(),
      attachPdf: config.email.autoAttachPdf,
    };
  }

  const isAddressableObject =
    typeof entry === "object" &&
    entry !== null &&
    !Array.isArray(entry) &&
    Boolean(entry.to);

  if (!isAddressableObject) {
    throw new ValidationError(
      "Invalid email entry in 'emails' array. Each item must be a string or an object with a 'to' property."
    );
  }

  return {
    to: String(entry.to).trim(),
    subject: entry.subject ? String(entry.subject) : undefined,
    html: entry.html ? String(entry.html) : undefined,
    text: entry.text ? String(entry.text) : undefined,
    attachPdf:
      typeof entry.attachPdf === "boolean"
        ? entry.attachPdf
        : config.email.autoAttachPdf,
    pdfTitle: entry.pdfTitle ? String(entry.pdfTitle) : undefined,
    pdfContent: entry.pdfContent ? String(entry.pdfContent) : undefined,
    attachments: Array.isArray(entry.attachments) ? entry.attachments : undefined,
  };
};

export const normalizeRecipients = (emails) => {
  if (!Array.isArray(emails)) {
    throw new ValidationError("Body must be an object with an 'emails' array.");
  }

  if (emails.length === 0) {
    throw new ValidationError("'emails' array must not be empty.");
  }

  return emails.map(normalizeEntry);
};
