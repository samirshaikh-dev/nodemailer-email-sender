import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";

export const DEFAULT_PDF_NAME = "Samir_Shaikh_FullStack_Developer.pdf";
export const TARGET_PDF_NAME = DEFAULT_PDF_NAME;

let cachedPdf = null;

const ensureDataDir = (rootDir) => {
  const dataDir = path.join(rootDir, "data");
  if (!fs.existsSync(dataDir)) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch (_) {}
  }
  return dataDir;
};

/**
 * Searches the 'data' directory (and project root) for any PDF file,
 * prioritizing data/ folder and automatically moving root PDFs into data/.
 *
 * @returns {string|null} Absolute path to the discovered PDF file, or null
 */
export const findRepoPdf = () => {
  const rootDir = process.cwd();
  const dataDir = ensureDataDir(rootDir);

  // 1. Check data directory for Samir_Shaikh_FullStack_Developer.pdf
  const primaryDataPath = path.join(dataDir, DEFAULT_PDF_NAME);
  if (fs.existsSync(primaryDataPath)) {
    return primaryDataPath;
  }

  const legacyDataPath = path.join(dataDir, "Samir_Full_Stack_Developer_Resume.pdf");
  if (fs.existsSync(legacyDataPath)) {
    return legacyDataPath;
  }

  // 2. Check if a candidate PDF exists in root, and automatically move it into data/
  const candidateRootFiles = [
    DEFAULT_PDF_NAME,
    "Samir_Full_Stack_Developer_Resume.pdf",
  ];

  for (const candidate of candidateRootFiles) {
    const rootPath = path.join(rootDir, candidate);
    if (fs.existsSync(rootPath)) {
      const destPath = path.join(dataDir, candidate);
      try {
        fs.renameSync(rootPath, destPath);
        return destPath;
      } catch (err) {
        try {
          fs.copyFileSync(rootPath, destPath);
          fs.unlinkSync(rootPath);
          return destPath;
        } catch (_) {
          return rootPath;
        }
      }
    }
  }

  // 3. Scan 'data' directory for any other .pdf file
  try {
    const dataFiles = fs.readdirSync(dataDir);
    const pdfFile = dataFiles.find(
      (file) => file.toLowerCase().endsWith(".pdf") && !file.startsWith(".")
    );
    if (pdfFile) {
      return path.join(dataDir, pdfFile);
    }
  } catch (_) {}

  // 4. Scan root directory for any available .pdf file and move to data/
  try {
    const rootFiles = fs.readdirSync(rootDir);
    const pdfFile = rootFiles.find(
      (file) => file.toLowerCase().endsWith(".pdf") && !file.startsWith(".")
    );
    if (pdfFile) {
      const src = path.join(rootDir, pdfFile);
      const dest = path.join(dataDir, pdfFile);
      try {
        fs.renameSync(src, dest);
        return dest;
      } catch (_) {
        return src;
      }
    }
  } catch (_) {}

  // 5. Custom path from env if configured
  if (process.env.RESUME_PDF_PATH && fs.existsSync(process.env.RESUME_PDF_PATH)) {
    return process.env.RESUME_PDF_PATH;
  }

  return null;
};

/**
 * Retrieves the PDF attachment for outgoing emails.
 * Automatically picks up the PDF from data/ (or project root)
 * with in-memory caching, or falls back to dynamic generation.
 *
 * @param {Object} entry - Recipient entry details
 * @returns {Promise<{ filename: string, content: Buffer, contentType: string }>}
 */
export const getAutoPdfAttachment = async (entry = {}) => {
  const pdfPath = findRepoPdf();

  if (pdfPath) {
    try {
      const stat = fs.statSync(pdfPath);
      if (!cachedPdf || cachedPdf.mtime !== stat.mtimeMs || cachedPdf.path !== pdfPath) {
        cachedPdf = {
          path: pdfPath,
          content: fs.readFileSync(pdfPath),
          mtime: stat.mtimeMs,
        };
      }

      const filename = path.basename(pdfPath);

      return {
        filename,
        content: cachedPdf.content,
        contentType: "application/pdf",
      };
    } catch (err) {
      // If reading the file fails, fall through to dynamic generation
    }
  }

  // Fallback: Generate dynamically if no physical PDF exists in repo
  const generatedBuffer = await generateEmailPdf(entry);
  return {
    filename: DEFAULT_PDF_NAME,
    content: generatedBuffer,
    contentType: "application/pdf",
  };
};

const stripHtml = (html) => {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

/**
 * Automatically generates a professional PDF buffer for email attachments.
 *
 * @param {Object} options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} [options.text] - Plain text body
 * @param {string} [options.html] - HTML body
 * @param {string} [options.pdfTitle] - Optional custom title for the PDF header
 * @param {string} [options.pdfContent] - Optional custom content body for the PDF
 * @returns {Promise<Buffer>}
 */
export const generateEmailPdf = ({
  to,
  subject = "Notification",
  text,
  html,
  pdfTitle,
  pdfContent,
}) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 50,
      });

      const buffers = [];
      doc.on("data", (chunk) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", (error) => reject(error));

      // Header Banner
      doc
        .rect(50, 45, 495, 45)
        .fill("#2563eb");

      doc
        .fillColor("#ffffff")
        .fontSize(18)
        .font("Helvetica-Bold")
        .text(pdfTitle || "CONFIRMATION & DELIVERY RECORD", 65, 58);

      doc.moveDown(3);

      // Metadata Card
      doc
        .rect(50, 110, 495, 90)
        .fillAndStroke("#f8fafc", "#e2e8f0");

      doc.fillColor("#1e293b").font("Helvetica-Bold").fontSize(11);
      doc.text("Recipient:", 65, 125);
      doc.font("Helvetica").text(to, 140, 125);

      doc.font("Helvetica-Bold").text("Subject:", 65, 145);
      doc.font("Helvetica").text(subject, 140, 145);

      doc.font("Helvetica-Bold").text("Generated:", 65, 165);
      doc.font("Helvetica").text(new Date().toUTCString(), 140, 165);

      // Body Section
      doc.moveDown(5);
      doc.fillColor("#334155").font("Helvetica-Bold").fontSize(14);
      doc.text("Message Details", 50, 220);

      doc
        .moveTo(50, 240)
        .lineTo(545, 240)
        .strokeColor("#cbd5e1")
        .stroke();

      const bodyText =
        pdfContent ||
        text ||
        stripHtml(html) ||
        "This document confirms that your email was processed and dispatched successfully.";

      doc
        .fillColor("#475569")
        .font("Helvetica")
        .fontSize(11)
        .text(bodyText, 50, 255, {
          width: 495,
          lineGap: 4,
        });

      // Footer
      doc
        .fontSize(9)
        .fillColor("#94a3b8")
        .text(
          "Automated Document Attachment • Generated by nodemailer-email-sender",
          50,
          750,
          { align: "center", width: 495 }
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};
