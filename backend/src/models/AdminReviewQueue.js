const mongoose = require("mongoose");

const adminReviewQueueSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    faceConfidenceScore: { type: Number, default: 0, min: 0, max: 1 },
    facePrediction: {
      type: String,
      enum: ["female", "male", "unknown", null],
      default: null,
    },
    faceDecision: {
      type: String,
      enum: ["needs_review", "no_face", "unavailable", null],
      default: null,
    },
    submittedDocs: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    note: { type: String, default: "", maxlength: 500 },
  },
  { timestamps: true }
);

adminReviewQueueSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model("AdminReviewQueue", adminReviewQueueSchema);
