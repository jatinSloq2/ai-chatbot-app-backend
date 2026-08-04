# Auth Backend

Email/password auth + email OTP verification + password reset + Firebase Google login.
Built with Node.js, Express, MongoDB (Mongoose).

## Folder structure

```
auth-backend/
├── src/
│   ├── config/
│   │   ├── db.js            # MongoDB connection
│   │   ├── firebase.js      # Firebase Admin SDK setup (for verifying Google ID tokens)
│   │   └── mailer.js        # Nodemailer transporter
│   ├── models/
│   │   └── User.js          # User schema (local + google auth, OTP fields)
│   ├── services/
│   │   ├── auth.service.js  # Core business logic (signup, login, OTP, reset, google)
│   │   └── email.service.js # Email sending + templates
│   ├── controllers/
│   │   └── auth.controller.js  # Request/response layer, cookie handling
│   ├── middlewares/
│   │   ├── auth.middleware.js     # `protect` - verifies access token
│   │   ├── validate.middleware.js # express-validator rules
│   │   └── error.middleware.js    # 404 + centralized error handler
│   ├── routes/
│   │   ├── auth.routes.js   # /api/auth/* routes
│   │   └── index.js         # route aggregator
│   ├── utils/
│   │   ├── ApiError.js
│   │   ├── asyncHandler.js
│   │   ├── otp.js            # OTP generation/hashing
│   │   └── token.js          # JWT generation/verification
│   ├── app.js                # Express app (middleware, routes)
│   └── server.js             # Entry point (connects DB, starts server)
├── .env.example
├── .gitignore
└── package.json
```

## How auth works here

### 1. Email + Password signup
- `POST /api/auth/signup` → creates user (unverified), sends a 6-digit OTP to their email
- `POST /api/auth/verify-email` → verifies OTP, marks `isEmailVerified: true`, logs the user in (issues tokens)
- `POST /api/auth/resend-otp` → sends a fresh OTP if the old one expired

### 2. Login
- `POST /api/auth/login` → checks password, blocks login if email isn't verified yet
- On success, sets `accessToken` (15 min) and `refreshToken` (30 days) as **httpOnly cookies**, and also returns `accessToken` in the JSON body (useful for mobile apps / Postman where cookies are inconvenient)

### 3. Google Login (via Firebase)
This project does **not** do Google OAuth manually. Instead:
- **Frontend** uses Firebase Client SDK to show the Google sign-in popup and get a Firebase `idToken`
- Frontend sends that `idToken` to `POST /api/auth/google`
- **Backend** verifies the token using Firebase Admin SDK (`src/config/firebase.js`) and either creates a new user or links/logs in the existing one
- Google-authenticated users are auto-marked `isEmailVerified: true` (Google already verified it)

