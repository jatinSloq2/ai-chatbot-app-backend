const express = require("express");
const router = express.Router();

const credentialController = require("../controllers/integrationCredential.controller");
const { protect } = require("../middlewares/auth.middleware");

router.use(protect);

router.get("/", credentialController.listCredentials);
router.get("/:id", credentialController.getCredential);

router.post("/email/smtp", credentialController.createEmailSmtp);
router.post("/email/api", credentialController.createEmailApi);
// Manual OAuth token entry (paste an access/refresh token you already
// obtained from Google/Microsoft). A full "Connect Gmail" consent-screen
// flow needs GOOGLE_CLIENT_ID/SECRET + MS_CLIENT_ID/SECRET registered at
// the platform level (see integrations spec, section 1.1) — wire
// GET /api/oauth/google/init + callback the same way once those are set up.
router.post("/email/oauth", credentialController.createEmailOauth);

router.post("/whatsapp", credentialController.createWhatsapp);
router.post("/sms", credentialController.createSms);
router.post("/ai-provider", credentialController.createAiProvider);

router.patch("/:id", credentialController.updateCredential);
router.patch("/:id/set-default", credentialController.setDefault);
router.post("/:id/test", credentialController.testConnection);
router.delete("/:id", credentialController.deleteCredential);

module.exports = router;