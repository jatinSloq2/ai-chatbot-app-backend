const bcrypt = require("bcryptjs");
const User = require("../models/User");
const ApiError = require("../utils/ApiError");
const { generateOtp, hashOtp, compareOtp, getOtpExpiry } = require("../utils/otp");
const { sendOtpEmail } = require("./email.service");
const referralService = require("./referral.service");
const {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
} = require("../utils/token");
const admin = require("../config/firebase");

const MAX_OTP_ATTEMPTS = 5;

// --- SIGNUP (email + password) ---
const signup = async ({ name, email, password, referralCode }) => {
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new ApiError(409, "An account with this email already exists");
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await User.create({
    name,
    email,
    password: hashedPassword,
    authProvider: "local",
    isEmailVerified: false,
  });

  // Referral code at signup is optional and best-effort — an invalid/typo'd
  // code should never block account creation. Same one-time-use rule as
  // applying it later from the profile page (see referral.service).
  if (referralCode?.trim()) {
    try {
      await referralService.applyReferralCode(user._id, referralCode);
    } catch (err) {
      // Swallow — invalid code, self-referral, etc. User just signs up
      // without a referrer attached.
    }
  }

  await sendVerificationOtp(email);

  return user;
};

// --- Send OTP for email verification or password reset ---
const sendVerificationOtp = async (email) => {
  const user = await User.findOne({ email });
  if (!user) throw new ApiError(404, "No account found with this email");

  const otp = generateOtp();
  user.otpCodeHash = await hashOtp(otp);
  user.otpExpiresAt = getOtpExpiry();
  user.otpPurpose = "verify_email";
  user.otpAttempts = 0;
  await user.save();

  await sendOtpEmail(email, otp, "verify_email");
};

const sendPasswordResetOtp = async (email) => {
  const user = await User.findOne({ email });
  // Don't reveal whether the email exists — respond the same either way at controller level
  if (!user) return;

  const otp = generateOtp();
  user.otpCodeHash = await hashOtp(otp);
  user.otpExpiresAt = getOtpExpiry();
  user.otpPurpose = "reset_password";
  user.otpAttempts = 0;
  await user.save();

  await sendOtpEmail(email, otp, "reset_password");
};

// --- Verify OTP (shared for both verify_email and reset_password) ---
const verifyOtp = async ({ email, otp, purpose }) => {
  const user = await User.findOne({ email }).select(
    "+otpCodeHash +otpExpiresAt +otpPurpose +otpAttempts"
  );
  if (!user) throw new ApiError(404, "No account found with this email");

  if (!user.otpCodeHash || user.otpPurpose !== purpose) {
    throw new ApiError(400, "No OTP request found. Please request a new code");
  }

  if (user.otpAttempts >= MAX_OTP_ATTEMPTS) {
    throw new ApiError(429, "Too many incorrect attempts. Please request a new code");
  }

  if (user.otpExpiresAt < new Date()) {
    throw new ApiError(400, "OTP has expired. Please request a new code");
  }

  const isMatch = await compareOtp(otp, user.otpCodeHash);
  if (!isMatch) {
    user.otpAttempts += 1;
    await user.save();
    throw new ApiError(400, "Invalid OTP");
  }

  // OTP is correct - clear it so it can't be reused
  user.otpCodeHash = undefined;
  user.otpExpiresAt = undefined;
  user.otpPurpose = null;
  user.otpAttempts = 0;

  if (purpose === "verify_email") {
    user.isEmailVerified = true;
  }

  await user.save();
  return user;
};

// --- Reset password after OTP verified ---
const resetPassword = async ({ email, otp, newPassword }) => {
  // Re-verify OTP as part of the reset flow (defense in depth — don't trust a
  // prior "verified" flag stored client-side)
  const user = await verifyOtp({ email, otp, purpose: "reset_password" });

  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();
  return user;
};

