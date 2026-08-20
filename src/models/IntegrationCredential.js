const mongoose = require("mongoose");
const { encrypt, decrypt } = require("../utils/crypto");

const { Schema } = mongoose;

/**
 * ---------------------------------------------------------------------------
 * One document per credential entry. A user can have multiple credentials
 * per channel (e.g. two email inboxes, one WhatsApp number, one SMS
 * provider, several AI provider keys). `channel` decides which sub-object
 * is populated. Secret fields are transparently encrypted at rest using the
 * app-wide AES-256-GCM helper (utils/crypto.js, same ENCRYPTION_KEY already
 * used for bot BYOK keys) via schema-level set/get.
 * ---------------------------------------------------------------------------
 */

const secretField = {
  type: String,
  set: (v) => (v === undefined || v === null || v === "" ? undefined : encrypt(v)),
  get: (v) => (v ? decrypt(v) : v),
};

// ---------- EMAIL ----------
const EmailCredentialSchema = new Schema(
  {
    method: { type: String, enum: ["smtp", "oauth", "api"], required: true },

    fromEmail: { type: String, trim: true, lowercase: true },
    fromName: { type: String, trim: true },

    // --- SMTP ---
    smtp: {
      host: { type: String, trim: true },
      port: { type: Number },
      username: { type: String, trim: true },
      password: secretField,
      encryption: { type: String, enum: ["tls", "ssl", "none"], default: "tls" },
    },

    // --- OAuth2 (Google / Microsoft) — token pasted/obtained via provider consent ---
    oauth: {
      provider: { type: String, enum: ["google", "microsoft"] },
      email: { type: String, trim: true, lowercase: true },
      accessToken: secretField,
      refreshToken: secretField,
      tokenExpiry: { type: Date },
      scope: { type: String },
    },

    // --- Transactional API (SES / SendGrid / Mailgun / Postmark / Resend) ---
    api: {
      provider: { type: String, enum: ["ses", "sendgrid", "mailgun", "postmark", "resend"] },
      apiKey: secretField,
      accessKeyId: secretField, // AWS SES
      secretAccessKey: secretField, // AWS SES
      region: { type: String },
      verifiedDomain: { type: String },
    },
  },
  { _id: false }
);

// ---------- WHATSAPP (Meta Cloud API) ----------
const WhatsappCredentialSchema = new Schema(
  {
    phoneNumber: { type: String, trim: true, required: true },
    phoneNumberId: { type: String, trim: true, required: true },
    wabaId: { type: String, trim: true, required: true },
    appId: { type: String, trim: true, required: true }, // was optional — now required, see note below
    appSecret: secretField, // NEW — Meta App Secret for this tenant's own Meta App, used to verify X-Hub-Signature-256 on inbound webhooks for their number(s)
    accessToken: secretField,
    webhookVerifyToken: secretField, // legacy field, see original comment — unused going forward
    businessVerificationStatus: {
      type: String,
      enum: ["pending", "verified", "rejected"],
      default: "pending",
    },
    tokenType: { type: String, enum: ["temporary", "permanent"], default: "temporary" },
    tokenExpiry: { type: Date },
  },
  { _id: false }
);

// ---------- SMS ----------
const SmsCredentialSchema = new Schema(
  {
    provider: { type: String, enum: ["twilio", "aws_sns", "vonage", "msg91"], required: true },

    accountSid: { type: String, trim: true }, // Twilio Account SID
    apiKey: secretField, // Vonage API key holder, MSG91 authkey holder (see below)
    authToken: secretField, // Twilio auth token / Vonage API secret

    accessKeyId: secretField, // AWS SNS
    secretAccessKey: secretField, // AWS SNS
    region: { type: String },

    fromNumber: { type: String, trim: true },
    senderId: { type: String, trim: true },

    dlt: {
      entityId: { type: String, trim: true },
      templateId: { type: String, trim: true },
    },
  },
  { _id: false }
);

// ---------- AI PROVIDER (LLM) ----------
const AiProviderCredentialSchema = new Schema(
  {
    provider: {
      type: String,
      enum: [
        "openai",
        "azure_openai",
        "anthropic",
        "google",
        "vertex_ai",
        "cohere",
        "mistral",
        "groq",
        "openrouter",
        "ollama",
        "other",
      ],
      required: true,
    },

    apiKey: secretField,
    baseUrl: { type: String, trim: true },

    orgId: { type: String, trim: true },
    projectId: { type: String, trim: true },

    deploymentName: { type: String, trim: true },
    apiVersion: { type: String, trim: true },

    serviceAccountJson: secretField, // Google Vertex AI
    gcpProjectId: { type: String, trim: true },
    region: { type: String, trim: true },

    defaultModel: { type: String, trim: true },

    usage: {
      totalTokensUsed: { type: Number, default: 0 },
      totalCostUsd: { type: Number, default: 0 },
      lastUsedAt: { type: Date },
    },
  },
  { _id: false }
);

