const express = require("express");
const router = express.Router();

const credentialController = require("../controllers/integrationCredential.controller");
const { protect } = require("../middlewares/auth.middleware");

router.use(protect);

router.get("/", credentialController.listCredentials);
router.get("/:id", credentialController.getCredential);

router.post("/email/smtp", credentialController.createEmailSmtp);
router.post("/email/api", credentialController.createEmailApi);
// Real OAuth2 connect flow lives in routes/oauth.routes.js:
//   GET /api/oauth/google/init | /api/oauth/microsoft/init      (redirect to consent screen)
//   GET /api/oauth/google/callback | /api/oauth/microsoft/callback (creates/updates the credential)
// There is no manual "paste a token" POST route anymore — an OAuth email
// credential can only be created by completing that real flow.

router.post("/whatsapp", credentialController.createWhatsapp);
router.post("/sms", credentialController.createSms);
router.post("/ai-provider", credentialController.createAiProvider);

router.patch("/:id", credentialController.updateCredential);
router.patch("/:id/set-default", credentialController.setDefault);
router.post("/:id/test", credentialController.testConnection);
router.delete("/:id", credentialController.deleteCredential);

module.exports = router;