### 4. Forgot / Reset Password
- `POST /api/auth/forgot-password` → sends OTP (always responds with a generic success message, even if the email doesn't exist, to prevent user enumeration)
- `POST /api/auth/reset-password` → verifies OTP + sets new password

### 5. Sessions
- Access token: short-lived (15 min), used to authenticate requests via `protect` middleware
- Refresh token: long-lived (30 days), its **hash** is stored in the DB so it can be invalidated on logout
- `POST /api/auth/refresh-token` → issues a new access token using a valid refresh token
- `POST /api/auth/logout` → clears cookies + invalidates the stored refresh token hash

## Setup

```bash
npm install
cp .env.example .env   # then fill in real values
npm run dev
```

### MongoDB
Create a free cluster at MongoDB Atlas, get the connection string, put it in `MONGO_URI`.

### Email (OTP + reset emails)
Easiest: use a Gmail address + an **App Password** (not your real password) for `SMTP_USER`/`SMTP_PASS`.
For production, prefer a transactional email provider (Resend, SendGrid, Postmark) with their SMTP creds.

### Firebase (Google login)
1. Create a Firebase project at https://console.firebase.google.com
2. Enable **Google** sign-in under Authentication > Sign-in method
3. Go to Project Settings > Service Accounts > Generate new private key → downloads a JSON file
4. Copy `project_id`, `client_email`, and `private_key` from that JSON into your `.env`
5. On the **frontend**, initialize Firebase Client SDK, use `signInWithPopup(auth, googleProvider)`, get `await result.user.getIdToken()`, and POST it to `/api/auth/google`

## API Endpoints

| Method | Endpoint                   | Auth required | Description                          |
|--------|-----------------------------|----------------|---------------------------------------|
| POST   | /api/auth/signup             | No             | Register with email/password          |
| POST   | /api/auth/verify-email       | No             | Verify OTP sent after signup           |
| POST   | /api/auth/resend-otp         | No             | Resend verification OTP                |
| POST   | /api/auth/login               | No             | Login with email/password             |
| POST   | /api/auth/google              | No             | Login/signup via Google (Firebase ID token) |
| POST   | /api/auth/forgot-password     | No             | Request password reset OTP             |
| POST   | /api/auth/reset-password      | No             | Reset password using OTP               |
| POST   | /api/auth/refresh-token        | No (needs refresh cookie) | Get a new access token   |
| POST   | /api/auth/logout               | Yes            | Logout, invalidate refresh token       |
| GET    | /api/auth/me                    | Yes            | Get current logged-in user             |

## Notes / next steps
- Add `helmet`-level CSP config once you know your frontend domains
- Consider adding account lockout after N failed login attempts (currently only OTP attempts are capped)

---

# Part 2: Bots, RAG, and Billing

## New folder additions

```
src/
├── models/
│   ├── Plan.js           # subscription plans, dual currency pricing (INR + USD)
│   ├── Subscription.js   # user's active/past plan purchases via Razorpay
│   ├── Bot.js             # a user's chatbot (API keys, LLM config, widget config)
│   ├── Document.js        # a source of RAG data (text/url) added to a bot
│   ├── Chunk.js            # a chunked, embedded piece of a document
│   └── Conversation.js      # per-visitor chat history (for context + analytics)
├── services/
│   ├── embedding.service.js   # generates vectors via Ollama (free) or OpenAI (BYOK)
│   ├── llm.service.js          # streaming chat completions: Ollama / OpenAI / Anthropic
│   ├── rag.service.js           # chunking, ingestion, retrieval, prompt building
│   ├── urlLoader.service.js      # fetches + cleans text from a URL for ingestion
│   ├── bot.service.js             # bot creation, plan limit checks, BYOK key storage
│   └── razorpay.service.js         # order creation, signature verification (INR/USD)
├── controllers/
│   ├── bot.controller.js       # dashboard: create/manage bots (user JWT auth)
│   ├── document.controller.js  # public API: add/update/delete RAG data (secret key auth)
│   ├── chat.controller.js       # public API: streaming RAG chat (public key auth, SSE)
│   ├── plan.controller.js        # list plans
│   └── payment.controller.js      # Razorpay order/verify/webhook
├── middlewares/
│   └── botAuth.middleware.js   # validates bot secret key / public key on incoming requests
├── routes/
│   ├── bot.routes.js      # /api/bots/*        (user JWT)
│   ├── plan.routes.js     # /api/plans          (public)
│   ├── payment.routes.js  # /api/payments/*     (user JWT, except webhook)
│   └── public.routes.js   # /api/v1/*           (bot secret/public key — this is YOUR product's public API)
└── scripts/
    └── seedPlans.js       # run once to create Free/Starter/Pro plans
```

## How the RAG + bots system works

### 1. Creating a bot
`POST /api/bots` (user JWT) → creates a `Bot` with:
- a **public key** (`pk_...`) — safe to expose in the embed widget's client-side JS
- a **secret key** (`sk_...`) — shown once, used for the data-management API
- default `llmConfig`/`embeddingConfig` pointing at **Ollama** (free, self-hosted)

### 2. Feeding it data (your "update the data" API)
This is the public developer-facing API, authenticated with the bot's **secret key**:

```
POST   /api/v1/documents        Authorization: Bearer sk_xxxxx
GET    /api/v1/documents
GET    /api/v1/documents/:id
PUT    /api/v1/documents/:id    (replaces content, re-chunks, re-embeds)
DELETE /api/v1/documents/:id
```

`POST /api/v1/documents` body:
```json
{ "sourceType": "text", "title": "Refund Policy", "text": "..." }
```
or
```json
{ "sourceType": "url", "url": "https://example.com/faq" }
```

Behind the scenes (`rag.service.js`):
1. Text is split into ~1500-char overlapping chunks (`textSplitter.js`)
2. Each chunk is embedded via Ollama (`nomic-embed-text`, free) or OpenAI if the bot has a BYOK embedding key
3. Chunks + their vectors are stored in the `Chunk` collection, scoped by `bot`
4. Ingestion runs in the background so the API responds immediately with `status: "processing"`, flipping to `"ready"` once done

> **Retrieval note:** this uses brute-force cosine similarity across a bot's chunks (fine up to tens of thousands of chunks). For larger scale, swap in **MongoDB Atlas Vector Search**, **Pinecone**, or **Qdrant** — only `rag.service.js`'s retrieval function needs to change.

### 3. The embeddable chat widget's API
Authenticated with the bot's **public key** (safe for client-side use), streams via **Server-Sent Events**:

```
POST /api/v1/chat
Headers: x-api-key: pk_xxxxx
Body: { "message": "What's your refund policy?", "sessionId": "optional-existing-session" }
```

The response is an SSE stream:
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

Flow inside `chat.controller.js`: embed the query → retrieve top-5 relevant chunks (cosine similarity, min score 0.3) → build a system prompt with that context + last 10 messages of conversation history → stream from the bot's configured LLM provider → save the exchange to `Conversation`.

### 4. Free (Ollama) vs BYOK models
Every bot defaults to `llmConfig.provider = "ollama"` and `embeddingConfig.provider = "ollama"` — completely free, but requires **you** to run an Ollama server and set `OLLAMA_BASE_URL` in `.env`. Pull the models first:
```bash
ollama pull llama3.1
ollama pull nomic-embed-text
```

Users can switch to their own key:
```
POST /api/bots/:id/model-config
{ "type": "llm", "provider": "openai", "model": "gpt-4o-mini", "apiKey": "sk-..." }
```
Keys are AES-256-GCM encrypted at rest (`utils/crypto.js`) using `ENCRYPTION_KEY`, and only decrypted in-memory right before the API call.

## Plans & Limits

Three seeded plans (`npm run seed:plans`): **Free**, **Starter**, **Pro** — each with `maxBots`, `maxDocumentsPerBot`, `maxMessagesPerMonth`, and `allowedProviders`. Limits are enforced in `bot.service.js` (bot/message caps) and `document.controller.js` (document caps) by checking the user's currently active `Subscription`, falling back to the `free` plan if none exists.

## Billing with Razorpay (INR + USD)

`Plan.price` stores **both** `inr` (paise) and `usd` (cents) so the same plan can be sold in either currency.

```
GET  /api/plans?currency=usd          → returns USD pricing
GET  /api/plans?currency=inr          → returns INR pricing (default)
POST /api/payments/create-order       { planId, currency: "inr"|"usd" }
POST /api/payments/verify             { razorpay_order_id, razorpay_payment_id, razorpay_signature }
POST /api/payments/webhook            (Razorpay server-to-server, raw body + signature verified)
GET  /api/payments/my-subscription
```

**Frontend checkout flow:**
1. Call `create-order` → get `orderId`, `amount`, `currency`, `razorpayKeyId`
2. Open Razorpay Checkout (`razorpay-checkout.js`) with those values
3. On success, Razorpay gives you `razorpay_payment_id` + `razorpay_signature` → POST them to `/verify`
4. Also configure the webhook URL in your Razorpay dashboard pointing at `/api/payments/webhook` as a reliability fallback in case step 3 never fires (browser closed, network drop, etc.)

⚠️ **USD note:** Razorpay's core product is INR-first. Accepting USD requires **international payments** enabled on your Razorpay business account (eligibility depends on your business type/country). Until that's approved, default `currency` to `"inr"` for all users and only expose the USD option once your account supports it — otherwise `create-order` calls with `currency: "usd"` will fail at Razorpay's end.

## Setup additions

```bash
# 1. Generate an encryption key for BYOK storage
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# paste into ENCRYPTION_KEY in .env

# 2. Install & run Ollama locally (or point OLLAMA_BASE_URL at a remote server)
ollama pull llama3.1
ollama pull nomic-embed-text

# 3. Seed the default plans
npm run seed:plans

# 4. Add Razorpay test keys to .env (from Razorpay Dashboard > Settings > API Keys)
```

## Full API reference (Part 2)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | /api/bots | User JWT | Create a bot (returns secret key once) |
| GET | /api/bots | User JWT | List your bots |
| GET | /api/bots/:id | User JWT | Get one bot |
| PATCH | /api/bots/:id | User JWT | Update name/prompt/widget config/domains |
| DELETE | /api/bots/:id | User JWT | Delete a bot + its data |
| POST | /api/bots/:id/regenerate-key | User JWT | Rotate the secret key |
| POST | /api/bots/:id/model-config | User JWT | Set BYOK LLM/embedding provider + key |
| GET | /api/plans | No | List plans (`?currency=inr|usd`) |
| POST | /api/payments/create-order | User JWT | Create a Razorpay order |
| POST | /api/payments/verify | User JWT | Verify payment, activate subscription |
| POST | /api/payments/webhook | Razorpay signature | Server-to-server payment events |
| GET | /api/payments/my-subscription | User JWT | Get current active subscription |
| POST | /api/v1/documents | Bot secret key | Add RAG data (text or URL) |
| GET | /api/v1/documents | Bot secret key | List documents |
| GET | /api/v1/documents/:id | Bot secret key | Get one document (incl. raw text) |
| PUT | /api/v1/documents/:id | Bot secret key | Replace content, re-embed |
| DELETE | /api/v1/documents/:id | Bot secret key | Remove a document + its chunks |
| POST | /api/v1/chat | Bot public key | Streaming RAG chat (SSE) |

## Still to build
- Dashboard frontend (this backend is now feature-complete for it)

---

# Part 3: Admin, Model Options, Billing Fixes, Testing

## Admin accounts (no limits)
```bash
npm run make:admin someone@example.com   # promotes an existing user to role: "admin"
```
Admins bypass every plan limit (`maxBots`, `maxDocumentsPerBot`, `maxMessagesPerMonth`) automatically — `bot.service.js`'s `getActivePlan` returns a synthetic unlimited plan for any user with `role: "admin"`, checked before looking at Subscriptions at all.

Admin API (`/api/admin/*`, requires `protect` + `requireAdmin`):
| Method | Endpoint | Description |
|---|---|---|
| GET | /api/admin/overview | Total users, bots, documents, active subs, MRR (INR+USD separately) |
| GET | /api/admin/users | Paginated user list, `?search=` |
| PATCH | /api/admin/users/:id/role | Promote/demote a user |
| PATCH | /api/admin/users/:id/suspend | Deactivate/reactivate all of a user's bots |
| GET | /api/admin/bots | All bots across all users |
| GET | /api/admin/subscriptions | All subscriptions, `?status=active` |

## All model options
`src/config/modelRegistry.js` is the single source of truth for every supported provider/model combination — `GET /api/models` exposes it so the frontend can build dropdowns without hardcoding anything.

**LLMs:** Ollama (free), OpenAI, Anthropic, Google Gemini, Groq, Mistral
**Embeddings:** Ollama (free), OpenAI, Google

## The embedding-switch bug — properly fixed
Each bot now locks in the vector dimension its data is stored under (`embeddingConfig.lockedDimension`), set automatically the first time it ingests anything. If you try to switch to a provider/model with a **different** dimension while the bot already has documents, `POST /api/bots/:id/model-config` returns **409** with a clear explanation instead of silently corrupting retrieval. Resend the same request with `confirmReembed: true` and it automatically re-embeds every existing document under the new model in the background (`ragService.reembedAllDocuments`).

## Bot testing (playground)
`POST /api/bots/:id/test-chat` — owner-only (dashboard JWT, not the public key), streams the full RAG pipeline **and** shows which chunks were retrieved with their similarity scores. Does not count against the plan's monthly message quota — that's only for real traffic through `/api/v1/chat`.

## Upgrade billing: per-day proration + upgrade discount
`src/services/billing.service.js` — when a user upgrades mid-cycle:
1. **Proration**: unused days on their current plan become a credit (`oldPlan.amount / 30 * daysRemaining`) applied against the new plan's price
2. **Upgrade discount**: an additional 10% off, but *only* if this is a genuine upgrade from an existing active paid plan — first-time purchases pay full list price
3. Full breakdown (`listPrice`, `proratedCredit`, `upgradeDiscount`, `amountCharged`) is returned from `create-order` and stored on the `Subscription` record for audit

Also added `POST /api/payments/cancel` — cancels auto-renewal but access continues until the already-paid `endDate` (fixed a bug during development where this would have cut access off immediately instead).

## Testing
```bash
npm run test:unit    # fast, no DB needed - chunking + cosine similarity logic
npm test              # full suite - needs network access (or a local mongod) for mongodb-memory-server
```
Full suite covers: signup/OTP/login flow, plan-limit enforcement (Free plan capped at 1 bot), **admin bypass** (unlimited bots), bot ownership isolation (can't access another user's bot), and the proration math (verified against hand-calculated expected credit/discount ranges).

> Note: `npm test` needs to download a real MongoDB binary the first time (via `mongodb-memory-server`) — if you're offline or behind a firewall that blocks `fastdl.mongodb.org`, run `npm run test:unit` instead, or point `MONGO_URI` at a real local MongoDB and adjust `tests/globalSetup.js` accordingly.

## Account settings (password change, account deletion)
- `POST /api/auth/change-password` — requires the current password, hashes and saves the new one, invalidates the stored refresh token hash (so other sessions get logged out on their next refresh) and clears cookies on this request too, forcing a fresh login. Sends a confirmation email.
- `POST /api/auth/add-password` — for Google-only accounts that want to *also* be able to log in with email/password. Fails if a password already exists.
- `DELETE /api/auth/account` — permanently deletes the user and cascades through every resource they own: all bots, all documents, all chunks (embeddings), all conversations, all subscriptions. Requires an explicit `{ "confirm": "DELETE" }` in the body as a guard against accidental calls from buggy frontend code. Sends a confirmation email.

## Full API reference (Part 3 additions)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | /api/models | No | List every supported LLM/embedding provider+model |
| POST | /api/bots/:id/test-chat | User JWT (owner) | Streaming test chat, shows retrieved chunks + scores |
| POST | /api/payments/cancel | User JWT | Cancel auto-renewal, keep access until period end |
| GET | /api/admin/overview | Admin | Platform-wide stats |
| GET | /api/admin/users | Admin | List all users |
| PATCH | /api/admin/users/:id/role | Admin | Change a user's role |
| PATCH | /api/admin/users/:id/suspend | Admin | Suspend/unsuspend a user's bots |
| GET | /api/admin/bots | Admin | List all bots platform-wide |
| GET | /api/admin/subscriptions | Admin | List all subscriptions |
| POST | /api/auth/change-password | User JWT | Change password (requires current password, clears cookies to force re-login) |
| POST | /api/auth/add-password | User JWT | Add a password to a Google-only account |
| DELETE | /api/auth/account | User JWT | Permanently delete account + all owned bots/documents/chunks/conversations/subscriptions (requires `{ "confirm": "DELETE" }`) |
