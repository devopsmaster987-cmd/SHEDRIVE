const mongoose = require("mongoose");

const pointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: {
      type: [Number],
      default: undefined,
      validate: {
        validator(value) {
          return (
            value === undefined ||
            (Array.isArray(value) &&
              value.length === 2 &&
              value[0] >= -180 &&
              value[0] <= 180 &&
              value[1] >= -90 &&
              value[1] <= 90)
          );
        },
        message: "Invalid coordinates.",
      },
    },
  },
  { _id: false }
);

const driverDetailsSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    vehicleType: { type: String, enum: ["Car", "Auto", "Bike"], required: true },
    plateNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 16 },
    licenseDocUrl: { type: String, required: true },
    licenseDocStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    licenseDocNote: { type: String, trim: true, maxlength: 500, default: "" },
    licenseDocReviewedAt: { type: Date, default: null },
    licenseDocReviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    ratingAvg: { type: Number, default: 5, min: 0, max: 5 },
    isOnline: { type: Boolean, default: false },
    currentLocation: { type: pointSchema, default: undefined },
    activeRide: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ride",
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

driverDetailsSchema.index({ currentLocation: "2dsphere" }, { sparse: true });

module.exports = mongoose.model("DriverDetails", driverDetailsSchema);
