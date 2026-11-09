const mongoose = require("mongoose");

const ridePointSchema = new mongoose.Schema(
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
        message: "Invalid coordinates.",
      },
    },
  },
  { _id: false }
);

const rideSchema = new mongoose.Schema(
  {
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
    pickup: { type: ridePointSchema, required: true },
    drop: { type: ridePointSchema, required: true },
    pickupLabel: { type: String, trim: true, maxlength: 160, default: "" },
    dropLabel: { type: String, trim: true, maxlength: 160, default: "" },
    vehicleType: { type: String, enum: ["Car", "Auto", "Bike"], default: "Car" },
    distanceKm: { type: Number, required: true, min: 0 },
    durationMinutes: { type: Number, min: 0, default: null },
    offeredPrice: { type: Number, required: true, min: 0 },
    finalPrice: { type: Number, min: 0, default: null },
    acceptedOffer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RideOffer",
      default: null,
    },
    status: {
      type: String,
      enum: ["searching", "accepted", "arriving", "in_progress", "completed", "cancelled"],
      default: "searching",
      index: true,
    },
    acceptedAt: { type: Date, default: null },
    arrivedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: {
      type: String,
      enum: ["rider", "driver", "admin", null],
      default: null,
    },
    cancellationReason: { type: String, trim: true, maxlength: 160, default: "" },
  },
  { timestamps: true }
);

rideSchema.index({ rider: 1, status: 1, createdAt: -1 });
rideSchema.index({ driver: 1, status: 1, createdAt: -1 });
rideSchema.index({ pickup: "2dsphere" });

module.exports = mongoose.model("Ride", rideSchema);
