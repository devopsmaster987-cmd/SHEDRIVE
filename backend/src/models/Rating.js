const mongoose = require("mongoose");

const ratingSchema = new mongoose.Schema(
  {
    ride: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ride",
      required: true,
      index: true,
    },
    ratedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    ratedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    stars: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 280, default: "" },
  },
  { timestamps: true }
);

// Each participant can rate the other side once per completed ride.
ratingSchema.index({ ride: 1, ratedBy: 1 }, { unique: true });

module.exports = mongoose.model("Rating", ratingSchema);
