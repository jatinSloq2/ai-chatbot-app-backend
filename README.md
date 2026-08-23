# JestBot Backend

A production-grade Node.js/Express backend powering **JestBot** — a platform where users build their own AI chatbots, train them on their own data (RAG), deploy them as embeddable website widgets, connect them to WhatsApp, hand over live conversations to human agents, and monetise via Razorpay subscriptions.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [High-Level Architecture](#high-level-architecture)
3. [Folder Structure](#folder-structure)
4. [Folder-by-Folder Explanation](#folder-by-folder-explanation)
5. [Core Subsystems](#core-subsystems)
   - [Authentication](#1-authentication)
   - [Bots & RAG](#2-bots--rag)
   - [Embeddable Widget](#3-embeddable-widget)
   - [Billing & Subscriptions](#4-billing--subscriptions)
   - [Agent Handover / Live Chat](#5-agent-handover--live-chat)
   - [WhatsApp Cloud API Integration](#6-whatsapp-cloud-api-integration)
   - [Integrations (Google Sheets, etc.)](#7-integrations-google-sheets-etc)
   - [Canned Responses, Leads, Analytics](#8-canned-responses-leads-analytics)
   - [Admin](#9-admin)
   - [Background Jobs](#10-background-jobs)
   - [Public Developer API](#11-public-developer-api)
6. [Environment Variables](#environment-variables)
7. [Setup & Run](#setup--run)
8. [API Reference (Master)](#api-reference-master)
9. [Security Notes](#security-notes)
10. [Testing](#testing)

---

## Tech Stack

- **Runtime:** Node.js (CommonJS)
- **Framework:** Express 4
- **Database:** MongoDB (Mongoose 8)
- **Auth:** JWT (access + refresh tokens in httpOnly cookies), bcryptjs, Firebase Admin (Google sign-in)
- **LLMs:** Ollama (free, local), OpenAI, Anthropic, Google Gemini, Groq, Mistral
- **Embeddings:** Ollama (`nomic-embed-text`), OpenAI, Google
- **Background jobs:** BullMQ + Redis (ioredis) for document ingestion queue, node-cron for subscription expiry sweeps
- **Storage:** Cloudinary for media; local FS for widget static assets and chat attachments
- **Email:** Nodemailer (SMTP) + per-tenant OAuth providers (Gmail, Outlook) via `emailOauth.service.js`
- **Billing:** Razorpay (INR + USD)
- **Realtime:** SSE (Server-Sent Events) for streaming chat + agent inbox
- **Messaging:** WhatsApp Cloud API
- **Security:** Helmet, CORS (smart per-route), express-rate-limit, express-validator, AES-256-GCM encryption for BYOK keys
- **Testing:** Jest + Supertest + mongodb-memory-server

---

## High-Level Architecture

```
                ┌───────────────────────┐
                │   Dashboard (React)   │── JWT (httpOnly cookies)
                └─────────┬─────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────┐
│                    Express API                         │
│  /api/auth  /api/bots  /api/agents  /api/admin ...    │
└────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   ┌─────────┐      ┌──────────┐      ┌────────────┐
   │ MongoDB │      │  Redis   │      │  LLM APIs  │
   │         │      │ (BullMQ) │      │ (BYOK keys │
   │         │      │          │      │  encrypted │
   └─────────┘      └──────────┘      │  at rest)  │
                                       └────────────┘

                ┌────────────────────────┐
                │   Website Widget JS    │── Public API key (SSE)
                │   (any 3rd-party site) │
                └─────────┬──────────────┘
                          ▼
                /api/v1/chat  /api/v1/widget ...
                (Bot public/secret key auth)

                ┌────────────────────────┐
                │  WhatsApp Cloud API    │── Webhook (HMAC verified)
                └────────────────────────┘
```

---

## Folder Structure

```
backend/
├── src/
│   ├── config/
│   │   ├── db.js                  # MongoDB connection
│   │   ├── firebase.js            # Firebase Admin SDK (verify Google ID tokens)
│   │   ├── mailer.js              # Nodemailer SMTP transporter
│   │   ├── cloudinary.js          # Cloudinary media uploads
│   │   ├── modelRegistry.js       # Single source of truth for LLM/embedding models
│   │   └── oauthProviders.js      # Google/Microsoft OAuth provider config
│   │
│   ├── models/                    # Mongoose schemas
│   │   ├── User.js
│   │   ├── Bot.js
│   │   ├── Document.js
│   │   ├── Chunk.js
│   │   ├── Conversation.js
│   │   ├── WidgetSession.js
│   │   ├── MessageEvent.js
│   │   ├── Plan.js
│   │   ├── Subscription.js
│   │   ├── Coupon.js
│   │   ├── CouponRedemption.js
│   │   ├── ReferralReward.js
│   │   ├── ReferralSetting.js
│   │   ├── WalletTransaction.js
│   │   ├── Team.js
│   │   ├── Agent.js
│   │   ├── AgentNotification.js
│   │   ├── CannedResponse.js
│   │   ├── IntegrationCredential.js
│   │   ├── WhatsAppEvent.js
│   │
│   ├── services/                  # Pure business logic
│   │   ├── auth.service.js
│   │   ├── email.service.js
│   │   ├── emailOauth.service.js
│   │   ├── otpDelivery.service.js
│   │   ├── bot.service.js
│   │   ├── billing.service.js
│   │   ├── rag.service.js
│   │   ├── embedding.service.js
│   │   ├── llm.service.js
│   │   ├── responseGenerator.service.js
│   │   ├── urlLoader.service.js
│   │   ├── fileLoader.service.js
│   │   ├── storage.service.js
│   │   ├── handover.service.js
│   │   ├── toolDefinitions.js
│   │   ├── toolOrchestrator.service.js
│   │   ├── botTools.service.js
│   │   ├── agent.service.js
│   │   ├── analytics.service.js
│   │   ├── coupon.service.js
│   │   ├── referral.service.js
│   │   ├── wallet.service.js
│   │   ├── lead.service.js
│   │   ├── leads.service.js
│   │   ├── notification.service.js
│   │   ├── businessHours.service.js
│   │   ├── credentialEmailSender.service.js
│   │   ├── platformEmailSender.service.js
│   │   ├── smsSender.service.js
│   │   ├── realtime.service.js
│   │   ├── googleSheets.service.js
│   │   ├── googleSheetsOauth.service.js
│   │   ├── integrationCredential.service.js
│   │   ├── integrationTest.service.js
│   │   ├── razorpay.service.js
│   │   ├── team.service.js
│   │   ├── whatsappSender.service.js
│   │
│   ├── controllers/               # HTTP request/response adapters
│   │   ├── auth.controller.js
│   │   ├── oauth.controller.js
│   │   ├── bot.controller.js
│   │   ├── document.controller.js
│   │   ├── chat.controller.js
│   │   ├── widget.controller.js
│   │   ├── plan.controller.js
│   │   ├── payment.controller.js
│   │   ├── coupon.controller.js
│   │   ├── referral.controller.js
│   │   ├── agent.controller.js
│   │   ├── agentAuth.controller.js
│   │   ├── analytics.controller.js
│   │   ├── dashboard.controller.js
│   │   ├── cannedResponse.controller.js
│   │   ├── conversation.controller.js
│   │   ├── integrationCredential.controller.js
│   │   ├── lead.controller.js
│   │   ├── leads.controller.js
│   │   ├── model.controller.js
│   │   ├── team.controller.js
│   │   ├── admin.controller.js
│   │   ├── whatsapp.controller.js
│   │
│   ├── middlewares/
│   │   ├── auth.middleware.js          # `protect` — verifies dashboard JWT
│   │   ├── agentAuth.middleware.js     # verifies agent JWT (separate scope)
│   │   ├── botAuth.middleware.js       # validates bot sk_/pk_ on incoming public requests
│   │   ├── validate.middleware.js      # express-validator runner
│   │   ├── upload.middleware.js        # multer (memory/disk) + file-type guards
│   │   └── error.middleware.js         # 404 + centralised error handler
│   │
│   ├── routes/
│   │   ├── index.js                    # Aggregator (`/api/*`)
│   │   ├── auth.routes.js              # /api/auth/*
│   │   ├── oauth.routes.js             # /api/oauth/*
│   │   ├── bot.routes.js               # /api/bots/*       (dashboard JWT)
│   │   ├── plan.routes.js              # /api/plans         (public)
│   │   ├── payment.routes.js           # /api/payments/*    (JWT + webhook)
│   │   ├── coupon.routes.js            # /api/coupons
│   │   ├── referral.routes.js          # /api/referrals
│   │   ├── agent.routes.js             # /api/agents/*     (agent JWT)
│   │   ├── agentAuth.routes.js         # /api/agent-auth/* (agent login)
│   │   ├── cannedResponse.routes.js
│   │   ├── integrationCredential.routes.js
│   │   ├── leads.routes.js
│   │   ├── model.routes.js             # /api/models        (public, registry)
│   │   ├── team.routes.js
│   │   ├── admin.routes.js             # /api/admin/*
│   │   ├── dashboard.routes.js
│   │   └── public.routes.js            # /api/v1/*          (bot key auth, this is the product)
│   │
│   ├── jobs/
│   │   ├── ingestionQueue.js           # BullMQ worker — chunks + embeds documents
│   │   └── subscriptionExpiry.job.js   # node-cron — deactivates expired subs
│   │
│   ├── scripts/
│   │   ├── seedPlans.js                # Seeds Free/Starter/Pro plans
│   │   └── makeAdmin.js                # Promotes an email to admin role
│   │
│   ├── utils/
│   │   ├── ApiError.js                 # Typed error class
│   │   ├── asyncHandler.js             # async/await wrapper for controllers
│   │   ├── apiKey.js                   # pk_/sk_ key generation
│   │   ├── crypto.js                   # AES-256-GCM encrypt/decrypt for BYOK
│   │   ├── token.js                    # JWT issue/verify
│   │   ├── otp.js                      # 6-digit OTP gen + bcrypt hash
│   │   ├── textSplitter.js             # ~1500-char overlapping chunks
│   │   ├── vectorMath.js               # cosine similarity
│   │   ├── i18n.js                     # tiny locale lookup
│   │   ├── sse.js                      # Server-Sent Events helpers
│   │   ├── handoverIntent.js           # regex/intent classifier for "talk to human"
│   │   ├── awsSigV4.js                 # SigV4 signing for AWS-style webhook bodies
│   │   └── logger.js                   # winston logger
│   │
│   ├── app.js                          # Express app (middleware, routes)
│   └── server.js                       # Entry point (connects DB, starts jobs, listens)
│
├── tests/
├── .env.example
├── jest.config.js
├── jest.config.unit.js
└── package.json
```

---

## Folder-by-Folder Explanation

### `src/config/`
Bootstrap layer. Each file is a thin, side-effecting module you `require()` once at startup:
- **`db.js`** — connects Mongoose to `MONGO_URI` with the options your Atlas tier expects.
- **`firebase.js`** — initialises the Firebase Admin SDK so `oauth.controller` can verify Google `idToken`s from the frontend.
- **`mailer.js`** — builds a reusable Nodemailer transporter (Gmail App Password in dev; Resend/SendGrid SMTP in prod).
- **`cloudinary.js`** — configures Cloudinary SDK for media uploads.
- **`modelRegistry.js`** — single source of truth for every supported LLM/embedding provider+model+dimension. Exposed publicly via `GET /api/models`.
- **`oauthProviders.js`** — Google + Microsoft OAuth scopes/redirects for per-tenant email integrations.

### `src/models/`
Mongoose schemas only — no business logic. Notable:
- **`Bot.js`** — owns `publicKey` (pk_), `secretKeyHash` (sk_ shown once), `llmConfig`, `embeddingConfig` (with `lockedDimension` to prevent silent vector-dim swaps), widget theme + allowed domains.
- **`Conversation.js`** — per-visitor chat history with messages, retrieved chunks, handoff state, sentiment.
- **`Chunk.js`** — embedding vectors scoped by `bot`; retrieval uses brute-force cosine similarity over a bot's chunks (swap for Atlas Vector Search / Pinecone later).
- **`Subscription.js`** — Razorpay order IDs, signature, proration breakdown, `endDate`, auto-renew flag.
- **`Agent.js`** — separate scoped identity (sub-user) for live-chat agents belonging to a `User`.

### `src/services/`
Pure business logic — no HTTP, no req/res. Controllers call these. Highlights:
- **`rag.service.js`** — chunking, embedding generation, ingestion, retrieval, prompt construction, full re-embed after a model switch.
- **`llm.service.js`** — streaming chat completions across all providers (OpenAI, Anthropic, Gemini, Groq, Mistral, Ollama) with tool-call parsing.
- **`botTools.service.js`** — executable tools the LLM can call: send email, create lead, schedule handover, hit an integration, etc. Tool definitions live in `toolDefinitions.js`; `toolOrchestrator.service.js` dispatches.
- **`embedding.service.js`** — provider-agnostic vector generation; respects `embeddingConfig` (provider + model + BYOK key).
- **`handover.service.js`** — the big one: human-handover state machine, agent assignment, idle timeouts, missed-message escalation, SSE fan-out to agents.
- **`billing.service.js`** — per-day proration + 10% upgrade discount math.
- **`razorpay.service.js`** — order creation (INR/USD), HMAC signature verification.
- **`email.service.js`** + **`emailOauth.service.js`** — platform SMTP and per-tenant Gmail/Outlook OAuth sending (so a user can send email from their own mailbox through the bot).
- **`googleSheets.service.js`** + **`googleSheetsOauth.service.js`** — sheets-as-knowledge-source.
- **`whatsappSender.service.js`** — outbound WhatsApp Cloud API messaging (text, media, templates).
- **`analytics.service.js`** — aggregations for the dashboard charts.
- **`storage.service.js`** — abstracts Cloudinary + local FS for chat attachments and widget static assets.

### `src/controllers/`
Thin HTTP layer. They parse `req`, call services, set cookies/headers, return JSON. Anything domain-y lives in a service.

### `src/middlewares/`
- **`auth.middleware.js`** (`protect`) — verifies the dashboard JWT, attaches `req.user`.
- **`agentAuth.middleware.js`** — verifies the agent JWT (separate audience/scope).
- **`botAuth.middleware.js`** — validates `pk_`/`sk_` against the `Bot` collection on every public/dev-API request.
- **`validate.middleware.js`** — runs `express-validator` chains and 400s on failure.
- **`upload.middleware.js`** — `multer` config + mimetype/size guards.
- **`error.middleware.js`** — 404 + central error responder (formats `ApiError`, hides internals in prod).

### `src/routes/`
Express routers. `index.js` mounts them all under `/api`.

### `src/jobs/`
- **`ingestionQueue.js`** — BullMQ worker. When a document is uploaded, a job is enqueued; the worker chunks it, generates embeddings, and writes `Chunk`s. API responds with `status: "processing"` immediately.
- **`subscriptionExpiry.job.js`** — node-cron sweep that flips `active`→`expired` on `Subscription`s past `endDate`.

### `src/scripts/`
CLI one-shots run via `npm run`:
- **`seedPlans.js`** — seeds Free/Starter/Pro plans with `maxBots`, `maxDocumentsPerBot`, `maxMessagesPerMonth`, `allowedProviders`, dual `price.inr`/`price.usd`.
- **`makeAdmin.js`** — `npm run make:admin someone@example.com` promotes an existing user.

### `src/utils/`
No-I/O helpers. Worth noting:
- **`crypto.js`** — AES-256-GCM encrypt/decrypt. Every BYOK LLM key is encrypted with `ENCRYPTION_KEY` at rest, decrypted in-memory only at call time.
- **`vectorMath.js`** — cosine similarity for retrieval.
- **`sse.js`** — tiny helper to push SSE events with proper headers + heartbeat.
- **`handoverIntent.js`** — keyword/regex classifier that decides when the bot should hand off to a human.
- **`awsSigV4.js`** — signature helper for AWS-style webhook bodies (some integrations use SigV4 instead of HMAC).

---

## Core Subsystems

### 1. Authentication

Email/password + email OTP + password reset + Firebase Google login + per-tenant OAuth.

| Endpoint | Auth | Description |
|---|---|---|
| `POST /api/auth/signup` | — | Create account, send 6-digit OTP |
| `POST /api/auth/verify-email` | — | Verify OTP, mark `isEmailVerified`, issue tokens |
| `POST /api/auth/resend-otp` | — | Resend OTP if expired |
| `POST /api/auth/login` | — | Email/password login (blocks if unverified) |
| `POST /api/auth/google` | — | Verify Firebase `idToken`, find-or-create user (auto-verified) |
| `POST /api/auth/forgot-password` | — | Send OTP (generic response — no user enumeration) |
| `POST /api/auth/reset-password` | — | Verify OTP + set new password |
| `POST /api/auth/refresh-token` | refresh cookie | Issue a new access token |
| `POST /api/auth/logout` | JWT | Clear cookies, invalidate stored refresh-token hash |
| `GET  /api/auth/me` | JWT | Current user |
| `POST /api/auth/change-password` | JWT | Requires current password; forces re-login everywhere |
| `POST /api/auth/add-password` | JWT | For Google-only accounts that want password too |
| `DELETE /api/auth/account` | JWT | Cascade-delete user + bots + documents + chunks + conversations + subscriptions (needs `{ "confirm": "DELETE" }`) |
| `POST /api/oauth/google/connect` | JWT | Begin Gmail OAuth (per-tenant sending) |
| `GET  /api/oauth/google/callback` | — | OAuth callback |
| `POST /api/oauth/microsoft/connect` | JWT | Begin Outlook OAuth |
| `GET  /api/oauth/microsoft/callback` | — | OAuth callback |

**Sessions**
- Access token: 15 min, httpOnly cookie + returned in JSON body for mobile/Postman.
- Refresh token: 30 days, httpOnly cookie; only its **bcrypt hash** lives in MongoDB so logout invalidates it.

---

### 2. Bots & RAG

A **Bot** is one customer's chatbot. It owns:
- `publicKey` (`pk_…`) — embeddable in any website's client JS.
- `secretKey` (`sk_…`) — shown once at creation; rotates via `regenerate-key`.
- `llmConfig` / `embeddingConfig` (provider, model, BYOK `apiKey` encrypted at rest, `lockedDimension`).
- Widget theme + allowed domains.

**Bot CRUD** (all under `/api/bots`, dashboard JWT):

| Endpoint | Description |
|---|---|
| `POST /api/bots` | Create bot (returns secret key once) |
| `GET  /api/bots` | List your bots |
| `GET  /api/bots/:id` | Get one |
| `PATCH /api/bots/:id` | Update name/system prompt/widget config/allowed domains |
| `DELETE /api/bots/:id` | Cascade delete bot + documents + chunks + conversations |
| `POST /api/bots/:id/regenerate-key` | Rotate secret key |
| `POST /api/bots/:id/model-config` | Set BYOK LLM/embedding provider+model+key. If switching embedding dimension with existing docs → `409` until you send `confirmReembed: true`, which re-embeds everything in the background. |
| `POST /api/bots/:id/test-chat` | Owner-only streaming playground. Shows retrieved chunks + similarity scores. Does **not** count against the plan's monthly quota. |

**RAG pipeline** (`rag.service.js`):
1. Text (or URL, or uploaded file: PDF/DOCX/CSV via `mammoth` + `pdf-parse`) is split by `textSplitter.js` into ~1500-char overlapping chunks.
2. Each chunk is embedded by `embedding.service.js` using the bot's configured embedding provider.
3. `Chunk`s (vector + text + metadata) are stored scoped by `bot`.
4. Retrieval = brute-force cosine similarity over that bot's chunks (swap for Atlas Vector Search / Pinecone / Qdrant later — only `rag.service.js` changes).

Ingestion runs in the BullMQ worker, so the API responds immediately with `status: "processing"` and flips to `"ready"` when done.

---

### 3. Embeddable Widget

Authenticated with the bot's **public key** (`x-api-key: pk_…`), streamed via SSE.

| Endpoint | Description |
|---|---|
| `GET /widget.js` | Serves the embeddable JS bundle |
| `POST /api/v1/chat` | Streaming RAG chat (SSE) |
| `POST /api/v1/lead` | Visitor lead capture |
| `POST /api/v1/widget/*` | Widget config + assets |

**Chat SSE contract**
```
event: session
data: {"sessionId":"..."}

event: token
data: {"token":"We "}

event: token
data: {"token":"offer "}

event: done
data: {"fullResponse":"We offer a 30-day refund..."}
```

`chat.controller.js` flow:
1. Embed the query.
2. Retrieve top-K chunks by cosine similarity (min score threshold).
3. Build a system prompt from context + last N messages of `Conversation` history + canned responses + tool definitions.
4. Stream from the configured LLM provider.
5. Persist the exchange to `Conversation`.

The widget supports tool calls: the LLM can decide to call `sendEmail`, `createLead`, `handoverToAgent`, `getGoogleSheetData`, `sendWhatsAppTemplate`, etc. (`toolOrchestrator.service.js` dispatches; definitions live in `toolDefinitions.js`; implementations in `botTools.service.js`).

---

### 4. Billing & Subscriptions

Three seeded plans: **Free / Starter / Pro**, each with `maxBots`, `maxDocumentsPerBot`, `maxMessagesPerMonth`, `allowedProviders`. Plans expose **dual-currency pricing** (`price.inr` in paise, `price.usd` in cents). Limits enforced in `bot.service.js` and `document.controller.js`; admins bypass all limits via a synthetic unlimited plan.

| Endpoint | Auth | Description |
|---|---|---|
| `GET  /api/plans?currency=inr\|usd` | — | List plans |
| `POST /api/payments/create-order` | JWT | Create Razorpay order; on upgrades applies per-day proration + 10% upgrade discount (only if existing paid subscription) |
| `POST /api/payments/verify` | JWT | Verify signature, activate subscription |
| `POST /api/payments/webhook` | Razorpay signature | Server-to-server reliability fallback (uses raw body + HMAC) |
| `GET  /api/payments/my-subscription` | JWT | Current active subscription |
| `POST /api/payments/cancel` | JWT | Cancel auto-renewal, keep access until `endDate` |
| `POST /api/coupons/validate` | — | Validate coupon code |
| `GET  /api/referrals/me` | JWT | Referral stats + invite link |
| `POST /api/referrals/redeem` | — | Redeem a referral code at signup |
| `GET  /api/wallet/transactions` | JWT | Wallet credit/debit history (referral rewards, refunds) |

**Proration logic** (`billing.service.js`):
- Unused days on the current plan → credit = `oldPlan.amount / 30 * daysRemaining`.
- Upgrade discount: additional 10% off, **only** if upgrading from an existing active paid plan.
- Breakdown (`listPrice`, `proratedCredit`, `upgradeDiscount`, `amountCharged`) is returned and persisted on `Subscription` for audit.

---

### 5. Agent Handover / Live Chat

When the LLM (or `handoverIntent.js` classifier) decides a visitor needs a human, the conversation is handed to an **Agent** — a sub-user scoped to a parent `User` (the customer).

- **`Agent`** has its own JWT (`/api/agent-auth/login`) — separate from dashboard JWT.
- **`handover.service.js`** is the state machine: assignment, idle timeout, missed-message escalation, closing back to bot.
- Agent inbox streams new messages + assignments via SSE (`realtime.service.js`).
- Visitor ↔ agent messages pass through the same `Conversation` document the bot was using, so context is preserved.

| Endpoint | Auth | Description |
|---|---|---|
| `POST /api/agent-auth/login` | — | Agent login (separate credential set) |
| `GET  /api/agents/me` | Agent JWT | Agent profile |
| `GET  /api/agents/inbox` | Agent JWT | List assigned + unassigned open conversations (SSE for live updates) |
| `POST /api/agents/conversations/:id/messages` | Agent JWT | Send a message as the agent |
| `POST /api/agents/conversations/:id/close` | Agent JWT | Close + return control to bot |
| `GET  /api/agents/notifications` | Agent JWT | SSE stream of new assignments |
| `POST /api/teams` | JWT | Create a team (group of agents under one user) |
| `POST /api/teams/:id/members` | JWT | Invite agent |

---

### 6. WhatsApp Cloud API Integration

Customers can connect their own WhatsApp Business Cloud account. Incoming messages route through a bot just like the website widget, and the agent handover flow works the same.

- **Webhook** (`/api/whatsapp/webhook`) — Meta's verification handshake (GET) + HMAC-verified message events (POST). Mounted **before** `express.json()` so the raw body is preserved for signature verification (`awsSigV4.js`).
- **Outbound** — `whatsappSender.service.js` sends text, media, and template messages via the Cloud API.

| Endpoint | Auth | Description |
|---|---|---|
| `POST /api/whatsapp/connect` | JWT | Begin WhatsApp Cloud onboarding |
| `GET  /api/whatsapp/webhook` | Meta | Verification handshake |
| `POST /api/whatsapp/webhook` | HMAC | Incoming messages + status events |
| `POST /api/whatsapp/send` | JWT | Outbound send (template/text/media) |

---

### 7. Integrations (Google Sheets, etc.)

Customers can let their bot read/write data on their behalf.

- **`IntegrationCredential`** stores per-user OAuth credentials (Sheets, Gmail, Outlook, etc.) encrypted at rest.
- **`googleSheets.service.js`** / **`googleSheetsOauth.service.js`** — let the bot use a Google Sheet as a knowledge source or as a write target (e.g. "log this lead to my CRM sheet").
- **`integrationTest.service.js`** — verifies a credential actually works before saving.
- **`credentialEmailSender.service.js`** — sends integration credentials / onboarding emails.

| Endpoint | Auth | Description |
|---|---|---|
| `POST /api/integrations` | JWT | Save a new integration credential (OAuth callback target) |
| `GET  /api/integrations` | JWT | List your integrations |
| `DELETE /api/integrations/:id` | JWT | Revoke an integration |
| `POST /api/integrations/:id/test` | JWT | Smoke-test the credential |

---

### 8. Canned Responses, Leads, Analytics

| Endpoint | Auth | Description |
|---|---|---|
| `GET/POST/PATCH/DELETE /api/canned-responses` | JWT | Per-bot canned replies the bot can fire on intent match |
| `GET/POST /api/leads` | JWT | Leads captured by the bot (name, email, message, source conversation) |
| `GET /api/conversations` | JWT | List conversations across your bots |
| `GET /api/conversations/:id` | JWT | Full transcript |
| `GET /api/analytics/overview` | JWT | Messages, unique visitors, resolution rate, top intents |
| `GET /api/analytics/bots/:id` | JWT | Per-bot analytics |
| `GET /api/dashboard` | JWT | Aggregated dashboard summary |
| `GET /api/notifications` | JWT | User notifications |

`businessHours.service.js` lets a bot hand off only during configured business hours; outside hours it plays an away-message and queues the conversation for next-open review.

---

### 9. Admin

Admins (`role: "admin"`) bypass every plan limit. Promote with `npm run make:admin someone@example.com`.

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/admin/overview` | Admin | Total users, bots, documents, active subs, MRR (INR+USD separately) |
| `GET /api/admin/users` | Admin | Paginated user list, `?search=` |
| `PATCH /api/admin/users/:id/role` | Admin | Promote/demote |
| `PATCH /api/admin/users/:id/suspend` | Admin | Deactivate/reactivate all of a user's bots |
| `GET /api/admin/bots` | Admin | All bots platform-wide |
| `GET /api/admin/subscriptions` | Admin | All subscriptions, `?status=active` |

---

### 10. Background Jobs

- **BullMQ ingestion worker** (`jobs/ingestionQueue.js`) — started by `server.js`. Pulls `process-document` jobs and calls `rag.service.processDocument`. Uses Redis (`REDIS_URL`).
- **Subscription expiry cron** (`jobs/subscriptionExpiry.job.js`) — daily sweep that flips expired subs and triggers bot deactivation per plan rules.

---

### 11. Public Developer API

The "product surface" — third-party developers build on top of JestBot using bot API keys.

```
POST   /api/v1/documents          Authorization: Bearer sk_xxxxx
GET    /api/v1/documents
GET    /api/v1/documents/:id
PUT    /api/v1/documents/:id      (replace content, re-chunk, re-embed)
DELETE /api/v1/documents/:id

POST   /api/v1/chat                x-api-key: pk_xxxxx  (SSE)
POST   /api/v1/lead                x-api-key: pk_xxxxx
GET    /api/v1/widget/config       x-api-key: pk_xxxxx
```

Plus the public model registry:
```
GET /api/models   →  all supported LLM/embedding provider+model combos (with vector dimensions)
```

---

## Environment Variables

See `.env.example` for the canonical list. Summary:

```bash
# Server
NODE_ENV=development
PORT=5000
CLIENT_URL=http://localhost:3000

# Mongo
MONGO_URI=mongodb+srv://...

# Auth
JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...
ENCRYPTION_KEY=<openssl rand -hex 32>     # AES-256-GCM for BYOK keys
JWT_AGENT_SECRET=...                       # separate audience for agent JWTs

# Email (platform SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=...
SMTP_PASS=<Gmail App Password>

# Firebase (Google login)
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# LLM (free default — Ollama)
OLLAMA_BASE_URL=http://localhost:11434

# Redis (BullMQ ingestion queue)
REDIS_URL=redis://localhost:6379

# Razorpay
RAZORPAY_KEY_ID=...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...

# Cloudinary
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...

# Google OAuth (Gmail/Sheets)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=...

# Microsoft OAuth (Outlook)
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
MICROSOFT_REDIRECT_URI=...

# Rate limiting
RATE_LIMIT_WINDOW_MIN=15
RATE_LIMIT_MAX=1000
```

---

## Setup & Run

```bash
# 1. Install deps
npm install

# 2. Generate an encryption key for BYOK storage
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Fill in .env
cp .env.example .env

# 4. Make sure Mongo + Redis are running, then seed default plans
npm run seed:plans

# 5. (Free default) Run Ollama locally + pull models
ollama pull llama3.1
ollama pull nomic-embed-text

# 6. Run the API
npm run dev          # nodemon
# or
npm start            # plain node
```

The server boots, connects Mongo, starts the BullMQ ingestion worker, starts the subscription-expiry cron, and listens on `PORT` (default 5000).

---

## API Reference (Master)

### Auth & Account
```
POST   /api/auth/signup
POST   /api/auth/verify-email
POST   /api/auth/resend-otp
POST   /api/auth/login
POST   /api/auth/google
POST   /api/auth/forgot-password
POST   /api/auth/reset-password
POST   /api/auth/refresh-token
POST   /api/auth/logout
GET    /api/auth/me
POST   /api/auth/change-password
POST   /api/auth/add-password
DELETE /api/auth/account
POST   /api/oauth/google/connect
GET    /api/oauth/google/callback
POST   /api/oauth/microsoft/connect
GET    /api/oauth/microsoft/callback
```

### Bots (dashboard JWT)
```
POST   /api/bots
GET    /api/bots
GET    /api/bots/:id
PATCH  /api/bots/:id
DELETE /api/bots/:id
POST   /api/bots/:id/regenerate-key
POST   /api/bots/:id/model-config
POST   /api/bots/:id/test-chat
```

### Plans, Billing, Coupons, Referrals
```
GET    /api/plans
POST   /api/payments/create-order
POST   /api/payments/verify
POST   /api/payments/webhook            (Razorpay signature)
GET    /api/payments/my-subscription
POST   /api/payments/cancel
POST   /api/coupons/validate
GET    /api/referrals/me
POST   /api/referrals/redeem
GET    /api/wallet/transactions
```

### Agent / Live Chat
```
POST   /api/agent-auth/login
GET    /api/agents/me
GET    /api/agents/inbox
POST   /api/agents/conversations/:id/messages
POST   /api/agents/conversations/:id/close
GET    /api/agents/notifications          (SSE)
POST   /api/teams
POST   /api/teams/:id/members
```

### WhatsApp
```
POST   /api/whatsapp/connect
GET    /api/whatsapp/webhook              (Meta verification)
POST   /api/whatsapp/webhook              (HMAC)
POST   /api/whatsapp/send
```

### Integrations
```
POST   /api/integrations
GET    /api/integrations
DELETE /api/integrations/:id
POST   /api/integrations/:id/test
```

### Dashboard / Conversation / Leads / Analytics
```
GET    /api/dashboard
GET    /api/conversations
GET    /api/conversations/:id
GET    /api/leads
POST   /api/leads                          (also called internally by tool)
GET    /api/analytics/overview
GET    /api/analytics/bots/:id
GET    /api/notifications
GET/POST/PATCH/DELETE /api/canned-responses
```

### Admin
```
GET    /api/admin/overview
GET    /api/admin/users
PATCH  /api/admin/users/:id/role
PATCH  /api/admin/users/:id/suspend
GET    /api/admin/bots
GET    /api/admin/subscriptions
```

### Public Developer API
```
POST   /api/v1/documents                   (Bearer sk_xxx)
GET    /api/v1/documents
GET    /api/v1/documents/:id
PUT    /api/v1/documents/:id
DELETE /api/v1/documents/:id
POST   /api/v1/chat                         (x-api-key pk_xxx, SSE)
POST   /api/v1/lead                         (x-api-key pk_xxx)
GET    /api/v1/widget/config                (x-api-key pk_xxx)
GET    /widget.js
GET    /api/models
```

---

## Security Notes

- **Helmet** is on with relaxed CSP/CORP/COOP (the widget must be embeddable cross-origin).
- **Smart CORS** in `app.js` — widget routes are `*`, dashboard routes are locked to `CLIENT_URL` with credentials.
- **Rate limiting** — global limiter (`RATE_LIMIT_WINDOW_MIN` × `RATE_LIMIT_MAX`).
- **BYOK encryption** — every user-supplied LLM key is AES-256-GCM encrypted at rest, decrypted in memory only at call time.
- **Webhook signatures** — Razorpay and WhatsApp webhooks are verified via HMAC using the **raw** request body (mounted before `express.json()`).
- **JWT secrets** are audience-scoped — dashboard, refresh, and agent tokens all use different secrets.
- **Account deletion is hard-cascaded** — bots, documents, chunks, conversations, subscriptions are all removed with the user.
- **OTP** is bcrypt-hashed and rate-limited (capped attempts), generic responses on forgot-password prevent user enumeration.

---

## Testing

```bash
npm run test:unit    # fast, no DB — chunking, cosine similarity, proration math
npm test             # full suite — spins up mongodb-memory-server
```

Coverage includes: signup/OTP/login flow, plan-limit enforcement (Free capped at 1 bot), admin bypass (unlimited), bot ownership isolation (can't touch another user's bot), proration math sanity ranges, tool orchestration happy paths.

> `npm test` downloads a real MongoDB binary on first run (`fastdl.mongodb.org`). If you're offline, run `npm run test:unit`, or point `MONGO_URI` at a local mongod and tweak `tests/globalSetup.js`.

---

Built with Node, Express, MongoDB, and a lot of `console.log` becoming `winston.info`.
