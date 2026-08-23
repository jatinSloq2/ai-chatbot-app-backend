const express = require("express");
const router = express.Router();

const cannedResponseController = require("../controllers/cannedResponse.controller");
const { protect } = require("../middlewares/auth.middleware");
const { mediaUpload } = require("../middlewares/upload.middleware");

/**
 * @openapi
 * tags:
 *   - name: Canned Responses
 *     description: Saved replies / macros that agents can send with one click
 * components:
 *   schemas:
 *     CannedResponse:
 *       type: object
 *       properties:
 *         _id: { type: string }
 *         owner: { type: string, description: "Customer _id" }
 *         title: { type: string, example: "Greeting" }
 *         shortcut: { type: string, example: "/hi", description: "Optional trigger shortcut" }
 *         body: { type: string, example: "Hi! How can I help you today?" }
 *         media:
 *           type: array
 *           items: { type: string, description: "URL of an attached media file" }
 *         createdAt: { type: string, format: date-time }
 *     CreateCannedRequest:
 *       type: object
 *       required: [title, body]
 *       properties:
 *         title: { type: string }
 *         shortcut: { type: string }
 *         body: { type: string }
 *     UpdateCannedRequest:
 *       type: object
 *       properties:
 *         title: { type: string }
 *         shortcut: { type: string }
 *         body: { type: string }
 */

router.use(protect);

/**
 * @openapi
 * /api/canned-responses:
 *   post:
 *     tags: [Canned Responses]
 *     summary: Create a canned response (with optional media attachments)
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [title, body]
 *             properties:
 *               title: { type: string }
 *               shortcut: { type: string }
 *               body: { type: string }
 *               media:
 *                 type: array
 *                 items: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     canned: { $ref: "#/components/schemas/CannedResponse" }
 *       400: { $ref: "#/components/responses/ValidationError" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *   get:
 *     tags: [Canned Responses]
 *     summary: List all canned responses owned by the current user
 *     responses:
 *       200:
 *         description: Canned responses
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: "#/components/schemas/CannedResponse" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.post("/", mediaUpload.array("media", 5), cannedResponseController.createCannedResponse);
router.get("/", cannedResponseController.listCannedResponses);

/**
 * @openapi
 * /api/canned-responses/{id}:
 *   patch:
 *     tags: [Canned Responses]
 *     summary: Update a canned response (optionally replacing media)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               shortcut: { type: string }
 *               body: { type: string }
 *               media:
 *                 type: array
 *                 items: { type: string, format: binary }
 *     responses:
 *       200: { description: Updated }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { $ref: "#/components/responses/NotFound" }
 *   delete:
 *     tags: [Canned Responses]
 *     summary: Delete a canned response
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.patch("/:id", mediaUpload.array("media", 5), cannedResponseController.updateCannedResponse);
router.delete("/:id", cannedResponseController.deleteCannedResponse);

module.exports = router;
