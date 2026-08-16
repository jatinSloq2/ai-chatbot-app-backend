const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const credentialService = require("../services/integrationCredential.service");

// Dot-paths of every field that holds a decrypted secret, per channel.
const SECRET_PATHS = {
  email: [
    "email.smtp.password",
    "email.oauth.accessToken",
    "email.oauth.refreshToken",
    "email.api.apiKey",
    "email.api.accessKeyId",
    "email.api.secretAccessKey",
  ],
  whatsapp: ["whatsapp.accessToken", "whatsapp.webhookVerifyToken"],
  sms: ["sms.apiKey", "sms.authToken", "sms.accessKeyId", "sms.secretAccessKey"],
  ai_provider: ["aiProvider.apiKey", "aiProvider.serviceAccountJson"],
};

function getPath(obj, path) {
  return path.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}
function setPath(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null) return;
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}
function mask(secret) {
  if (!secret || typeof secret !== "string") return null;
  const tail = secret.slice(-4);
  return `••••••••${tail}`;
}

const sanitizeCredential = (doc) => {
  const cred = doc.toObject({ getters: true }); // getters decrypt the secret fields
  const paths = SECRET_PATHS[cred.channel] || [];
  const hasSecrets = {};

  for (const path of paths) {
    const value = getPath(cred, path);
    hasSecrets[path] = !!value;
    setPath(cred, path, mask(value));
  }

  return {
    id: cred._id,
    channel: cred.channel,
    label: cred.label,
    isDefault: cred.isDefault,
    isActive: cred.isActive,
    status: cred.status,
    lastCheckedAt: cred.lastCheckedAt,
    lastError: cred.lastError,
    email: cred.email,
    whatsapp: cred.whatsapp,
    sms: cred.sms,
    aiProvider: cred.aiProvider,
    hasSecrets, // lets the frontend show "a key is saved" without ever seeing it
    createdAt: cred.createdAt,
    updatedAt: cred.updatedAt,
  };
};

// GET /api/credentials?channel=email
const listCredentials = asyncHandler(async (req, res) => {
  const creds = await credentialService.listCredentials(req.user._id, req.query.channel);
  res.status(200).json({ success: true, data: { credentials: creds.map(sanitizeCredential) } });
});

// GET /api/credentials/:id
const getCredential = asyncHandler(async (req, res) => {
  const cred = await credentialService.getOwnedCredential(req.params.id, req.user._id);
  res.status(200).json({ success: true, data: { credential: sanitizeCredential(cred) } });
});

// Generic creator used by all four channel-specific POST routes below.
const createFor = (channel, payloadKeys) =>
  asyncHandler(async (req, res) => {
    const { label, isDefault, ...body } = req.body;
    const payload = {};
    for (const key of payloadKeys) if (body[key] !== undefined) payload[key] = body[key];

    const cred = await credentialService.createCredential({
      userId: req.user._id,
      channel,
      label,
      isDefault,
      payload,
    });
    res.status(201).json({ success: true, data: { credential: sanitizeCredential(cred) } });
  });

// POST /api/credentials/email/smtp
const createEmailSmtp = asyncHandler(async (req, res) => {
  const { label, isDefault, fromEmail, fromName, ...smtp } = req.body;
  if (!smtp.host || !smtp.port || !smtp.username || !smtp.password) {
    throw new ApiError(400, "host, port, username and password are required");
  }
  const cred = await credentialService.createCredential({
    userId: req.user._id,
    channel: "email",
    label,
    isDefault,
    payload: { method: "smtp", fromEmail, fromName, smtp },
  });
  res.status(201).json({ success: true, data: { credential: sanitizeCredential(cred) } });
});

// POST /api/credentials/email/api
const createEmailApi = asyncHandler(async (req, res) => {
  const { label, isDefault, fromEmail, fromName, ...api } = req.body;
  if (!api.provider) throw new ApiError(400, "provider is required");
  const cred = await credentialService.createCredential({
    userId: req.user._id,
    channel: "email",
    label,
    isDefault,
    payload: { method: "api", fromEmail, fromName, api },
  });
  res.status(201).json({ success: true, data: { credential: sanitizeCredential(cred) } });
});

// Note: there is no manual "paste a token" creator for email OAuth anymore.
// That credential type is only ever created by completing the real
// consent-screen flow — see controllers/oauth.controller.js.

// POST /api/credentials/whatsapp
const createWhatsapp = createFor("whatsapp", [
  "phoneNumberId",
  "wabaId",
  "appId",
  "accessToken",
  "webhookVerifyToken",
  "businessVerificationStatus",
  "tokenType",
]);

// POST /api/credentials/sms
const createSms = createFor("sms", [
  "provider",
  "accountSid",
  "apiKey",
  "authToken",
  "accessKeyId",
  "secretAccessKey",
  "region",
  "fromNumber",
  "senderId",
  "dlt",
]);

// POST /api/credentials/ai-provider
const createAiProvider = createFor("ai_provider", [
  "provider",
  "apiKey",
  "baseUrl",
  "orgId",
  "projectId",
  "deploymentName",
  "apiVersion",
  "serviceAccountJson",
  "gcpProjectId",
  "region",
  "defaultModel",
]);

// PATCH /api/credentials/:id  — generic update (label, isActive, isDefault, channel fields)
const updateCredential = asyncHandler(async (req, res) => {
  const { label, isActive, isDefault, ...rest } = req.body;
  const cred = await credentialService.updateCredential(req.params.id, req.user._id, {
    label,
    isActive,
    isDefault,
    payload: rest,
  });
  res.status(200).json({ success: true, data: { credential: sanitizeCredential(cred) } });
});

// PATCH /api/credentials/:id/set-default
const setDefault = asyncHandler(async (req, res) => {
  const cred = await credentialService.setDefault(req.params.id, req.user._id);
  res.status(200).json({ success: true, data: { credential: sanitizeCredential(cred) } });
});

// DELETE /api/credentials/:id
const deleteCredential = asyncHandler(async (req, res) => {
  await credentialService.deleteCredential(req.params.id, req.user._id);
  res.status(200).json({ success: true, message: "Credential removed" });
});

// POST /api/credentials/:id/test
const testConnection = asyncHandler(async (req, res) => {
  const cred = await credentialService.testConnection(req.params.id, req.user._id);
  res.status(200).json({ success: true, data: { credential: sanitizeCredential(cred) } });
});

module.exports = {
  listCredentials,
  getCredential,
  createEmailSmtp,
  createEmailApi,
  createWhatsapp,
  createSms,
  createAiProvider,
  updateCredential,
  setDefault,
  deleteCredential,
  testConnection,
};