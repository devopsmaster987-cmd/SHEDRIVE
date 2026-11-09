const mongoose = require("mongoose");

const emergencyContactSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    phone: { type: String, required: true, trim: true, maxlength: 24 },
    relationship: { type: String, trim: true, maxlength: 40, default: "" },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 160,
      index: true,
    },
    phone: { type: String, required: true, unique: true, trim: true, maxlength: 24 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["rider", "driver", "admin"], required: true },
    faceEmbedding: { type: [Number], default: [], select: false },
    verificationStatus: {
      type: String,
      enum: ["pending", "approved", "pending_review", "rejected"],
      default: "pending",
      index: true,
    },
    phoneVerified: { type: Boolean, default: false },
    emergencyContacts: { type: [emergencyContactSchema], default: [] },
    walletBalance: { type: Number, default: 0, min: 0 },
    isBanned: { type: Boolean, default: false },
    moderationReason: { type: String, trim: true, maxlength: 300, default: "" },
    moderatedAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.faceEmbedding;
    return ret;
  },
});

module.exports = mongoose.model("User", userSchema);
