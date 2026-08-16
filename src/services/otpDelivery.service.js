const logger = require("../utils/logger");
const emailService = require("./email.service");
const credentialEmailSender = require("./credentialEmailSender.service");
const smsSender = require("./smsSender.service");
const { getDefaultCredential } = require("./integrationCredential.service");

const DEFAULT_TEMPLATE = "Hi {name}, your {botName} verification code is {otp}. It expires in 10 minutes.";

// Fills {name} / {otp} / {botName} placeholders in the admin-configured
// message. Missing values fall back to sensible defaults so a half-filled
// visitor form (no name yet) never leaves a literal "{name}" in the message.
const renderTemplate = (template, { name, otp, botName }) => {
    const t = template && template.trim() ? template : DEFAULT_TEMPLATE;
    return t
        .replace(/\{\s*name\s*\}/gi, name && name.trim() ? name.trim() : "there")
        .replace(/\{\s*otp\s*\}/gi, otp)
        .replace(/\{\s*botName\s*\}/gi, botName || "our chat");
};

const htmlWrap = (message) => `
  <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
    <p style="font-size: 15px; line-height: 1.5;">${message}</p>
  </div>
`;

// Sends the OTP by email — uses the bot owner's saved+default Email
// credential (whatever method it's configured with: SMTP, OAuth mailbox, or
// a transactional API) so delivery works the same regardless of provider.
// Falls back to the platform mailer if the owner hasn't connected one yet,
// so bots keep working out of the box.
const sendOtpEmail = async ({ userId, to, otp, name, botName, template }) => {
    const message = renderTemplate(template, { name, otp, botName });
    const subject = `Your ${botName || "verification"} code`;

    const cred = await getDefaultCredential(userId, "email");
    if (!cred) {
        await emailService.sendLeadVerificationEmail(to, otp, botName);
        return;
    }

    try {
        await credentialEmailSender.sendEmail(cred, { to, subject, html: htmlWrap(message), text: message });
    } catch (err) {
        logger.error(`[Lead OTP] Email send failed via credential ${cred._id}: ${err.message}`);
        await cred.markFailed(err.message).catch(() => { });
        // Still give the visitor a code rather than a dead end.
        await emailService.sendLeadVerificationEmail(to, otp, botName);
    }
};

// Sends the OTP by SMS — uses the bot owner's saved+default SMS credential.
// Unlike email there's no platform fallback (JestBot doesn't operate its
// own SMS gateway), so if nothing is configured yet this just logs, same as
// before credentials were wired up.
const sendOtpSms = async ({ userId, to, otp, name, botName, template }) => {
    const message = renderTemplate(template, { name, otp, botName });

    const cred = await getDefaultCredential(userId, "sms");
    if (!cred) {
        logger.info(`[SMS OTP] No SMS credential configured — To: ${to} | OTP: ${otp} | Bot: ${botName}`);
        return;
    }

    try {
        await smsSender.sendSms(cred, { to, message });
    } catch (err) {
        logger.error(`[Lead OTP] SMS send failed via credential ${cred._id}: ${err.message}`);
        await cred.markFailed(err.message).catch(() => { });
        throw err;
    }
};

module.exports = { renderTemplate, sendOtpEmail, sendOtpSms };