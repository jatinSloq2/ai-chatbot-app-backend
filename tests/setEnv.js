// Runs before each test file - fake-but-valid env vars so config modules
// (crypto, jwt, etc.) don't throw during import.
process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test_access_secret";
process.env.JWT_REFRESH_SECRET = "test_refresh_secret";
process.env.JWT_ACCESS_EXPIRES = "15m";
process.env.JWT_REFRESH_EXPIRES = "30d";
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.OTP_EXPIRES_MINUTES = "10";
process.env.RAZORPAY_KEY_ID = "rzp_test_fake";
process.env.RAZORPAY_KEY_SECRET = "fake_secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "fake_webhook_secret";
process.env.FIREBASE_PROJECT_ID = "test-project";
process.env.FIREBASE_CLIENT_EMAIL = "test@test-project.iam.gserviceaccount.com";
process.env.FIREBASE_PRIVATE_KEY = "invalid-but-present"; // Firebase init failure is handled gracefully
process.env.SMTP_HOST = "localhost";
process.env.SMTP_PORT = "587";
process.env.SMTP_USER = "test";
process.env.SMTP_PASS = "test";
process.env.EMAIL_FROM = "test@example.com";
