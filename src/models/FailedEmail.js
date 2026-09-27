import mongoose from "mongoose";

const failedEmailSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, index: true },
    subject: { type: String },
    reason: { type: String, required: true },
    error: { type: String },
    attemptedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const FailedEmail = mongoose.model("FailedEmail", failedEmailSchema);
