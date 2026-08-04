const { body, validationResult } = require("express-validator");
const ApiError = require("../utils/ApiError");

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formatted = errors.array().map((e) => ({ field: e.path, message: e.msg }));
    return next(new ApiError(422, "Validation failed", formatted));
  }
  next();
};

const signupRules = [
  body("name").trim().notEmpty().withMessage("Name is required"),
  body("email").isEmail().withMessage("Valid email is required").normalizeEmail(),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters"),
  handleValidation,
];

const loginRules = [
  body("email").isEmail().withMessage("Valid email is required").normalizeEmail(),
  body("password").notEmpty().withMessage("Password is required"),
  handleValidation,
];

const emailOnlyRules = [
  body("email").isEmail().withMessage("Valid email is required").normalizeEmail(),
  handleValidation,
];

const verifyOtpRules = [
  body("email").isEmail().withMessage("Valid email is required").normalizeEmail(),
  body("otp")
    .isLength({ min: 6, max: 6 })
    .withMessage("OTP must be 6 digits")
    .isNumeric()
    .withMessage("OTP must be numeric"),
  handleValidation,
];

const resetPasswordRules = [
  body("email").isEmail().withMessage("Valid email is required").normalizeEmail(),
  body("otp")
    .isLength({ min: 6, max: 6 })
    .withMessage("OTP must be 6 digits")
    .isNumeric()
    .withMessage("OTP must be numeric"),
  body("newPassword")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters"),
  handleValidation,
];

const googleLoginRules = [
  body("idToken").notEmpty().withMessage("Firebase ID token is required"),
  handleValidation,
];

module.exports = {
  signupRules,
  loginRules,
  emailOnlyRules,
  verifyOtpRules,
  resetPasswordRules,
  googleLoginRules,
};
