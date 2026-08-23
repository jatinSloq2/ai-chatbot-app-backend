const express = require("express");
const router = express.Router();

const oauthController = require("../controllers/oauth.controller");
const { protect } = require("../middlewares/auth.middleware");

/**
 * @openapi
 * tags:
 *   - name: OAuth
 *     description: |
 *       Per-tenant Gmail / Outlook OAuth — the real "Connect Gmail" / "Connect Outlook" flow.
 *       `init` is hit as a real browser navigation (`window.location.href = ...`) from the
 *       dashboard, so the httpOnly access-token cookie rides along. The callback is hit by
 *       the provider redirecting the browser back to us and uses a signed `state` param
 *       instead of a session cookie.
 */

/**
 * @openapi
 * /api/oauth/google/init:
 *   get:
 *     tags: [OAuth]
 *     summary: Begin the Google OAuth2 consent flow
 *     description: |
 *       Redirects the browser to Google's consent screen. The grant covers **Email**
 *       (Gmail send-as), **Google Sheets**, and **Google Meet** (calendar.events) scopes.
 *       After the user grants, Google redirects back to `/api/oauth/google/callback`.
 *
 *       Optional query: `?intent=sheets` or `?intent=meetings` returns the user to the
 *       Google Sheets / Meeting Scheduling tab on completion instead of the Email
 *       credentials tab.
 *     responses:
 *       302:
 *         description: Redirect to Google consent screen
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.get("/google/init", protect, oauthController.initGoogle);

/**
 * @openapi
 * /api/oauth/google/callback:
 *   get:
 *     tags: [OAuth]
 *     summary: Google OAuth2 callback (creates / updates the email_oauth credential)
 *     description: |
 *       Hit by Google's redirect after the user completes consent. Verifies the `state`
 *       param (signed with the customer id), exchanges the `code` for tokens, and creates
 *       or updates an `email_oauth` IntegrationCredential. On success, redirects the
 *       browser back to the dashboard.
 *     parameters:
 *       - in: query
 *         name: code
 *         schema: { type: string }
 *       - in: query
 *         name: state
 *         schema: { type: string }
 *       - in: query
 *         name: error
 *         schema: { type: string, description: "If the user denied on Google's side." }
 *     responses:
 *       302:
 *         description: Redirect to dashboard
 *       400: { description: Invalid state or code exchange failed }
 */
router.get("/google/callback", oauthController.callbackGoogle);

module.exports = router;
