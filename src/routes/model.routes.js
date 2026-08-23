const express = require("express");
const router = express.Router();
const modelController = require("../controllers/model.controller");

/**
 * @openapi
 * /api/models:
 *   get:
 *     tags: [Models]
 *     summary: List all supported LLM and embedding providers + models
 *     description: |
 *       Public endpoint — no auth required. Returns the registry of every LLM and embedding
 *       provider supported by JestBot, along with the available models per provider. The
 *       dashboard uses this to populate the model picker on the bot config screen.
 *     security: []
 *     responses:
 *       200:
 *         description: Model registry
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     llm:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           provider: { type: string, example: openai }
 *                           displayName: { type: string, example: OpenAI }
 *                           requiresApiKey: { type: boolean, example: true }
 *                           models:
 *                             type: array
 *                             items: { type: string, example: gpt-4o-mini }
 *                     embedding:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           provider: { type: string, example: ollama }
 *                           displayName: { type: string, example: Ollama }
 *                           models:
 *                             type: array
 *                             items:
 *                               type: object
 *                               properties:
 *                                 name: { type: string, example: nomic-embed-text }
 *                                 dimension: { type: integer, example: 768 }
 */
router.get("/", modelController.listModels);

module.exports = router;
