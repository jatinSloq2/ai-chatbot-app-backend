const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      required: [true, "Name is required"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    // Not required because Google-only users won't have a local password
    password: {
      type: String,
      minlength: 6,
      select: false, // never return password by default in queries
    },
    authProvider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
    },
    googleId: {
      type: String,
      default: null,
    },
    avatar: {
      type: String,
      default: null,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },

    // --- Email OTP verification fields ---
    otpCodeHash: { type: String, select: false },
    otpExpiresAt: { type: Date, select: false },
    otpPurpose: {
      type: String,
      enum: ["verify_email", "reset_password", null],
      default: null,
      select: false,
    },
    otpAttempts: { type: Number, default: 0, select: false },

    // --- Refresh token tracking (for logout / rotation) ---
    refreshTokenHash: { type: String, select: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
