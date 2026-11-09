const mongoose = require("mongoose");

const sosPointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator(value) {
          return (
            Array.isArray(value) &&
            value.length === 2 &&
            value[0] >= -180 &&
            value[0] <= 180 &&
            value[1] >= -90 &&
            value[1] <= 90
          );
        },
        message: "Invalid SOS coordinates.",
      },
    },
  },
  { _id: false }
);

const sosAlertSchema = new mongoose.Schema(
  {
    ride: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ride",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    location: { type: sosPointSchema, required: true },
    raisedAt: { type: Date, default: Date.now, index: true },
    status: {
      type: String,
      enum: ["open", "acknowledged", "resolved"],
      default: "open",
      index: true,
    },
    message: { type: String, trim: true, maxlength: 280, default: "" },
    note: { type: String, trim: true, maxlength: 500, default: "" },
    contactsNotified: { type: Number, min: 0, default: 0 },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    acknowledgedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

sosAlertSchema.index({ status: 1, raisedAt: -1 });
sosAlertSchema.index({ user: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("SOSAlert", sosAlertSchema);
