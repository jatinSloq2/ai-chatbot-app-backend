const axios = require("axios");
const logger = require("../utils/logger");
const IntegrationCredential = require("../models/IntegrationCredential");

/**
 * ---------------------------------------------------------------------------
 * Meta WhatsApp Embedded Signup (Facebook Login for Business).
 *
 * Flow, end to end:
 *   1. Frontend loads the Facebook JS SDK and calls FB.login() with our
 *      META_CONFIG_ID (a WhatsApp-Embedded-Signup login configuration
 *      created once in the Meta App Dashboard → this is what makes the
 *      popup show "Add WhatsApp Business Account" instead of a generic
 *      Facebook Login screen). See GET /embedded-signup/config below for
 *      the values the frontend needs to boot the SDK.
 *   2. On success, Meta's popup posts a `window.postMessage` event of type
 *      "WA_EMBEDDED_SIGNUP" containing { phone_number_id, waba_id,
 *      business_id } (frontend listens for this), AND FB.login()'s own
 *      callback returns an authorization `code`.
 *   3. Frontend sends { code, phoneNumberId, wabaId, businessId } to
 *      POST /api/credentials/whatsapp/embedded-signup/exchange (below).
 *   4. Backend exchanges the code for a token, upgrades it to a long-lived
 *      one, subscribes OUR app to the tenant's WABA's webhooks, and reads
 *      back the actual phone number so we don't have to trust the client
 *      for anything security-relevant.
 *
 * Every tenant who completes this flow shares OUR platform's single Meta
 * Tech Provider App (META_APP_ID/META_APP_SECRET) — that's the whole point
 * of embedded signup (no per-tenant Meta App, no manual webhook paste).
 * ---------------------------------------------------------------------------
 */

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v25.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

