import express from "express";
import { corsMiddleware } from "./middleware/cors.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { healthRouter } from "./routes/health.js";
import { sendRouter } from "./routes/send.js";

const app = express();

app.use(corsMiddleware);
app.use(express.json());
app.use("/health", healthRouter);
app.use("/send", sendRouter);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
