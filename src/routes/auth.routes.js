const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const authController = require("../controllers/auth.controller");
const { protect } = require("../middlewares/auth.middleware");
const { avatarUpload } = require("../middlewares/upload.middleware");
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

/**
 * @openapi
 * tags:
 *   - name: Auth
 *     description: Signup, login, OTP, password reset, account management
 */

/**
 * @openapi
 * components:
 *   schemas:
 *     SignupRequest:
 *       type: object
 *       required: [email, password, name]
 *       properties:
 *         email: { type: string, format: email, example: jane@example.com }
 *         password: { type: string, format: password, minLength: 8, example: supersecret123 }
 *         name: { type: string, example: "Jane Doe" }
 *     LoginRequest:
 *       type: object
 *       required: [email, password]
 *       properties:
 *         email: { type: string, format: email, example: jane@example.com }
 *         password: { type: string, format: password, example: supersecret123 }
 *     VerifyOtpRequest:
 *       type: object
 *       required: [email, otp]
 *       properties:
 *         email: { type: string, format: email, example: jane@example.com }
 *         otp: { type: string, example: "482910" }
 *     ForgotPasswordRequest:
 *       type: object
 *       required: [email]
 *       properties:
 *         email: { type: string, format: email, example: jane@example.com }
 *     ResetPasswordRequest:
 *       type: object
 *       required: [email, otp, newPassword]
 *       properties:
 *         email: { type: string, format: email, example: jane@example.com }
 *         otp: { type: string, example: "482910" }
 *         newPassword: { type: string, format: password, minLength: 8, example: newsecret123 }
 *     GoogleLoginRequest:
 *       type: object
 *       required: [idToken]
 *       properties:
 *         idToken: { type: string, description: "Firebase ID token from the client SDK" }
 *     AuthSuccess:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: true }
 *         message: { type: string, example: "Logged in" }
 *         data:
 *           type: object
 *           properties:
 *             user: { $ref: "#/components/schemas/User" }
 *             accessToken: { type: string, description: "JWT — also set as httpOnly cookie", example: eyJhbGciOi... }
 *             refreshToken: { type: string, description: "JWT — also set as httpOnly cookie", example: eyJhbGciOi... }
 */

/**
 * @openapi
 * /api/auth/signup:
 *   post:
 *     tags: [Auth]
 *     summary: Register a new account
 *     description: Creates an unverified user and emails a 6-digit OTP. Login is blocked until verification.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/SignupRequest" }
 *     responses:
 *       201:
 *         description: User created. OTP sent to email.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Account created. Please verify your email." }
 *       400: { $ref: "#/components/responses/ValidationError" }
 *       409:
 *         description: Email already registered
 *         content: { application/json: { schema: { $ref: "#/components/schemas/Error" } } }
 *       429: { $ref: "#/components/responses/TooManyRequests" }
 */
router.post("/signup", signupRules, authController.signup);

/**
 * @openapi
 * /api/auth/verify-email:
 *   post:
 *     tags: [Auth]
 *     summary: Verify email with the OTP
 *     description: "Marks the user isEmailVerified: true and on success issues access + refresh tokens (both as httpOnly cookies and in the JSON body)."
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/VerifyOtpRequest" }
 *     responses:
 *       200:
 *         description: Email verified
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/AuthSuccess" }
 *       400: { $ref: "#/components/responses/ValidationError" }
 *       401:
 *         description: Invalid / expired OTP
 *         content: { application/json: { schema: { $ref: "#/components/schemas/Error" } } }
 *       429: { $ref: "#/components/responses/TooManyRequests" }
 */
router.post("/verify-email", strictLimiter, verifyOtpRules, authController.verifyEmail);

/**
 * @openapi
 * /api/auth/resend-otp:
 *   post:
 *     tags: [Auth]
 *     summary: Resend verification OTP
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email, example: jane@example.com }
 *     responses:
 *       200: { description: OTP resent (or generic success to prevent user enumeration) }
 *       429: { $ref: "#/components/responses/TooManyRequests" }
 */
router.post("/resend-otp", strictLimiter, emailOnlyRules, authController.resendOtp);

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Log in with email and password
 *     description: Sets `accessToken` (15 min) and `refreshToken` (30 days) as httpOnly cookies, and also returns `accessToken` in the JSON body for mobile / Postman.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/LoginRequest" }
 *     responses:
 *       200:
 *         description: Logged in
 *         headers:
 *           Set-Cookie:
 *             description: accessToken + refreshToken cookies
 *             schema: { type: string }
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/AuthSuccess" }
 *       400: { $ref: "#/components/responses/ValidationError" }
 *       401: { description: Wrong credentials or email not verified }
 *       429: { $ref: "#/components/responses/TooManyRequests" }
 */
