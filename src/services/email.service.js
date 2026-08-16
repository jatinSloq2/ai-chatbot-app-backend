const transporter = require("../config/mailer");
const logger = require("../utils/logger");
const credentialEmailSender = require("./credentialEmailSender.service");
const { resolveAdminEmailCredential } = require("./platformEmailSender.service");

const sendEmail = async ({ to, subject, html }) => {
  const cred = await resolveAdminEmailCredential().catch(() => null);

  if (cred) {
    try {
      await credentialEmailSender.sendEmail(cred, { to, subject, html });
      return;
    } catch (err) {
      logger.error(`[Platform email] Send failed via admin credential ${cred._id}, falling back to SMTP: ${err.message}`);
      await cred.markFailed(err.message).catch(() => {});
      // fall through to the SMTP transporter below rather than losing the email
    }
  }

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
  });
};

const sendOtpEmail = async (to, otp, purpose) => {
  const heading =
    purpose === "reset_password" ? "Reset your password" : "Verify your email";
  const message =
    purpose === "reset_password"
      ? "Use the code below to reset your password."
      : "Use the code below to verify your email address.";

  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
      <h2>${heading}</h2>
      <p>${message}</p>
      <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 24px 0;">
        ${otp}
      </div>
      <p>This code expires in ${process.env.OTP_EXPIRES_MINUTES || 10} minutes.</p>
      <p>If you didn't request this, you can safely ignore this email.</p>
    </div>
  `;

  await sendEmail({ to, subject: heading, html });
};

const sendLeadVerificationEmail = async (to, otp, botName) => {
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
      <h2>Verify your email</h2>
      <p>Use the code below to verify your email for <strong>${botName}</strong>'s chat.</p>
      <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 24px 0;">
        ${otp}
      </div>
      <p>This code expires in ${process.env.OTP_EXPIRES_MINUTES || 10} minutes.</p>
      <p>If you didn't request this, you can safely ignore this email.</p>
    </div>
  `;
  await sendEmail({ to, subject: `Your ${botName} verification code`, html });
};

const sendPaymentSuccessEmail = async (to, { planName, amountDisplay, endDate }) => {
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
      <h2>Payment successful</h2>
      <p>Your subscription to the <strong>${planName}</strong> plan is now active.</p>
      <p>Amount charged: <strong>${amountDisplay}</strong></p>
      <p>Your plan renews on: <strong>${new Date(endDate).toDateString()}</strong></p>
      <p>Thanks for subscribing!</p>
    </div>
  `;
  await sendEmail({ to, subject: "Payment successful - subscription activated", html });
};

const sendPaymentFailedEmail = async (to, { planName }) => {
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
      <h2>Payment failed</h2>
      <p>We couldn't process your payment for the <strong>${planName}</strong> plan.</p>
      <p>Please try again from your billing dashboard. If the issue persists, check with your bank or card provider.</p>
    </div>
  `;
  await sendEmail({ to, subject: "Payment failed", html });
};

const sendSubscriptionExpiringEmail = async (to, { planName, endDate }) => {
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
      <h2>Your plan is expiring soon</h2>
      <p>Your <strong>${planName}</strong> subscription ends on <strong>${new Date(endDate).toDateString()}</strong>.</p>
      <p>Renew before then to avoid being downgraded to the Free plan.</p>
    </div>
  `;
  await sendEmail({ to, subject: "Your subscription is expiring soon", html });
};

const sendSubscriptionExpiredEmail = async (to, { planName }) => {
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
      <h2>Your subscription has ended</h2>
      <p>Your <strong>${planName}</strong> subscription has expired and your account has been moved to the Free plan.</p>
      <p>You can resubscribe anytime from your billing dashboard.</p>
    </div>
  `;
  await sendEmail({ to, subject: "Your subscription has expired", html });
};

const sendAccountDeletedEmail = async (to) => {
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
      <h2>Your account has been deleted</h2>
      <p>Your account, all your bots, and all their data have been permanently deleted, as requested.</p>
      <p>If this wasn't you, please contact support immediately.</p>
    </div>
  `;
  await sendEmail({ to, subject: "Your account has been deleted", html });
};

const sendPasswordChangedEmail = async (to) => {
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
      <h2>Your password was changed</h2>
      <p>This is a confirmation that your account password was just changed.</p>
      <p>If this wasn't you, reset your password immediately and contact support.</p>
    </div>
  `;
  await sendEmail({ to, subject: "Your password was changed", html });
};

module.exports = {
  sendEmail,
  sendOtpEmail,
  sendLeadVerificationEmail,
  sendPaymentSuccessEmail,
  sendPaymentFailedEmail,
  sendSubscriptionExpiringEmail,
  sendSubscriptionExpiredEmail,
  sendAccountDeletedEmail,
  sendPasswordChangedEmail,
};