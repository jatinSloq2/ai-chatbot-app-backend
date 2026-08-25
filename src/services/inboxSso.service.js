const jwt = require("jsonwebtoken");

/**
 * ---------------------------------------------------------------------------
 * SSO handoff to the separately-hosted Inbox platform.
 *
 * The Inbox UI (agent/conversation view) is a different app on a different
 * domain, with its own backend/session system. Rather than making the user
 * log in twice, clicking "Open inbox" here mints a short-lived, signed
 * token that PROVES who they are and hands over just enough context to let
 * the Inbox backend look up or just-in-time-provision the matching
 * workspace and start its own session — the browser is then redirected
 * there with the token in the URL, exactly like the existing Google/Meta
 * OAuth redirects in this file's sibling services.
 *
 * This token is intentionally NOT a copy of our own JWT_ACCESS_SECRET —
 * it's signed with a secret shared only between this backend and the Inbox
 * backend (INBOX_SSO_SECRET), so a leak of one platform's signing key
 * doesn't compromise the other, and the Inbox side never needs to know
 * anything about our own auth internals.
 *
 * See the "Inbox backend changes" doc for what the OTHER side needs to
 * implement to accept this token.
 * ---------------------------------------------------------------------------
 */

const SSO_SECRET = () => {
    const secret = process.env.INBOX_SSO_SECRET;
    if (!secret) throw new Error("INBOX_SSO_SECRET is not set — Inbox SSO is not configured on this server");
    return secret;
};

const INBOX_PLATFORM_URL = () => {
    const url = process.env.INBOX_PLATFORM_URL;
    if (!url) throw new Error("INBOX_PLATFORM_URL is not set — Inbox SSO is not configured on this server");
    return url.replace(/\/+$/, "");
};

const SSO_AUDIENCE = process.env.INBOX_SSO_AUDIENCE || "jestbot-inbox";
const SSO_ISSUER = "jestbot-backend";

// `user` is a Mongoose User doc (or plain object with _id/email/name).
// `credential` is the WhatsApp IntegrationCredential the click originated
// from — the Inbox side uses phoneNumberId/wabaId to know which
// number's conversations this workspace/session should show.
function generateSsoToken({ user, credential }) {
    const payload = {
        sub: String(user._id),
        email: user.email,
        name: user.name || user.fullName || undefined,
        // Business/tenant context so the Inbox backend can map this login to
        // the right workspace on its own side without a second round-trip.
        whatsapp: credential
            ? {
                credentialId: String(credential._id),
                phoneNumberId: credential.whatsapp?.phoneNumberId,
                wabaId: credential.whatsapp?.wabaId,
                phoneNumber: credential.whatsapp?.phoneNumber,
            }
            : undefined,
    };

    return jwt.sign(payload, SSO_SECRET(), {
        expiresIn: "2m", // deliberately very short — this is a one-time handoff token, not a session token
        audience: SSO_AUDIENCE,
        issuer: SSO_ISSUER,
    });
}

// Builds the full URL to redirect/open in a new tab. `path` lets different
// entry points land on different pages on the Inbox side (defaults to
// whatever the Inbox platform treats as its SSO landing route).
function buildRedirectUrl(token, path = "/sso/callback") {
    const base = INBOX_PLATFORM_URL();
    const url = new URL(path.startsWith("/") ? path : `/${path}`, base);
    url.searchParams.set("token", token);
    return url.toString();
}

module.exports = { generateSsoToken, buildRedirectUrl };