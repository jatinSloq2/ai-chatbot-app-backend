const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const authService = require("../services/auth.service");
const User = require("../models/User");
const emailService = require("../services/email.service");
const {
  verifyRefreshToken,
  generateAccessToken,
  hashToken,
} = require("../utils/token");

const isProd = process.env.NODE_ENV === "production";

const cookieOptions = {
  httpOnly: true,
  secure: process.env.COOKIE_SECURE === "true" || isProd,
  sameSite: isProd ? "none" : "lax",
};

const sanitizeUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  avatar: user.avatar,
  authProvider: user.authProvider,
  isEmailVerified: user.isEmailVerified,
  role: user.role,
  referralCode: user.referralCode,
  createdAt: user.createdAt,
});

const setAuthCookies = (res, accessToken, refreshToken) => {
  res.cookie("accessToken", accessToken, {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000, // 15 min
  });
  res.cookie("refreshToken", refreshToken, {
    ...cookieOptions,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
};

// POST /api/auth/signup
const signup = asyncHandler(async (req, res) => {
  const { name, email, password, referralCode } = req.body;
  const user = await authService.signup({ name, email, password, referralCode });

  res.status(201).json({
    success: true,
    message: "Signup successful. A verification code has been sent to your email.",
    data: { email: user.email },
  });
});

// POST /api/auth/verify-email
const verifyEmail = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const user = await authService.verifyOtp({ email, otp, purpose: "verify_email" });

  const { accessToken, refreshToken } = await authService.issueTokens(user);
  setAuthCookies(res, accessToken, refreshToken);

  res.status(200).json({
    success: true,
    message: "Email verified successfully",
    data: { user: sanitizeUser(user), accessToken },
  });
});

// POST /api/auth/resend-otp
const resendOtp = asyncHandler(async (req, res) => {
  const { email } = req.body;
  await authService.sendVerificationOtp(email);

  res.status(200).json({
    success: true,
    message: "A new verification code has been sent to your email",
  });
});

// POST /api/auth/login
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await authService.login({ email, password });

  const { accessToken, refreshToken } = await authService.issueTokens(user);
  setAuthCookies(res, accessToken, refreshToken);

  res.status(200).json({
    success: true,
    message: "Login successful",
    data: { user: sanitizeUser(user), accessToken },
  });
});

// POST /api/auth/google
const googleLogin = asyncHandler(async (req, res) => {
  const { idToken } = req.body;
  const user = await authService.googleLogin(idToken);

  const { accessToken, refreshToken } = await authService.issueTokens(user);
  setAuthCookies(res, accessToken, refreshToken);

  res.status(200).json({
    success: true,
    message: "Google login successful",
    data: { user: sanitizeUser(user), accessToken },
  });
});

// POST /api/auth/forgot-password
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  await authService.sendPasswordResetOtp(email);

  // Same response whether or not the email exists, to prevent user enumeration
  res.status(200).json({
    success: true,
    message: "If an account exists with this email, a reset code has been sent",
  });
});

// POST /api/auth/reset-password
const resetPassword = asyncHandler(async (req, res) => {
  const { email, otp, newPassword } = req.body;
  await authService.resetPassword({ email, otp, newPassword });

  res.status(200).json({
    success: true,
    message: "Password reset successful. Please log in with your new password.",
  });
});

// POST /api/auth/refresh-token
const refreshToken = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken || req.body?.refreshToken;
  if (!token) throw new ApiError(401, "Refresh token missing");

  let decoded;
  try {
    decoded = verifyRefreshToken(token);
  } catch (err) {
    throw new ApiError(401, "Invalid or expired refresh token");
  }

  const user = await User.findById(decoded.userId).select("+refreshTokenHash");
  if (!user || user.refreshTokenHash !== hashToken(token)) {
    throw new ApiError(401, "Refresh token no longer valid. Please log in again");
  }

  const newAccessToken = generateAccessToken(user._id.toString());
  res.cookie("accessToken", newAccessToken, {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000,
  });

  res.status(200).json({
    success: true,
    data: { accessToken: newAccessToken },
  });
});

// POST /api/auth/logout
const logout = asyncHandler(async (req, res) => {
  if (req.user) {
    await User.findByIdAndUpdate(req.user._id, { refreshTokenHash: null });
  }
  res.clearCookie("accessToken", cookieOptions);
  res.clearCookie("refreshToken", cookieOptions);

  res.status(200).json({ success: true, message: "Logged out successfully" });
});

// GET /api/auth/me
const getMe = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: { user: sanitizeUser(req.user) } });
});

// POST /api/auth/change-password
// body: { currentPassword, newPassword }
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    throw new ApiError(400, "currentPassword and newPassword are required");
  }
  if (newPassword.length < 6) {
    throw new ApiError(400, "New password must be at least 6 characters");
  }

  await authService.changePassword({ userId: req.user._id, currentPassword, newPassword });

  emailService
    .sendPasswordChangedEmail(req.user.email)
    .catch((err) => require("../utils/logger").error(`Password-changed email failed: ${err.message}`));

  // Password changed -> invalidate the current session's cookies too, force fresh login
  res.clearCookie("accessToken", cookieOptions);
  res.clearCookie("refreshToken", cookieOptions);

  res.status(200).json({
    success: true,
    message: "Password changed. Please log in again with your new password.",
  });
});

// POST /api/auth/add-password  (for Google-only accounts that want email+password login too)
// body: { newPassword }
const addPassword = asyncHandler(async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    throw new ApiError(400, "newPassword must be at least 6 characters");
  }

  await authService.addPassword({ userId: req.user._id, newPassword });

  res.status(200).json({
    success: true,
    message: "Password added. You can now log in with either Google or email/password.",
  });
});

// DELETE /api/auth/account
// body: { confirm: "DELETE" }  - simple explicit-confirmation guard against accidental calls
const deleteAccount = asyncHandler(async (req, res) => {
  const { confirm } = req.body;
  if (confirm !== "DELETE") {
    throw new ApiError(
      400,
      'This permanently deletes your account and all bots/data. Resend with { "confirm": "DELETE" } to proceed.'
    );
  }

  await authService.deleteAccount(req.user._id);

  emailService
    .sendAccountDeletedEmail(req.user.email)
    .catch((err) => require("../utils/logger").error(`Account-deleted email failed: ${err.message}`));

  res.clearCookie("accessToken", cookieOptions);
  res.clearCookie("refreshToken", cookieOptions);

  res.status(200).json({
    success: true,
    message: "Your account and all associated bots/data have been permanently deleted.",
  });
});

module.exports = {
  signup,
  verifyEmail,
  resendOtp,
  login,
  googleLogin,
  forgotPassword,
  resetPassword,
  refreshToken,
  logout,
  getMe,
  changePassword,
  addPassword,
  deleteAccount,
};
