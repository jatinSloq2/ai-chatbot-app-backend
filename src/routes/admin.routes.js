const express = require("express");
const router = express.Router();

const adminController = require("../controllers/admin.controller");
const analyticsController = require("../controllers/analytics.controller");
const { protect, requireAdmin } = require("../middlewares/auth.middleware");

/**
 * @openapi
 * tags:
 *   - name: Admin
 *     description: Platform-wide admin operations (admin role required)
 */

router.use(protect, requireAdmin);

/**
 * @openapi
 * /api/admin/overview:
 *   get:
 *     tags: [Admin]
 *     summary: Platform-wide KPIs (users, bots, MRR, active subs)
 *     responses:
 *       200:
 *         description: Admin overview
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalUsers: { type: integer, example: 1247 }
 *                     totalBots: { type: integer, example: 3051 }
 *                     totalConversations: { type: integer, example: 92384 }
 *                     activeSubscriptions: { type: integer, example: 312 }
 *                     monthlyRevenue:
 *                       type: object
 *                       properties:
 *                         inr: { type: integer, example: 1849300 }
 *                         usd: { type: integer, example: 24900 }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 */
router.get("/overview", adminController.getOverview);

/**
 * @openapi
 * /api/admin/users:
 *   get:
 *     tags: [Admin]
 *     summary: List all users with pagination
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string, description: "Email or name contains..." }
 *     responses:
 *       200:
 *         description: User list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: "#/components/schemas/User" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 */
router.get("/users", adminController.listUsers);

/**
 * @openapi
 * /api/admin/users/{id}/role:
 *   patch:
 *     tags: [Admin]
 *     summary: Promote / demote a user's role
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role: { type: string, enum: [user, admin] }
 *     responses:
 *       200: { description: Role updated }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.patch("/users/:id/role", adminController.setUserRole);

/**
 * @openapi
 * /api/admin/users/{id}/suspend:
 *   patch:
 *     tags: [Admin]
 *     summary: Suspend every bot owned by a user (deactivates them)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: All bots suspended }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.patch("/users/:id/suspend", adminController.suspendUserBots);
router.post("/users/:id/assign-plan", adminController.assignUserPlan);

/**
 * @openapi
 * /api/admin/bots:
 *   get:
 *     tags: [Admin]
 *     summary: List all bots on the platform
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Bot list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: "#/components/schemas/Bot" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 */
router.get("/bots", adminController.listAllBots);

/**
 * @openapi
 * /api/admin/subscriptions:
 *   get:
 *     tags: [Admin]
 *     summary: List all subscriptions platform-wide
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, expired, cancelled] }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200:
 *         description: Subscription list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: "#/components/schemas/Subscription" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 */
router.get("/subscriptions", adminController.listSubscriptions);

/**
 * @openapi
 * /api/admin/analytics:
 *   get:
 *     tags: [Admin]
 *     summary: Platform-wide analytics
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200: { description: Platform analytics object }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 */
router.get("/analytics", analyticsController.getPlatformAnalytics);

/**
 * @openapi
 * /api/admin/addons:
 *   get:
 *     tags: [Admin]
 *     summary: List the full add-on catalog, including inactive rows
 *     responses:
 *       200: { description: Add-on catalog }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 *   post:
 *     tags: [Admin]
 *     summary: Create a new add-on
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, slug, price]
 *             properties:
 *               name: { type: string }
 *               slug: { type: string }
 *               description: { type: string }
 *               price:
 *                 type: object
 *                 properties: { inr: { type: integer }, usd: { type: integer } }
 *               billingType: { type: string, enum: [lifetime, recurring], default: lifetime }
 *               interval: { type: string, enum: [month, quarter, year] }
 *               limit:
 *                 type: object
 *                 properties: { amount: { type: integer }, unit: { type: string } }
 *               sampleSheetUrl: { type: string }
 *               sortOrder: { type: integer }
 *     responses:
 *       201: { description: Add-on created }
 *       400: { $ref: "#/components/responses/ValidationError" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 */
router.get("/addons", adminController.listAllAddOns);
router.post("/addons", adminController.createAddOn);

/**
 * @openapi
 * /api/admin/addons/{id}:
 *   patch:
 *     tags: [Admin]
 *     summary: Update an add-on
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Add-on updated }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 *       404: { $ref: "#/components/responses/NotFound" }
 *   delete:
 *     tags: [Admin]
 *     summary: Deactivate an add-on (soft delete)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Add-on deactivated }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.patch("/addons/:id", adminController.updateAddOn);
router.delete("/addons/:id", adminController.deleteAddOn);

/**
 * @openapi
 * /api/admin/user-addons:
 *   get:
 *     tags: [Admin]
 *     summary: List add-on ownership records platform-wide
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [created, active, expired, cancelled] }
 *     responses:
 *       200: { description: Ownership records }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 */
router.get("/user-addons", adminController.listUserAddOns);

/**
 * @openapi
 * /api/admin/user-addons/grant:
 *   post:
 *     tags: [Admin]
 *     summary: Manually grant an add-on to a user, bypassing Razorpay
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, addOnId]
 *             properties:
 *               userId: { type: string }
 *               addOnId: { type: string }
 *               note: { type: string }
 *     responses:
 *       201: { description: Add-on granted }
 *       400: { $ref: "#/components/responses/ValidationError" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 *       404: { description: Add-on not found }
 */
router.post("/user-addons/grant", adminController.grantAddOn);

/**
 * @openapi
 * /api/admin/user-addons/{id}/revoke:
 *   patch:
 *     tags: [Admin]
 *     summary: Revoke a previously granted/purchased add-on
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Add-on revoked }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.patch("/user-addons/:id/revoke", adminController.revokeAddOn);

module.exports = router;