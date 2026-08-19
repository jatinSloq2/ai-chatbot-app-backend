const transporter = require("../config/mailer");
const logger = require("../utils/logger");
const credentialEmailSender = require("./credentialEmailSender.service");
const { resolveAdminEmailCredential } = require("./platformEmailSender.service");

// Matches src/app/globals.css light-mode tokens in the frontend, so
// transactional emails look like they came from the same product as the
// dashboard rather than a generic default template.
const BRAND = {
  name: "JestBot",
  logoUrl: "https://jestbot-ai.onrender.com/assets/android-chrome-192x192.png",
  siteUrl: "https://jestbot.in",
  supportEmail: "jestbotai@gmail.com",
  background: "#FBF9F6",
  surface: "#FFFFFF",
  surfaceMuted: "#F5EFE7",
  foreground: "#201A12",
  muted: "#8A7D6B",
  border: "#ECE2D3",
  primary: "#FF6A1A",
  primaryForeground: "#FFFFFF",
};

/**
 * Wraps a block of body HTML in the shared JestBot email shell — logo header,
 * card body, and a footer with support contact + legal links. Every
 * sendXEmail() below builds only its `bodyHtml` and passes it through here,
 * so every transactional email shares one consistent look.
 */
const renderEmail = ({ preheader = "", bodyHtml }) => `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${BRAND.name}</title>
    </head>
    <body style="margin:0; padding:0; background-color:${BRAND.background}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <span style="display:none; font-size:1px; color:${BRAND.background}; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">
        ${preheader}
      </span>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.background}; padding: 32px 16px;">
        <tr>
          <td align="center">
            <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px; width:100%;">

              <!-- Header / logo -->
              <tr>
                <td align="center" style="padding-bottom: 24px;">
                  <img
                    src="${BRAND.logoUrl}"
                    alt="${BRAND.name}"
                    width="48"
                    height="48"
                    style="display:block; border-radius:10px;"
                  />
                  <div style="margin-top:10px; font-size:18px; font-weight:700; letter-spacing:-0.02em; color:${BRAND.foreground};">
                    ${BRAND.name}
                  </div>
                </td>
              </tr>

              <!-- Card -->
              <tr>
                <td style="background-color:${BRAND.surface}; border:1px solid ${BRAND.border}; border-radius:16px; padding:32px;">
                  ${bodyHtml}
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td align="center" style="padding-top: 24px;">
                  <p style="margin:0; font-size:12px; line-height:18px; color:${BRAND.muted};">
                    Sent by ${BRAND.name} &middot;
                    <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.muted}; text-decoration:underline;">${BRAND.supportEmail}</a>
                  </p>
                  <p style="margin:6px 0 0; font-size:12px; line-height:18px; color:${BRAND.muted};">
                    <a href="${BRAND.siteUrl}/privacy" style="color:${BRAND.muted}; text-decoration:underline;">Privacy</a>
                    &nbsp;&middot;&nbsp;
                    <a href="${BRAND.siteUrl}/terms" style="color:${BRAND.muted}; text-decoration:underline;">Terms</a>
                    &nbsp;&middot;&nbsp;
                    <a href="${BRAND.siteUrl}" style="color:${BRAND.muted}; text-decoration:underline;">${BRAND.siteUrl.replace("https://", "")}</a>
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>
`;

const heading = (text) => `
  <h2 style="margin:0 0 12px; font-size:20px; line-height:28px; font-weight:700; letter-spacing:-0.01em; color:${BRAND.foreground};">
    ${text}
  </h2>
`;

const paragraph = (text) => `
  <p style="margin:0 0 12px; font-size:14px; line-height:22px; color:${BRAND.muted};">
    ${text}
  </p>
`;

const otpBlock = (otp) => `
  <div style="margin:20px 0; padding:16px; background-color:${BRAND.surfaceMuted}; border:1px solid ${BRAND.border}; border-radius:12px; text-align:center;">
    <span style="font-size:30px; font-weight:700; letter-spacing:8px; color:${BRAND.primary};">
      ${otp}
    </span>
  </div>
`;

const button = (label, href) => `
  <div style="margin: 20px 0;">
    <a
      href="${href}"
      style="display:inline-block; background-color:${BRAND.primary}; color:${BRAND.primaryForeground}; font-size:14px; font-weight:600; text-decoration:none; padding:12px 20px; border-radius:10px;"
    >
      ${label}
    </a>
  </div>
`;

const sendEmail = async ({ to, subject, html }) => {
  const cred = await resolveAdminEmailCredential().catch(() => null);

  if (cred) {
    try {
      await credentialEmailSender.sendEmail(cred, { to, subject, html });
      return;
    } catch (err) {
      logger.error(`[Platform email] Send failed via admin credential ${cred._id}, falling back to SMTP: ${err.message}`);
      await cred.markFailed(err.message).catch(() => { });
      // fall through to the SMTP transporter below rather than losing the email
    }
  }

  await transporter.sendMail({
    from: `"${BRAND.name}" <${process.env.EMAIL_FROM}>`,
    to,
    subject,
    html,
  });
};

