const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const authController = require("../controllers/auth.controller");
const { protect } = require("../middlewares/auth.middleware");
const {
  signupRules,
  loginRules,
  emailOnlyRules,
  verifyOtpRules,
  resetPasswordRules,
  googleLoginRules,
} = require("../middlewares/validate.middleware");

// Stricter limiter for sensitive/abuse-prone endpoints (OTP, login, forgot password)
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: {
    success: false,
    message: "Too many attempts. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/signup", signupRules, authController.signup);
router.post("/verify-email", strictLimiter, verifyOtpRules, authController.verifyEmail);
router.post("/resend-otp", strictLimiter, emailOnlyRules, authController.resendOtp);

router.post("/login", strictLimiter, loginRules, authController.login);
router.post("/google", googleLoginRules, authController.googleLogin);

router.post(
  "/forgot-password",
  strictLimiter,
  emailOnlyRules,
  authController.forgotPassword
);
router.post(
  "/reset-password",
  strictLimiter,
  resetPasswordRules,
  authController.resetPassword
);

router.post("/refresh-token", authController.refreshToken);
router.post("/logout", protect, authController.logout);
router.get("/me", protect, authController.getMe);
router.post("/change-password", protect, strictLimiter, authController.changePassword);
router.post("/add-password", protect, strictLimiter, authController.addPassword);
router.delete("/account", protect, strictLimiter, authController.deleteAccount);

module.exports = router;