function requireEnv(name) {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set — WhatsApp Embedded Signup is not configured on this server`);
    return value;
}

// Values the FRONTEND needs to boot the Facebook JS SDK and open the
// embedded signup popup. No secrets — safe to expose to the browser.
function getPublicConfig() {
    return {
        appId: requireEnv("META_APP_ID"),
        configId: requireEnv("META_CONFIG_ID"),
        graphVersion: GRAPH_VERSION,
    };
}

// Step 1: exchange the short-lived authorization `code` FB.login() returned
// for a User/System access token scoped to whatsapp_business_management +
// whatsapp_business_messaging on the shared tenant's WABA.
async function exchangeCodeForToken(code) {
    const { data } = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
        params: {
            client_id: requireEnv("META_APP_ID"),
            client_secret: requireEnv("META_APP_SECRET"),
            code,
        },
        timeout: 15000,
    });
    return data.access_token; // short-lived (~1-2hr)
}

// Step 2: upgrade to a long-lived token (~60 days). Meta's Cloud API tokens
// from Embedded Signup don't come back "permanent" the way a manually
// generated System User token can — long-lived is the best we get here, so
// tokenType is stored as "temporary" and tokenExpiry is set accordingly
// (same handling the manual flow already has for temporary tokens).
async function getLongLivedToken(shortLivedToken) {
    const { data } = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
        params: {
            grant_type: "fb_exchange_token",
            client_id: requireEnv("META_APP_ID"),
            client_secret: requireEnv("META_APP_SECRET"),
            fb_exchange_token: shortLivedToken,
        },
        timeout: 15000,
    });
    return data; // { access_token, token_type, expires_in }
}

// Step 3: subscribe OUR app to this WABA's webhooks — the embedded-signup
// equivalent of the tenant pasting a Callback URL/Verify Token into their
// own App Dashboard on the manual path. Our app's webhook fields
// (messages, message_template_status_update, etc.) are already configured
// once, platform-wide, on META_APP_ID itself — this call just attaches
// THIS waba's traffic to that existing subscription.
async function subscribeAppToWaba(wabaId, accessToken) {
    await axios.post(`${GRAPH_BASE}/${wabaId}/subscribed_apps`, null, {
        params: { access_token: accessToken },
        timeout: 15000,
    });
}

// Step 4: read back the number's real display info rather than trusting
// whatever the client-side popup claimed.
async function getPhoneNumberDetails(phoneNumberId, accessToken) {
    const { data } = await axios.get(`${GRAPH_BASE}/${phoneNumberId}`, {
        params: {
            fields: "display_phone_number,verified_name,code_verification_status,quality_rating",
            access_token: accessToken,
        },
        timeout: 15000,
    });
    return data;
}

// Optional: registers the number for Cloud API messaging if it isn't
// already (a fresh number added through embedded signup usually needs
// this once). Silently no-ops on the "already registered" error rather
// than failing the whole connect flow over it.
async function registerPhoneNumber(phoneNumberId, accessToken, pin) {
    try {
        await axios.post(
            `${GRAPH_BASE}/${phoneNumberId}/register`,
            { messaging_product: "whatsapp", pin: pin || undefined },
            { params: { access_token: accessToken }, timeout: 15000 }
        );
    } catch (err) {
        const message = err?.response?.data?.error?.message || "";
        if (!/already registered|already verified/i.test(message)) {
            logger.warn(`[whatsappEmbeddedSignup] registerPhoneNumber non-fatal error: ${message || err.message}`);
        }
    }
}

// Runs the full exchange → subscribe → fetch-details sequence and
// creates/updates the IntegrationCredential. One credential per
// (user, phoneNumberId) — re-running signup for the same number (e.g. the
// tenant re-does the popup to refresh a token) updates it in place.
async function completeSignup({ userId, code, wabaId, phoneNumberId, businessId, label, isDefault, pin }) {
    const shortLivedToken = await exchangeCodeForToken(code);
    const longLived = await getLongLivedToken(shortLivedToken).catch((err) => {
        // Long-lived exchange failing shouldn't block the connection — fall
        // back to the short-lived token and let the natural
        // expired-token/reconnect path handle renewal sooner than usual.
        logger.warn(`[whatsappEmbeddedSignup] long-lived token exchange failed: ${err.message}`);
        return { access_token: shortLivedToken, expires_in: 3600 };
    });
    const accessToken = longLived.access_token;

    await subscribeAppToWaba(wabaId, accessToken);
    await registerPhoneNumber(phoneNumberId, accessToken, pin);
    const details = await getPhoneNumberDetails(phoneNumberId, accessToken);

    const payload = {
        signupMethod: "embedded",
        phoneNumber: details.display_phone_number,
        phoneNumberId,
        wabaId,
        businessId,
        appId: requireEnv("META_APP_ID"),
        appSecret: requireEnv("META_APP_SECRET"), // shared platform secret — enables the existing per-credential webhook signature check unchanged
        accessToken,
        businessVerificationStatus: details.code_verification_status === "VERIFIED" ? "verified" : "pending",
        tokenType: "temporary", // long-lived (~60d), not permanent — see comment on getLongLivedToken
        tokenExpiry: new Date(Date.now() + (longLived.expires_in || 5184000) * 1000),
    };

    const existing = await IntegrationCredential.findOne({
        user: userId,
        channel: "whatsapp",
        "whatsapp.phoneNumberId": phoneNumberId,
    });

    if (existing) {
        existing.whatsapp = { ...existing.whatsapp?.toObject?.({ getters: true }), ...payload };
        existing.status = "connected";
        existing.lastCheckedAt = new Date();
        existing.lastError = undefined;
        await existing.save();
        return existing;
    }

    const existingCount = await IntegrationCredential.countDocuments({ user: userId, channel: "whatsapp" });

    return IntegrationCredential.create({
        user: userId,
        channel: "whatsapp",
        label: label?.trim() || `WhatsApp · ${details.display_phone_number}`,
        isDefault: isDefault !== undefined ? !!isDefault : existingCount === 0,
        status: "connected",
        lastCheckedAt: new Date(),
        whatsapp: payload,
    });
}

module.exports = {
    getPublicConfig,
    exchangeCodeForToken,
    getLongLivedToken,
    subscribeAppToWaba,
    getPhoneNumberDetails,
    registerPhoneNumber,
    completeSignup,
};