router.post("/login", strictLimiter, loginRules, authController.login);

/**
 * @openapi
 * /api/auth/google:
 *   post:
 *     tags: [Auth]
 *     summary: Log in or sign up via Google (Firebase ID token)
 *     description: "Verifies the Firebase ID token with the Admin SDK, then finds or creates a user. Google-authenticated users are auto-marked isEmailVerified: true."
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/GoogleLoginRequest" }
 *     responses:
 *       200:
 *         description: Authenticated
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/AuthSuccess" }
 *       401: { description: Invalid Firebase token }
 */
router.post("/google", googleLoginRules, authController.googleLogin);

/**
 * @openapi
 * /api/auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Request a password-reset OTP
 *     description: Always returns the same generic success message to prevent user enumeration, even if the email is not registered.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/ForgotPasswordRequest" }
 *     responses:
 *       200: { description: Generic success }
 *       429: { $ref: "#/components/responses/TooManyRequests" }
 */
router.post(
  "/forgot-password",
  strictLimiter,
  emailOnlyRules,
  authController.forgotPassword
);

/**
 * @openapi
 * /api/auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Reset password using OTP
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/ResetPasswordRequest" }
 *     responses:
 *       200: { description: Password updated }
 *       401: { description: Invalid / expired OTP }
 *       429: { $ref: "#/components/responses/TooManyRequests" }
 */
router.post(
  "/reset-password",
  strictLimiter,
  resetPasswordRules,
  authController.resetPassword
);

/**
 * @openapi
 * /api/auth/refresh-token:
 *   post:
 *     tags: [Auth]
 *     summary: Issue a new access token using the refresh cookie
 *     security: []
 *     responses:
 *       200:
 *         description: New access token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     accessToken: { type: string }
 *       401: { description: Refresh token missing / revoked / expired }
 */
router.post("/refresh-token", authController.refreshToken);

/**
 * @openapi
 * /api/auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Log out and invalidate the stored refresh-token hash
 *     responses:
 *       200: { description: Logged out }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.post("/logout", protect, authController.logout);

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get the current logged-in user
 *     responses:
 *       200:
 *         description: Current user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     user: { $ref: "#/components/schemas/User" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *   patch:
 *     tags: [Auth]
 *     summary: Update the current user's profile (name)
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, example: "Jane Smith" }
 *     responses:
 *       200: { description: Updated }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.get("/me", protect, authController.getMe);
router.patch("/me", protect, authController.updateMe);

/**
 * @openapi
 * /api/auth/me/avatar:
 *   post:
 *     tags: [Auth]
 *     summary: Upload / replace the current user's avatar
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       200: { description: Avatar uploaded }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.post("/me/avatar", protect, avatarUpload.single("file"), authController.uploadMyAvatar);

/**
 * @openapi
 * /api/auth/me/export:
 *   get:
 *     tags: [Auth]
 *     summary: Export all data the user owns (GDPR)
 *     responses:
 *       200: { description: JSON download of user data }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.get("/me/export", protect, authController.exportMyData);

/**
 * @openapi
 * /api/auth/change-password:
 *   post:
 *     tags: [Auth]
 *     summary: Change password (requires current password)
 *     description: Hashes + saves the new password, invalidates the stored refresh-token hash (other sessions log out on next refresh), clears cookies on this request to force a fresh login, and sends a confirmation email.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string, format: password }
 *               newPassword: { type: string, format: password, minLength: 8 }
 *     responses:
 *       200: { description: Password updated }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       429: { $ref: "#/components/responses/TooManyRequests" }
 */
router.post("/change-password", protect, strictLimiter, authController.changePassword);

/**
 * @openapi
 * /api/auth/add-password:
 *   post:
 *     tags: [Auth]
 *     summary: Add a password to a Google-only account
 *     description: Fails if a password is already set on the account.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [newPassword]
 *             properties:
 *               newPassword: { type: string, format: password, minLength: 8 }
 *     responses:
 *       200: { description: Password added }
 *       409: { description: Account already has a password }
 */
router.post("/add-password", protect, strictLimiter, authController.addPassword);

/**
 * @openapi
 * /api/auth/account:
 *   delete:
 *     tags: [Auth]
 *     summary: Permanently delete account and cascade-delete every owned resource
 *     description: "Hard-cascades through bots, documents, chunks, conversations, subscriptions. Requires the literal body { \"confirm\": \"DELETE\" } as a guard."
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [confirm]
 *             properties:
 *               confirm: { type: string, enum: [DELETE], example: DELETE }
 *     responses:
 *       200: { description: Account deleted }
 *       400: { description: Missing confirmation }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.delete("/account", protect, strictLimiter, authController.deleteAccount);

module.exports = router;
