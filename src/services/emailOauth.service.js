const axios = require("axios");
const jwt = require("jsonwebtoken");
const { getProviderConfig } = require("../config/oauthProviders");
const IntegrationCredential = require("../models/IntegrationCredential");

// Short-lived signed "state" param — carries the userId through the redirect
// to Google/Microsoft and back, so the callback (a plain GET from the
// provider, not an authenticated API call) knows who's connecting and that
// the request genuinely originated from our own /init redirect (CSRF guard).
const STATE_SECRET = () => process.env.OAUTH_STATE_SECRET || process.env.JWT_ACCESS_SECRET;

function signState(userId) {
  return jwt.sign({ userId }, STATE_SECRET(), { expiresIn: "10m" });
}

function verifyState(state) {
  try {
    return jwt.verify(state, STATE_SECRET());
  } catch {
    throw new Error("Invalid or expired OAuth state — please try connecting again");
  }
}

// Step 1: build the URL we redirect the user's browser to.
function buildAuthUrl(provider, userId) {
  const cfg = getProviderConfig(provider);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: cfg.scope,
    state: signState(userId),
    access_type: "offline", // ask Google for a refresh_token
    prompt: "consent", // force the consent screen so we actually get one back
  });
  return `${cfg.authUrl}?${params.toString()}`;
}

// Step 2: exchange the ?code=... the provider redirected back with for tokens.
async function exchangeCodeForTokens(provider, code) {
  const cfg = getProviderConfig(provider);
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: "authorization_code",
    code,
  });
  const { data } = await axios.post(cfg.tokenUrl, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15000,
  });
  // { access_token, refresh_token?, expires_in, scope, token_type }
  return data;
}

// Step 3: find out which mailbox was actually connected.
async function fetchProfileEmail(provider, accessToken) {
  const cfg = getProviderConfig(provider);
  const { data } = await axios.get(cfg.userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 10000,
  });
  return data.email;
}

// Refreshes an access token using the stored refresh token. Returns the new
// token data. Note: Google may not always return a new refresh_token on
// refresh (it reuses the old one) — Microsoft always rotates it, so callers
// must persist refresh_token when present.
async function refreshAccessToken(provider, refreshToken) {
  const cfg = getProviderConfig(provider);
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const { data } = await axios.post(cfg.tokenUrl, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15000,
  });
  return data; // { access_token, refresh_token?, expires_in, ... }
}

// Ensures a credential's oauth.accessToken is valid, refreshing (and
// persisting) it first if it's expired or about to expire. Call this before
// any send/test that needs a live token. Throws if there's no refresh token
// or the refresh itself fails (caller should mark the credential 'expired').
async function getValidAccessToken(credentialDoc) {
  const oauth = credentialDoc.email?.oauth;
  if (!oauth?.accessToken) throw new Error("No access token stored for this account");

  const expiresSoon = !oauth.tokenExpiry || new Date(oauth.tokenExpiry).getTime() - Date.now() < 60 * 1000;
  if (!expiresSoon) return oauth.accessToken;

  if (!oauth.refreshToken) {
    throw new Error("Access token expired and no refresh token is stored — please reconnect this account");
  }

  const tokenData = await refreshAccessToken(oauth.provider, oauth.refreshToken);

  credentialDoc.email.oauth.accessToken = tokenData.access_token;
  if (tokenData.refresh_token) credentialDoc.email.oauth.refreshToken = tokenData.refresh_token;
  credentialDoc.email.oauth.tokenExpiry = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000);
  await credentialDoc.save();

  return tokenData.access_token;
}

// Step 4: after a successful callback, save (or update) the credential.
// One OAuth credential per (user, provider, connected email) — reconnecting
// the same mailbox updates tokens in place instead of creating a duplicate.
async function upsertOauthCredential({ userId, provider, tokenData, email }) {
  const oauthPayload = {
    provider,
    email,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token, // may be undefined on a Google re-consent without prompt=consent
    tokenExpiry: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000),
    scope: tokenData.scope,
  };

  const existing = await IntegrationCredential.findOne({
    user: userId,
    channel: "email",
    "email.method": "oauth",
    "email.oauth.provider": provider,
    "email.oauth.email": email,
  });

  if (existing) {
    existing.email.oauth.accessToken = oauthPayload.accessToken;
    // Don't overwrite a previously-stored refresh token with `undefined`
    // if this particular exchange didn't return a new one.
    if (oauthPayload.refreshToken) existing.email.oauth.refreshToken = oauthPayload.refreshToken;
    existing.email.oauth.tokenExpiry = oauthPayload.tokenExpiry;
    existing.email.oauth.scope = oauthPayload.scope;
    existing.email.fromEmail = existing.email.fromEmail || email;
    existing.status = "connected";
    existing.lastCheckedAt = new Date();
    existing.lastError = undefined;
    await existing.save();
    return existing;
  }

  const existingCount = await IntegrationCredential.countDocuments({ user: userId, channel: "email" });

  return IntegrationCredential.create({
    user: userId,
    channel: "email",
    label: `Gmail · ${email}`,
    isDefault: existingCount === 0, // first email credential becomes default automatically
    status: "connected",
    lastCheckedAt: new Date(),
    email: { method: "oauth", fromEmail: email, oauth: oauthPayload },
  });
}

module.exports = {
  signState,
  verifyState,
  buildAuthUrl,
  exchangeCodeForTokens,
  fetchProfileEmail,
  refreshAccessToken,
  getValidAccessToken,
  upsertOauthCredential,
};