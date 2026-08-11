const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const Conversation = require("../models/Conversation");
const leadService = require("../services/lead.service");
const emailService = require("../services/email.service");
const logger = require("../utils/logger");

// POST /api/v1/lead/submit  (auth: bot public key)
// Called by the widget after the visitor fills the pre-chat form.
// Creates or updates the conversation's visitor identity.
// body: { sessionId, name?, email?, phone? }
const submitLead = asyncHandler(async (req, res) => {
  const bot = req.bot;
  const { sessionId, name, email, phone } = req.body;

  if (!sessionId) throw new ApiError(400, "sessionId is required");

  // Upsert the conversation with visitor info
  await Conversation.findOneAndUpdate(
    { bot: bot._id, sessionId },
    {
      $set: {
        "visitor.name":  name  || null,
        "visitor.email": email || null,
        "visitor.phone": phone || null,
      },
      $setOnInsert: { type: "widget", messages: [] },
    },
    { upsert: true, new: true }
  );

  res.status(200).json({ success: true, message: "Visitor info saved" });
});

// POST /api/v1/lead/send-otp  (auth: bot public key)
// Sends a verification OTP to the visitor's email or phone.
// body: { sessionId, type: "email" | "phone", target: "email@..." | "+91..." }
const sendLeadOtp = asyncHandler(async (req, res) => {
  const bot = req.bot;
  const { sessionId, type, target } = req.body;

  if (!sessionId) throw new ApiError(400, "sessionId is required");
  if (!["email", "phone"].includes(type)) throw new ApiError(400, "type must be 'email' or 'phone'");
  if (!target) throw new ApiError(400, "target is required");

  const otp = leadService.createLeadOtp(bot._id.toString(), sessionId, type, target);

  if (type === "email") {
    await emailService.sendLeadVerificationEmail(target, otp, bot.name);
  } else {
    // SMS — log for now; wire Twilio/MSG91 here when ready
    logger.info(`[SMS OTP] To: ${target} | OTP: ${otp} | Bot: ${bot.name}`);
    // TODO: await smsService.send(target, `Your ${bot.name} verification code: ${otp}`);
  }

  res.status(200).json({
    success: true,
    message: type === "email"
      ? "Verification code sent to your email"
      : "Verification code sent via SMS",
  });
});

// POST /api/v1/lead/verify-otp  (auth: bot public key)
// Verifies the OTP and marks the field as verified on the conversation.
// body: { sessionId, type: "email" | "phone", otp: "123456" }
const verifyLeadOtp = asyncHandler(async (req, res) => {
  const bot = req.bot;
  const { sessionId, type, otp } = req.body;

  if (!sessionId) throw new ApiError(400, "sessionId is required");
  if (!["email", "phone"].includes(type)) throw new ApiError(400, "type must be 'email' or 'phone'");
  if (!otp) throw new ApiError(400, "otp is required");

  // Throws if invalid/expired
  leadService.verifyLeadOtp(bot._id.toString(), sessionId, type, otp);

  const updateField = type === "email"
    ? { "visitor.emailVerified": true }
    : { "visitor.phoneVerified": true };

  await Conversation.findOneAndUpdate(
    { bot: bot._id, sessionId },
    { $set: updateField }
  );

  res.status(200).json({ success: true, message: `${type} verified` });
});

module.exports = { submitLead, sendLeadOtp, verifyLeadOtp };