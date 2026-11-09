const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    ride: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ride",
      required: true,
      unique: true,
      index: true,
    },
    rider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "INR" },
    method: { type: String, enum: ["cash", "wallet"], required: true },
    status: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "paid",
      index: true,
    },
    reference: { type: String, required: true, unique: true, trim: true },
    paidAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

paymentSchema.index({ rider: 1, createdAt: -1 });

module.exports = mongoose.model("Payment", paymentSchema);
