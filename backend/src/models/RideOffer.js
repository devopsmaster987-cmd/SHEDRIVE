const mongoose = require("mongoose");

const rideOfferSchema = new mongoose.Schema(
  {
    ride: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ride",
      required: true,
      index: true,
    },
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    driverName: { type: String, required: true, trim: true, maxlength: 80 },
    vehicleType: { type: String, enum: ["Car", "Auto", "Bike"], required: true },
    plateNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 16 },
    ratingAvg: { type: Number, default: 5, min: 0, max: 5 },
    offerPrice: { type: Number, required: true, min: 0, max: 10000 },
    note: { type: String, trim: true, maxlength: 80, default: "" },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "countered", "expired"],
      default: "pending",
      index: true,
    },
    expiresAt: { type: Date, required: true, index: true },
    respondedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

rideOfferSchema.index({ ride: 1, status: 1, createdAt: 1 });
rideOfferSchema.index({ ride: 1, driver: 1, status: 1 });

module.exports = mongoose.model("RideOffer", rideOfferSchema);
