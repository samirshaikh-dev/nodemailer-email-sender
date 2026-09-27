import nodemailer from "nodemailer";
import { config } from "./env.js";

export const transporter =
  config.smtp.host && config.smtp.user
    ? nodemailer.createTransport({
        pool: true,
        maxConnections: config.smtp.maxConnections,
        maxMessages: config.smtp.maxMessages,
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: {
          user: config.smtp.user,
          pass: config.smtp.pass,
        },
      })
    : null;
