import fs from "node:fs";
import path from "node:path";
import { logger } from "../logger.js";

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
    logger.error(`[template] Failed to read ${SUBJECT_FILENAME}: ${error.message}`);
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
  return text.replace(urlRegex, (url) => {
    const match = url.match(/^(.+?)([.,;:)]*)$/);
    const cleanUrl = match ? match[1] : url;
    const trailing = match ? match[2] : "";
    return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: underline; text-underline-offset: 2px;">${cleanUrl}</a>${trailing}`;
  });
};

/**
 * Escapes special HTML characters in plain text to prevent injection.
 *
 * @param {string} text
 * @returns {string}
 */
const escapeHtml = (text) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * Converts markdown-style **bold** markers to inline-styled strong tags.
 *
 * @param {string} text
 * @returns {string}
 */
const formatMarkdown = (text) =>
  text.replace(/\*\*(.+?)\*\*/g, '<strong style="font-weight: 600; color: #0f172a;">$1</strong>');

/**
 * Converts plain text into clean, formatted HTML paragraphs and lists suitable for email clients.
 *
 * @param {string} text
 * @returns {string}
 */
export const textToHtml = (text) => {
  const FONT_FAMILY =
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const TEXT_COLOR = "#1e293b";

  if (!text) {
    return `<div style="max-width: 600px; margin: 0; padding: 4px 0; font-family: ${FONT_FAMILY}; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};"><p style="margin: 0 0 14px 0;">Hello</p></div>`;
  }

  const isBulletLine = (line) => /^\s*[•\-\*]\s+/.test(line);

  const paragraphs = text
    .trim()
    .split(/\r?\n\r?\n+/)
    .map((para) => {
      const rawLines = para.split(/\r?\n/);
      const hasBullets = rawLines.some((line) => isBulletLine(line));

      if (hasBullets) {
        const sections = [];
        let currentList = null;
        let currentTextLines = [];

        const flushText = () => {
          if (currentTextLines.length > 0) {
            const content = formatMarkdown(
              linkifyUrls(escapeHtml(currentTextLines.join("\n")))
            ).replace(/\n/g, "<br/>");

            sections.push(
              `<p style="margin: 0 0 8px 0; font-family: ${FONT_FAMILY}; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">${content}</p>`
            );
            currentTextLines = [];
          }
        };

        const flushList = () => {
          if (currentList && currentList.length > 0) {
            const itemsHtml = currentList
              .map((item, idx) => {
                const isLast = idx === currentList.length - 1;
                const itemContent = formatMarkdown(linkifyUrls(escapeHtml(item)));
                return `<li style="margin: 0 0 ${isLast ? "2px" : "8px"} 0; line-height: 1.6; color: ${TEXT_COLOR};">${itemContent}</li>`;
              })
              .join("\n");

            sections.push(
              `<ul style="margin: 0 0 14px 0; padding-left: 20px; list-style-type: disc; font-family: ${FONT_FAMILY}; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">\n${itemsHtml}\n</ul>`
            );
            currentList = null;
          }
        };

        for (const line of rawLines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (isBulletLine(trimmed)) {
            flushText();
            if (!currentList) currentList = [];
            currentList.push(trimmed.replace(/^[•\-\*]\s+/, ""));
          } else {
            flushList();
            currentTextLines.push(trimmed);
          }
        }

        flushText();
        flushList();

        return sections.join("\n");
      }

      const formattedLines = formatMarkdown(
        linkifyUrls(escapeHtml(para))
      ).replace(/\r?\n/g, "<br/>");

      return `<p style="margin: 0 0 14px 0; font-family: ${FONT_FAMILY}; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">${formattedLines}</p>`;
    });

  return `<div style="max-width: 600px; margin: 0; padding: 4px 0; font-family: ${FONT_FAMILY}; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">${paragraphs.join("\n")}</div>`;
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
    logger.error(`[template] Failed to read ${TEMPLATE_FILENAME}: ${error.message}`);
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
