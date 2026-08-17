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

    // --- Referral program ---
    // Every user gets their own permanent, unique code (generated on first
    // save — see pre("save") hook below) that anyone else can enter, either
    // at signup or once from their profile afterwards.
    referralCode: { type: String, unique: true, sparse: true, uppercase: true, trim: true, index: true },
    // The user whose referral code THIS user entered (once — see
    // referredBy* fields below). Null for anyone who signed up without a
    // code, or who never applied one afterwards.
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // When a code was applied — also doubles as the "have they already used
    // their one lifetime shot at entering a code" guard, independent of
    // whether referredBy ends up set (kept for a clear audit trail).
    referralCodeAppliedAt: { type: Date, default: null },
    // Whether this (referred) user has already consumed the admin-configured
    // referral discount on a plan purchase — the discount, like the code
    // itself, is a once-per-account perk.
    referralDiscountUsed: { type: Boolean, default: false },

    // --- Wallet (referral bonus credits, and later gift cards / other
    // consumables) — always in the smallest currency unit, same convention
    // as Plan/Subscription (paise for INR, cents for USD). See
    // services/wallet.service.js for all reads/writes; never mutate these
    // directly elsewhere so the WalletTransaction ledger stays authoritative.
    wallet: {
      inr: { type: Number, default: 0, min: 0 },
      usd: { type: Number, default: 0, min: 0 },
    },
  },
  { timestamps: true }
);

// Generates a short, human-shareable, unique referral code the first time a
// user document is saved (e.g. "RAHUL7F3K"). Retries on the rare collision
// (unique index) rather than trusting randomness alone.
const generateCandidateCode = (name) => {
  const base = (name || "USER")
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, 5)
    .toUpperCase() || "USER";
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${base}${suffix}`;
};

userSchema.pre("save", async function (next) {
  if (!this.isNew || this.referralCode) return next();

  const User = this.constructor;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateCandidateCode(this.name);
    // eslint-disable-next-line no-await-in-loop
    const exists = await User.exists({ referralCode: candidate });
    if (!exists) {
      this.referralCode = candidate;
      return next();
    }
  }
  // Astronomically unlikely, but fall back to a guaranteed-unique value
  // rather than leaving the user without a referral code.
  this.referralCode = `${generateCandidateCode(this.name)}${Date.now().toString(36).toUpperCase()}`;
  next();
});

module.exports = mongoose.model("User", userSchema);