// --- LOGIN (email + password) ---
const login = async ({ email, password }) => {
  const user = await User.findOne({ email }).select("+password");
  if (!user || user.authProvider !== "local") {
    throw new ApiError(401, "Invalid email or password");
  }

  const isMatch = await bcrypt.compare(password, user.password || "");
  if (!isMatch) {
    throw new ApiError(401, "Invalid email or password");
  }

  if (!user.isEmailVerified) {
    throw new ApiError(403, "Please verify your email before logging in");
  }

  return user;
};

// --- GOOGLE LOGIN (via Firebase ID token from frontend) ---
const googleLogin = async (idToken) => {
  if (!idToken) throw new ApiError(400, "Firebase ID token is required");

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    throw new ApiError(401, "Invalid or expired Google token");
  }

  const { email, name, picture, uid } = decoded;
  if (!email) throw new ApiError(400, "Google account has no email");

  let user = await User.findOne({ email });

  if (!user) {
    user = await User.create({
      name: name || email.split("@")[0],
      email,
      authProvider: "google",
      googleId: uid,
      avatar: picture || null,
      isEmailVerified: true, // Google already verified this email
    });
  } else if (!user.googleId) {
    // Existing local account signing in with Google for the first time - link it
    user.googleId = uid;
    user.avatar = user.avatar || picture || null;
    user.isEmailVerified = true;
    await user.save();
  }

  return user;
};

// --- Change password (authenticated, requires current password) ---
const changePassword = async ({ userId, currentPassword, newPassword }) => {
  const user = await User.findById(userId).select("+password");
  if (!user) throw new ApiError(404, "User not found");

  if (user.authProvider !== "local") {
    throw new ApiError(
      400,
      `This account signs in with ${user.authProvider}. There's no password to change — use "Add a password" instead if you want one.`
    );
  }

  const isMatch = await bcrypt.compare(currentPassword, user.password || "");
  if (!isMatch) throw new ApiError(401, "Current password is incorrect");

  user.password = await bcrypt.hash(newPassword, 10);
  user.refreshTokenHash = null; // force re-login everywhere else after a password change
  await user.save();
  return user;
};

// --- Add a password to a Google-only account (so they can also log in with email+password) ---
const addPassword = async ({ userId, newPassword }) => {
  const user = await User.findById(userId).select("+password");
  if (!user) throw new ApiError(404, "User not found");

  if (user.password) {
    throw new ApiError(400, "This account already has a password. Use changePassword instead.");
  }

  user.password = await bcrypt.hash(newPassword, 10);
  user.authProvider = "local"; // can now log in either way; googleId is preserved
  await user.save();
  return user;
};

// --- Permanently delete an account and every resource it owns ---
const deleteAccount = async (userId) => {
  const Bot = require("../models/Bot");
  const Document = require("../models/Document");
  const Chunk = require("../models/Chunk");
  const Conversation = require("../models/Conversation");
  const Subscription = require("../models/Subscription");

  const bots = await Bot.find({ user: userId }).select("_id");
  const botIds = bots.map((b) => b._id);

  await Promise.all([
    Chunk.deleteMany({ bot: { $in: botIds } }),
    Document.deleteMany({ bot: { $in: botIds } }),
    Conversation.deleteMany({ bot: { $in: botIds } }),
    Bot.deleteMany({ user: userId }),
    Subscription.deleteMany({ user: userId }),
  ]);

  await User.findByIdAndDelete(userId);
};
const issueTokens = async (user) => {
  const accessToken = generateAccessToken(user._id.toString());
  const refreshToken = generateRefreshToken(user._id.toString());

  user.refreshTokenHash = hashToken(refreshToken);
  await user.save();

  return { accessToken, refreshToken };
};

module.exports = {
  signup,
  sendVerificationOtp,
  sendPasswordResetOtp,
  verifyOtp,
  resetPassword,
  login,
  googleLogin,
  issueTokens,
  changePassword,
  addPassword,
  deleteAccount,
};