const sendOtpEmail = async (to, otp, purpose) => {
  const isReset = purpose === "reset_password";
  const heading_ = isReset ? "Reset your password" : "Verify your email";
  const message = isReset
    ? "Use the code below to reset your password."
    : "Use the code below to verify your email address.";

  const bodyHtml = `
    ${heading(heading_)}
    ${paragraph(message)}
    ${otpBlock(otp)}
    ${paragraph(`This code expires in ${process.env.OTP_EXPIRES_MINUTES || 10} minutes.`)}
    ${paragraph("If you didn't request this, you can safely ignore this email.")}
  `;

  await sendEmail({
    to,
    subject: heading_,
    html: renderEmail({ preheader: `Your ${BRAND.name} verification code: ${otp}`, bodyHtml }),
  });
};

const sendLeadVerificationEmail = async (to, otp, botName) => {
  const bodyHtml = `
    ${heading("Verify your email")}
    ${paragraph(`Use the code below to verify your email for <strong style="color:${BRAND.foreground};">${botName}</strong>'s chat.`)}
    ${otpBlock(otp)}
    ${paragraph(`This code expires in ${process.env.OTP_EXPIRES_MINUTES || 10} minutes.`)}
    ${paragraph("If you didn't request this, you can safely ignore this email.")}
  `;

  await sendEmail({
    to,
    subject: `Your ${botName} verification code`,
    html: renderEmail({ preheader: `Your verification code: ${otp}`, bodyHtml }),
  });
};

const sendPaymentSuccessEmail = async (to, { planName, amountDisplay, endDate }) => {
  const bodyHtml = `
    ${heading("Payment successful")}
    ${paragraph(`Your subscription to the <strong style="color:${BRAND.foreground};">${planName}</strong> plan is now active.`)}
    ${paragraph(`Amount charged: <strong style="color:${BRAND.foreground};">${amountDisplay}</strong>`)}
    ${paragraph(`Your plan renews on: <strong style="color:${BRAND.foreground};">${new Date(endDate).toDateString()}</strong>`)}
    ${button("View billing", `${BRAND.siteUrl}/settings`)}
    ${paragraph("Thanks for subscribing!")}
  `;

  await sendEmail({
    to,
    subject: "Payment successful - subscription activated",
    html: renderEmail({ preheader: `Your ${planName} plan is now active.`, bodyHtml }),
  });
};

const sendPaymentFailedEmail = async (to, { planName }) => {
  const bodyHtml = `
    ${heading("Payment failed")}
    ${paragraph(`We couldn't process your payment for the <strong style="color:${BRAND.foreground};">${planName}</strong> plan.`)}
    ${paragraph("Please try again from your billing dashboard. If the issue persists, check with your bank or card provider.")}
    ${button("Retry payment", `${BRAND.siteUrl}/settings`)}
  `;

  await sendEmail({
    to,
    subject: "Payment failed",
    html: renderEmail({ preheader: `We couldn't process your payment for the ${planName} plan.`, bodyHtml }),
  });
};

const sendSubscriptionExpiringEmail = async (to, { planName, endDate }) => {
  const bodyHtml = `
    ${heading("Your plan is expiring soon")}
    ${paragraph(`Your <strong style="color:${BRAND.foreground};">${planName}</strong> subscription ends on <strong style="color:${BRAND.foreground};">${new Date(endDate).toDateString()}</strong>.`)}
    ${paragraph("Renew before then to avoid being downgraded to the Free plan.")}
    ${button("Renew now", `${BRAND.siteUrl}/settings`)}
  `;

  await sendEmail({
    to,
    subject: "Your subscription is expiring soon",
    html: renderEmail({ preheader: `Your ${planName} subscription ends soon.`, bodyHtml }),
  });
};

const sendSubscriptionExpiredEmail = async (to, { planName }) => {
  const bodyHtml = `
    ${heading("Your subscription has ended")}
    ${paragraph(`Your <strong style="color:${BRAND.foreground};">${planName}</strong> subscription has expired and your account has been moved to the Free plan.`)}
    ${paragraph("You can resubscribe anytime from your billing dashboard.")}
    ${button("Resubscribe", `${BRAND.siteUrl}/settings`)}
  `;

  await sendEmail({
    to,
    subject: "Your subscription has expired",
    html: renderEmail({ preheader: `Your ${planName} subscription has expired.`, bodyHtml }),
  });
};

const sendAccountDeletedEmail = async (to) => {
  const bodyHtml = `
    ${heading("Your account has been deleted")}
    ${paragraph("Your account, all your bots, and all their data have been permanently deleted, as requested.")}
    ${paragraph(`If this wasn't you, please contact support immediately at <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.primary};">${BRAND.supportEmail}</a>.`)}
  `;

  await sendEmail({
    to,
    subject: "Your account has been deleted",
    html: renderEmail({ preheader: "Your account and all associated data have been deleted.", bodyHtml }),
  });
};

const sendPasswordChangedEmail = async (to) => {
  const bodyHtml = `
    ${heading("Your password was changed")}
    ${paragraph("This is a confirmation that your account password was just changed.")}
    ${paragraph(`If this wasn't you, reset your password immediately and contact support at <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.primary};">${BRAND.supportEmail}</a>.`)}
  `;

  await sendEmail({
    to,
    subject: "Your password was changed",
    html: renderEmail({ preheader: "Your account password was just changed.", bodyHtml }),
  });
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