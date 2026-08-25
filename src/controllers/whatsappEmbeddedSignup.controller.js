const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const embeddedSignupService = require("../services/whatsappEmbeddedSignup.service");
const inboxSsoService = require("../services/inboxSso.service");
const credentialService = require("../services/integrationCredential.service");
const { sanitizeCredential } = require("./integrationCredential.controller");

// GET /api/credentials/whatsapp/embedded-signup/config
// Public-safe values the frontend needs to boot the Facebook JS SDK and
// open the Embedded Signup popup (appId + login config id). No secrets.
const getEmbeddedSignupConfig = asyncHandler(async (req, res) => {
  const config = embeddedSignupService.getPublicConfig();
  res.status(200).json({ success: true, data: config });
});

// POST /api/credentials/whatsapp/embedded-signup/exchange
// body: { code, wabaId, phoneNumberId, businessId, label?, isDefault? }
// `code` is FB.login()'s authorization code; wabaId/phoneNumberId/businessId
// come from the "WA_EMBEDDED_SIGNUP" postMessage event the popup fires —
// see the frontend's whatsapp-tab.tsx for both. We don't trust any of the
// human-readable details (phone number, verification status) from the
// client — those are re-fetched from Graph directly inside completeSignup.
const exchangeEmbeddedSignup = asyncHandler(async (req, res) => {
  const { code, wabaId, phoneNumberId, businessId, label, isDefault, pin } = req.body;

  if (!code?.trim() || !wabaId?.trim() || !phoneNumberId?.trim()) {
    throw new ApiError(400, "code, wabaId and phoneNumberId are all required");
  }

  const cred = await embeddedSignupService.completeSignup({
    userId: req.user._id,
    code,
    wabaId,
    phoneNumberId,
    businessId,
    label,
    isDefault,
    pin,
  });

  if (isDefault) await credentialService.clearOtherDefaults(req.user._id, "whatsapp", cred._id);

  res.status(201).json({ success: true, data: { credential: sanitizeCredential(cred) } });
});

// GET /api/credentials/whatsapp/:id/inbox-sso
// Issues a short-lived signed token and the full redirect URL for the
// separately-hosted Inbox platform, scoped to this one WhatsApp
// credential. The frontend calls this then immediately navigates/opens
// the returned url — see inboxSso.service.js for the token contents and
// the "Inbox backend changes" doc for how the other side must verify it.
const getInboxSsoRedirect = asyncHandler(async (req, res) => {
  const cred = await credentialService.getOwnedCredential(req.params.id, req.user._id);
  if (cred.channel !== "whatsapp") throw new ApiError(400, "This action is only for WhatsApp credentials");

  const token = inboxSsoService.generateSsoToken({ user: req.user, credential: cred });
  const redirectUrl = inboxSsoService.buildRedirectUrl(token);

  res.status(200).json({ success: true, data: { redirectUrl } });
});

module.exports = { getEmbeddedSignupConfig, exchangeEmbeddedSignup, getInboxSsoRedirect };