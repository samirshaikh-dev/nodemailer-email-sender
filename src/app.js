import express from "express";
import { config } from "./config/env.js";
import { corsMiddleware } from "./middleware/cors.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { healthRouter } from "./routes/health.js";
import { sendRouter } from "./routes/send.js";

const app = express();

app.use(corsMiddleware);
app.use(express.json());
app.use(requestLogger);

// Convenient redirects for dashboard entry
app.get(["/admin", "/dashboard"], (_req, res) => {
  res.redirect(config.bullBoard.basePath);
});

app.use(config.bullBoard.basePath, dashboardRouter);
app.use("/health", healthRouter);
app.use("/send", sendRouter);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;