// ---------- GOOGLE SHEETS (unified tools data layer — Items/Availability/
// Orders/Users/Payments/Tickets tabs, see services/googleSheets.service.js) ----------
const GoogleSheetsCredentialSchema = new Schema(
  {
    // "oauth" (recommended — same "Connect Google" flow as Gmail, pick or
    // create a sheet afterwards) or "service_account" (advanced/legacy —
    // paste a GCP service account JSON key and share the sheet with it).
    method: { type: String, enum: ["oauth", "service_account"], default: "oauth" },

    // The Sheet the bot's tools read/write. Set after connecting, once the
    // user creates a new sheet or attaches an existing one. Pasted as a
    // full URL or bare ID — normalized down to just the ID at save time.
    spreadsheetId: { type: String, trim: true },
    spreadsheetUrl: { type: String, trim: true }, // kept as originally pasted/created, for an "open sheet" link in the UI

    // --- method: "oauth" ---
    oauth: {
      email: { type: String, trim: true, lowercase: true }, // which Google account was connected
      accessToken: secretField,
      refreshToken: secretField,
      tokenExpiry: { type: Date },
    },

    // --- method: "service_account" ---
    // Google service-account JSON key (downloaded from GCP console). Must be
    // shared as an Editor on the target Sheet. Stored encrypted; the bot
    // backend exchanges it for a short-lived OAuth2 access token per request
    // (see googleSheets.service.js#getAccessToken) — never stored/reused raw.
    serviceAccountJson: secretField,
    serviceAccountEmail: { type: String, trim: true }, // parsed out of the JSON, shown in the UI as "share the sheet with this address"

    // Set true once list_items/Items/Availability/Orders/Users/Payments/
    // Tickets tabs + header rows have been created/verified on the sheet.
    tabsInitialized: { type: Boolean, default: false },
  },
  { _id: false }
);

// ---------- RAZORPAY (per-bot real payments — Payment Links + refunds) ----------
const RazorpayCredentialSchema = new Schema(
  {
    keyId: { type: String, trim: true, required: true }, // not secret — safe to echo back, needed client-side for some flows
    keySecret: secretField,
    // Optional — only needed if/when a webhook is configured on this account
    // for real-time payment confirmation (see razorpay.service.js).
    webhookSecret: secretField,
  },
  { _id: false }
);

const IntegrationCredentialSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

    channel: {
      type: String,
      enum: ["email", "whatsapp", "sms", "ai_provider", "google_sheets", "razorpay"],
      required: true,
      index: true,
    },

    label: { type: String, trim: true }, // e.g. "Support Inbox", "Main WhatsApp"

    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },

    email: EmailCredentialSchema,
    whatsapp: WhatsappCredentialSchema,
    sms: SmsCredentialSchema,
    aiProvider: AiProviderCredentialSchema,
    googleSheets: GoogleSheetsCredentialSchema,
    razorpay: RazorpayCredentialSchema,

    status: {
      type: String,
      enum: ["unverified", "connected", "failed", "expired"],
      default: "unverified",
    },
    lastCheckedAt: { type: Date },
    lastError: { type: String },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

IntegrationCredentialSchema.pre("validate", function (next) {
  const channelFieldMap = {
    email: "email",
    whatsapp: "whatsapp",
    sms: "sms",
    ai_provider: "aiProvider",
    google_sheets: "googleSheets",
    razorpay: "razorpay",
  };
  const requiredField = channelFieldMap[this.channel];
  if (!this[requiredField]) {
    return next(new Error(`Missing "${requiredField}" data for channel "${this.channel}"`));
  }
  next();
});

// Only one default credential per channel per user (enforced in service layer via
// unsetting previous defaults, kept non-unique here since isDefault is usually false).
IntegrationCredentialSchema.index({ user: 1, channel: 1, isDefault: 1 });

IntegrationCredentialSchema.methods.markVerified = function () {
  this.status = "connected";
  this.lastCheckedAt = new Date();
  this.lastError = undefined;
  return this.save();
};

IntegrationCredentialSchema.methods.markFailed = function (errorMessage) {
  this.status = "failed";
  this.lastCheckedAt = new Date();
  this.lastError = String(errorMessage || "Connection test failed").slice(0, 500);
  return this.save();
};

module.exports = mongoose.model("IntegrationCredential", IntegrationCredentialSchema);