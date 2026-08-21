// Central config for the two "Connect Gmail / Connect Outlook" OAuth2 flows.
// All values come from env vars registered at the platform level (Google
// Cloud Console / Azure App Registration) — see .env.example for the full list.

const GOOGLE = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI, // e.g. https://api.yourapp.com/api/oauth/google/callback
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
    // One "Connect Google" flow asks for both permissions at once — gmail.send
    // (for the email channel) and spreadsheets (for the unified bot tools'
    // Google Sheets data layer) — so a single sign-in/consent covers both,
    // same as clicking "Connect Gmail" today. offline access + consent prompt
    // is what actually gets us a refresh_token back (Google only issues one
    // on the *first* consent, hence prompt=consent + access_type=offline
    // below).
    scope: [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/spreadsheets",
    ].join(" "),
};

const MICROSOFT = {
    clientId: process.env.MS_CLIENT_ID,
    clientSecret: process.env.MS_CLIENT_SECRET,
    tenantId: process.env.MS_TENANT_ID || "common", // "common" = personal + work/school accounts
    redirectUri: process.env.MS_REDIRECT_URI, // e.g. https://api.yourapp.com/api/oauth/microsoft/callback
    get authUrl() {
        return `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/authorize`;
    },
    get tokenUrl() {
        return `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
    },
    userInfoUrl: "https://graph.microsoft.com/v1.0/me",
    // offline_access is required to get a refresh_token back from Microsoft.
    scope: ["openid", "email", "profile", "offline_access", "Mail.Send"].join(" "),
};

const PROVIDERS = { google: GOOGLE, microsoft: MICROSOFT };

function getProviderConfig(provider) {
    const cfg = PROVIDERS[provider];
    if (!cfg) throw new Error(`Unsupported OAuth provider: ${provider}`);
    if (!cfg.clientId || !cfg.clientSecret || !cfg.redirectUri) {
        throw new Error(
            `${provider} OAuth is not configured on the server. Missing client id/secret/redirect uri env vars.`
        );
    }
    return cfg;
}

module.exports = { PROVIDERS, getProviderConfig };