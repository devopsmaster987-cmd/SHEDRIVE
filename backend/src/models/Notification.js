const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["sos", "account", "ride", "payment", "safety", "system"],
      default: "system",
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    message: { type: String, required: true, trim: true, maxlength: 500 },
    readStatus: { type: Boolean, default: false, index: true },
    ride: { type: mongoose.Schema.Types.ObjectId, ref: "Ride", default: null },
    sosAlert: { type: mongoose.Schema.Types.ObjectId, ref: "SOSAlert", default: null },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, readStatus: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
