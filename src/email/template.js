import fs from "node:fs";
import path from "node:path";

const TEMPLATE_FILENAME = "body.txt";
const SUBJECT_FILENAME = "subject.txt";
const DEFAULT_FALLBACK_SUBJECT = "Full Stack Developer Application — Samir Shaikh";

let cachedTemplate = null;
let cachedSubject = null;

const resolveTemplateFilePath = (filename) => {
  const rootDir = process.cwd();
  const dataPath = path.join(rootDir, "data", filename);
  const rootPath = path.join(rootDir, filename);

  if (fs.existsSync(dataPath)) {
    return dataPath;
  }

  if (fs.existsSync(rootPath)) {
    try {
      const dataDir = path.join(rootDir, "data");
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.renameSync(rootPath, dataPath);
      return dataPath;
    } catch (_) {
      return rootPath;
    }
  }

  return null;
};

/**
 * Loads subject.txt from data/ (or repository root), checking modification time
 * for live reloads without server restarts.
 *
 * @returns {string|null}
 */
export const loadSubjectTemplate = () => {
  const subjectPath = resolveTemplateFilePath(SUBJECT_FILENAME);

  if (!subjectPath || !fs.existsSync(subjectPath)) {
    return null;
  }

  try {
    const stat = fs.statSync(subjectPath);
    if (!cachedSubject || cachedSubject.mtime !== stat.mtimeMs || cachedSubject.path !== subjectPath) {
      const raw = fs.readFileSync(subjectPath, "utf-8").trim();
      cachedSubject = {
        path: subjectPath,
        mtime: stat.mtimeMs,
        subject: raw || DEFAULT_FALLBACK_SUBJECT,
      };
    }

    return cachedSubject.subject;
  } catch (error) {
    console.error(`[template] Failed to read ${SUBJECT_FILENAME}:`, error.message);
    return null;
  }
};

/**
 * Converts URLs in plain text to clickable HTML anchor links.
 *
 * @param {string} text
 * @returns {string}
 */
const linkifyUrls = (text) => {
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  return text.replace(
    urlRegex,
    '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: underline;">$1</a>'
  );
};

/**
 * Converts plain text into clean, formatted HTML paragraphs suitable for email clients.
 *
 * @param {string} text
 * @returns {string}
 */
export const textToHtml = (text) => {
  if (!text) return "<p>Hello</p>";

  const paragraphs = text
    .trim()
    .split(/\r?\n\r?\n+/)
    .map((para) => {
      const formattedLines = linkifyUrls(
        para
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
      ).replace(/\r?\n/g, "<br/>");

      return `<p style="margin: 0 0 14px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.6; color: #1e293b;">${formattedLines}</p>`;
    });

  return `<div style="max-width: 650px; margin: 0; padding: 10px 0;">${paragraphs.join("\n")}</div>`;
};

/**
 * Loads and parses body.txt from data/ (or repository root), checking modification time
 * for live reloads without server restarts.
 *
 * @returns {{ subject?: string, text?: string, html?: string } | null}
 */
export const loadBodyTemplate = () => {
  const templatePath = resolveTemplateFilePath(TEMPLATE_FILENAME);

  if (!templatePath || !fs.existsSync(templatePath)) {
    return null;
  }

  try {
    const stat = fs.statSync(templatePath);
    if (!cachedTemplate || cachedTemplate.mtime !== stat.mtimeMs || cachedTemplate.path !== templatePath) {
      const raw = fs.readFileSync(templatePath, "utf-8").trim();

      let subject = DEFAULT_FALLBACK_SUBJECT;
      let bodyText = raw;

      // Optional: Check if the first line specifies a Subject: header
      const lines = raw.split(/\r?\n/);
      if (lines.length > 0 && lines[0].toLowerCase().startsWith("subject:")) {
        subject = lines[0].replace(/^subject:\s*/i, "").trim();
        bodyText = lines.slice(1).join("\n").trim();
      }

      cachedTemplate = {
        path: templatePath,
        mtime: stat.mtimeMs,
        subject,
        text: bodyText,
        html: textToHtml(bodyText),
      };
    }

    return cachedTemplate;
  } catch (error) {
    console.error(`[template] Failed to read ${TEMPLATE_FILENAME}:`, error.message);
    return null;
  }
};

/**
 * Resolves subject, text, and html for an email recipient, prioritizing explicit
 * payload fields and falling back to subject.txt and body.txt.
 *
 * @param {Object} entry - Recipient entry
 * @returns {{ subject: string, text: string, html: string }}
 */
export const resolveEmailContent = (entry = {}) => {
  const template = loadBodyTemplate();
  const fileSubject = loadSubjectTemplate();

  let subject = entry.subject || fileSubject || template?.subject || DEFAULT_FALLBACK_SUBJECT;
  let text = entry.text;
  let html = entry.html;

  // If neither html nor text was explicitly provided in the request payload
  if (!text && !html) {
    if (template) {
      text = template.text;
      html = template.html;
    } else {
      text = "Hello";
      html = "<p>Hello</p>";
    }
  } else if (text && !html) {
    html = textToHtml(text);
  } else if (html && !text) {
    text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  // Replace placeholders if present ({to}, {{to}}, {email}, {{email}})
  if (entry.to) {
    const replacePlaceholder = (content) =>
      content
        ? content
            .replace(/\{\{to\}\}/gi, entry.to)
            .replace(/\{to\}/gi, entry.to)
            .replace(/\{\{email\}\}/gi, entry.to)
            .replace(/\{email\}/gi, entry.to)
        : content;

    subject = replacePlaceholder(subject);
    text = replacePlaceholder(text);
    html = replacePlaceholder(html);
  }

  return { subject, text, html };
};
