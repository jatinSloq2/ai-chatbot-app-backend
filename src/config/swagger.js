/**
 * OpenAPI / Swagger configuration.
 *
 * - The spec is built from JSDoc @openapi blocks attached above each route.
 *   See `src/routes/*.routes.js` for the route-level annotations.
 * - The UI is mounted at GET /api/docs (and the raw JSON at /api/docs.json).
 * - This keeps every endpoint documented next to its handler instead of in
 *   a separate giant file that drifts.
 */

const path = require("path");
const swaggerJSDoc = require("swagger-jsdoc");

const isProd = process.env.NODE_ENV === "production";

const swaggerDefinition = {
  openapi: "3.0.3",
  info: {
    title: "JestBot API",
    version: "1.0.0",
    description:
      "REST API for JestBot — AI chatbot platform with RAG, embeddable widget, " +
      "WhatsApp Cloud, agent handover, and Razorpay billing.\n\n" +
      "**Auth schemes used in this API:**\n" +
      "- `cookieAuth` — dashboard JWT in httpOnly cookie (set by /api/auth/login).\n" +
      "- `bearerAuth` — same JWT, but passed in `Authorization: Bearer <token>` for mobile/Postman.\n" +
      "- `agentCookieAuth` / `agentBearerAuth` — separate-scope JWT for live-chat agents.\n" +
      "- `botSecretKey` — `Authorization: Bearer sk_…` for the public document/data API.\n" +
      "- `botPublicKey` — `x-api-key: pk_…` for the embeddable widget chat API.\n",
    contact: { name: "JestBot" },
    license: { name: "Proprietary" },
  },
  servers: [
    {
      url: isProd
        ? process.env.PUBLIC_API_URL || "https://api.example.com"
        : `http://localhost:${process.env.PORT || 5000}`,
      description: isProd ? "Production" : "Local development",
    },
  ],
  tags: [
    { name: "Auth", description: "Signup, login, OTP, password reset, account" },
    { name: "OAuth", description: "Per-tenant Gmail / Outlook OAuth (so bots can send as the user)" },
    { name: "Bots", description: "Bot CRUD, API keys, model config, test chat (dashboard JWT)" },
    { name: "Integrations", description: "Per-tenant credentials (Gmail, Sheets, WhatsApp, etc.)" },
    { name: "Models", description: "Public registry of every supported LLM/embedding provider+model" },
    { name: "Plans", description: "Subscription plans (Free / Starter / Pro)" },
    { name: "Payments", description: "Razorpay order creation, verification, webhook, cancel" },
    { name: "Coupons", description: "Discount coupons" },
    { name: "Referrals", description: "Referral codes, wallet credits" },
    { name: "Dashboard", description: "Aggregated dashboard summary" },
    { name: "Conversations", description: "Chat transcripts" },
    { name: "Leads", description: "Leads captured by bots" },
    { name: "Canned Responses", description: "Saved replies / macros" },
    { name: "Agent Auth", description: "Agent (live-chat sub-user) login" },
    { name: "Agents", description: "Agent-facing inbox + live chat (agent JWT)" },
    { name: "Teams", description: "Teams of agents under a customer" },
    { name: "Admin", description: "Platform-wide admin operations (admin role)" },
    { name: "Public Developer API", description: "Bot key-authenticated API — documents + chat" },
    { name: "WhatsApp", description: "WhatsApp Cloud API onboarding + webhook" },
    { name: "Health", description: "Liveness / readiness probes" },
  ],
  components: {
    securitySchemes: {
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "accessToken",
        description: "Dashboard JWT set as httpOnly cookie by /api/auth/login.",
      },
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Same dashboard JWT, sent as Authorization: Bearer <token>.",
      },
      agentCookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "agentAccessToken",
        description: "Agent JWT set as httpOnly cookie by /api/agent-auth/login.",
      },
      agentBearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Same agent JWT, sent as Authorization: Bearer <token>.",
      },
      botSecretKey: {
        type: "http",
        scheme: "bearer",
        description: "Bot secret key (sk_…) — sent as Authorization: Bearer sk_xxxxx.",
      },
      botPublicKey: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
        description: "Bot public key (pk_…) — safe to expose in client-side widget JS.",
      },
    },
    schemas: {
      Success: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          message: { type: "string", example: "OK" },
          data: { type: "object", nullable: true },
        },
      },
      Error: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          message: { type: "string", example: "Something went wrong" },
          errors: { type: "array", items: { type: "object" }, nullable: true },
        },
      },
      User: {
        type: "object",
        properties: {
          _id: { type: "string", example: "66a1b2c3d4e5f6a7b8c9d0e1" },
          email: { type: "string", format: "email", example: "jane@example.com" },
          name: { type: "string", example: "Jane Doe" },
          role: { type: "string", enum: ["user", "admin"], example: "user" },
          isEmailVerified: { type: "boolean", example: true },
          authProvider: { type: "string", enum: ["local", "google"], example: "local" },
          avatarUrl: { type: "string", nullable: true, example: "https://res.cloudinary.com/…" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Bot: {
        type: "object",
        properties: {
          _id: { type: "string", example: "66a1b2c3d4e5f6a7b8c9d0e1" },
          name: { type: "string", example: "Support Bot" },
          owner: { type: "string", example: "66a1b2c3d4e5f6a7b8c9d0e2" },
          publicKey: { type: "string", example: "pk_a1b2c3d4e5f6" },
          llmConfig: {
            type: "object",
            properties: {
              provider: { type: "string", example: "ollama" },
              model: { type: "string", example: "llama3.1" },
            },
          },
          embeddingConfig: {
            type: "object",
            properties: {
              provider: { type: "string", example: "ollama" },
              model: { type: "string", example: "nomic-embed-text" },
              lockedDimension: { type: "integer", example: 768 },
            },
          },
          systemPrompt: { type: "string", example: "You are a helpful assistant." },
          allowedDomains: { type: "array", items: { type: "string" }, example: ["example.com"] },
          isActive: { type: "boolean", example: true },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Plan: {
        type: "object",
        properties: {
          _id: { type: "string" },
          slug: { type: "string", enum: ["free", "starter", "pro"] },
          name: { type: "string", example: "Pro" },
          price: {
            type: "object",
            properties: {
              inr: { type: "integer", example: 49900, description: "Paise (₹499)" },
              usd: { type: "integer", example: 1900, description: "Cents ($19)" },
            },
          },
          maxBots: { type: "integer", example: 10 },
          maxDocumentsPerBot: { type: "integer", example: 100 },
          maxMessagesPerMonth: { type: "integer", example: 50000 },
          allowedProviders: {
            type: "array",
            items: { type: "string" },
            example: ["ollama", "openai", "anthropic", "google", "groq", "mistral"],
          },
        },
      },
      Subscription: {
        type: "object",
        properties: {
          _id: { type: "string" },
          user: { type: "string" },
          plan: { type: "string" },
          status: { type: "string", enum: ["active", "expired", "cancelled"] },
          currency: { type: "string", enum: ["inr", "usd"] },
          amountCharged: { type: "integer", example: 39900 },
          listPrice: { type: "integer", example: 49900 },
          proratedCredit: { type: "integer", example: 5000 },
          upgradeDiscount: { type: "integer", example: 4990 },
          startDate: { type: "string", format: "date-time" },
          endDate: { type: "string", format: "date-time" },
          autoRenew: { type: "boolean", example: true },
        },
      },
      Document: {
        type: "object",
        properties: {
          _id: { type: "string" },
          bot: { type: "string" },
          sourceType: { type: "string", enum: ["text", "url", "file"] },
          title: { type: "string", example: "Refund Policy" },
          status: { type: "string", enum: ["processing", "ready", "failed"] },
          chunkCount: { type: "integer", example: 7 },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Conversation: {
        type: "object",
        properties: {
          _id: { type: "string" },
          bot: { type: "string" },
          sessionId: { type: "string" },
          messages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                role: { type: "string", enum: ["user", "assistant", "agent", "system"] },
                content: { type: "string" },
                createdAt: { type: "string", format: "date-time" },
              },
            },
          },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Agent: {
        type: "object",
        properties: {
          _id: { type: "string" },
          owner: { type: "string" },
          team: { type: "string", nullable: true },
          name: { type: "string", example: "Alex Kim" },
          email: { type: "string", format: "email" },
          role: { type: "string", enum: ["agent", "team_lead"] },
          status: { type: "string", enum: ["online", "away", "busy", "offline"] },
          avatarUrl: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Team: {
        type: "object",
        properties: {
          _id: { type: "string" },
          owner: { type: "string" },
          name: { type: "string", example: "Tier-1 Support" },
          description: { type: "string" },
          members: { type: "array", items: { type: "string", description: "Agent _id" } },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Lead: {
        type: "object",
        properties: {
          _id: { type: "string" },
          bot: { type: "string" },
          email: { type: "string", format: "email" },
          name: { type: "string" },
          phone: { type: "string", nullable: true },
          message: { type: "string", nullable: true },
          sessionId: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      CannedResponse: {
        type: "object",
        properties: {
          _id: { type: "string" },
          owner: { type: "string" },
          title: { type: "string", example: "Greeting" },
          shortcut: { type: "string", example: "/hi" },
          body: { type: "string" },
          media: { type: "array", items: { type: "string" } },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Handover: {
        type: "object",
        properties: {
          _id: { type: "string" },
          conversation: { type: "string" },
          bot: { type: "string" },
          status: { type: "string", enum: ["pending", "assigned", "active", "resolved"] },
          assignedAgent: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Coupon: {
        type: "object",
        properties: {
          _id: { type: "string" },
          code: { type: "string", example: "WELCOME20" },
          type: { type: "string", enum: ["percent", "fixed"] },
          value: { type: "integer" },
          currency: { type: "string", enum: ["inr", "usd", "both"] },
          maxRedemptions: { type: "integer", nullable: true },
          redeemedCount: { type: "integer" },
          minPlanAmount: { type: "integer", nullable: true },
          applicablePlans: { type: "array", items: { type: "string" } },
          startsAt: { type: "string", format: "date-time", nullable: true },
          expiresAt: { type: "string", format: "date-time", nullable: true },
          isActive: { type: "boolean" },
        },
      },
      WalletTransaction: {
        type: "object",
        properties: {
          _id: { type: "string" },
          user: { type: "string" },
          type: { type: "string", enum: ["credit", "debit", "refund", "referral"] },
          currency: { type: "string", enum: ["inr", "usd"] },
          amount: { type: "integer" },
          description: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      IntegrationCredential: {
        type: "object",
        properties: {
          _id: { type: "string" },
          owner: { type: "string" },
          type: {
            type: "string",
            enum: [
              "email_smtp",
              "email_api",
              "email_oauth",
              "whatsapp",
              "sms",
              "ai_provider",
              "google_sheets",
              "razorpay",
            ],
          },
          label: { type: "string", example: "Primary Gmail" },
          isDefault: { type: "boolean" },
          isConnected: { type: "boolean" },
          lastTestedAt: { type: "string", format: "date-time", nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: "Missing or invalid auth.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      Forbidden: {
        description: "Authenticated but not allowed.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      NotFound: {
        description: "Resource not found.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      TooManyRequests: {
        description: "Rate limit exceeded.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      ValidationError: {
        description: "Request body / params failed validation.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
    },
  },
  // Apply bearer as a global default — routes can override with @openapi.security.
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
};

const swaggerOptions = {
  swaggerDefinition,
  // Path glob is resolved from this file's location, not CWD, so it works
  // whether you start the server from /backend or /backend/src. Forward
  // slashes are required — `swagger-jsdoc` reads the pattern verbatim and
  // backslashes (Windows `path.join`) don't get globbed properly.
  apis: [
    path.join(__dirname, "..", "routes", "*.js").split(path.sep).join("/"),
    path.join(__dirname, "..", "controllers", "*.js").split(path.sep).join("/"),
    path.join(__dirname, "..", "app.js").split(path.sep).join("/"),
  ],
};

const swaggerSpec = swaggerJSDoc(swaggerOptions);

module.exports = swaggerSpec;
