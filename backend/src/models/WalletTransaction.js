const mongoose = require("mongoose");

const walletTransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["topup", "ride_payment", "refund"],
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    balanceAfter: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "INR" },
    ride: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ride",
      default: null,
    },
    description: { type: String, trim: true, maxlength: 160, default: "" },
    reference: { type: String, required: true, unique: true, trim: true },
  },
  { timestamps: true }
);

walletTransactionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("WalletTransaction", walletTransactionSchema);
