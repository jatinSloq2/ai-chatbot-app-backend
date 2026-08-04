jest.mock("../../src/services/email.service", () => ({
  sendOtpEmail: jest.fn().mockResolvedValue(undefined),
  sendPaymentSuccessEmail: jest.fn().mockResolvedValue(undefined),
  sendPaymentFailedEmail: jest.fn().mockResolvedValue(undefined),
  sendSubscriptionExpiringEmail: jest.fn().mockResolvedValue(undefined),
  sendSubscriptionExpiredEmail: jest.fn().mockResolvedValue(undefined),
  sendEmail: jest.fn().mockResolvedValue(undefined),
}));

const request = require("supertest");
const { connectTestDB, clearTestDB, closeTestDB } = require("../testApp");
const app = require("../../src/app");
const User = require("../../src/models/User");
const Plan = require("../../src/models/Plan");
const bcrypt = require("bcryptjs");
const { generateAccessToken } = require("../../src/utils/token");

beforeAll(async () => {
  await connectTestDB();
  // Minimal Free plan so bot.service.getActivePlan has something to fall back to
  await Plan.create({
    name: "Free",
    slug: "free",
    price: { inr: 0, usd: 0 },
    interval: "month",
    limits: {
      maxBots: 1,
      maxDocumentsPerBot: 5,
      maxMessagesPerMonth: 100,
      allowUserOwnApiKey: true,
      allowedProviders: ["ollama"],
    },
  });
});

afterAll(async () => {
  await closeTestDB();
});

// Creates a verified user directly in the DB (bypassing OTP) and returns a
// ready-to-use access token, for tests that only care about what happens
// *after* login.
const createVerifiedUserWithToken = async (email, role = "user") => {
  const hashedPassword = await bcrypt.hash("password123", 10);
  const user = await User.create({
    name: "Test",
    email,
    password: hashedPassword,
    authProvider: "local",
    isEmailVerified: true,
    role,
  });
  const token = generateAccessToken(user._id.toString());
  return { user, token };
};

describe("Plan limits", () => {
  test("a Free-plan user can create exactly 1 bot, then gets blocked", async () => {
    const { token } = await createVerifiedUserWithToken("freeuser@example.com");

    const first = await request(app)
      .post("/api/bots")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Bot One" });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/bots")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Bot Two" });
    expect(second.status).toBe(403);
    expect(second.body.message).toMatch(/maximum of 1 bot/i);
  });

  test("secret key is only returned once, at creation", async () => {
    const { token } = await createVerifiedUserWithToken("keyuser@example.com");

    const created = await request(app)
      .post("/api/bots")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Key Bot" });

    expect(created.body.data.secretKey).toMatch(/^sk_/);

    const listed = await request(app).get("/api/bots").set("Authorization", `Bearer ${token}`);
    expect(listed.body.data.bots[0].secretKey).toBeUndefined();
  });
});

describe("Admin bypass", () => {
  test("an admin user is not limited by the Free plan's maxBots", async () => {
    const { token } = await createVerifiedUserWithToken("admin@example.com", "admin");

    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post("/api/bots")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: `Admin Bot ${i}` });
      expect(res.status).toBe(201);
    }
  });

  test("non-admins are rejected from admin routes", async () => {
    const { token } = await createVerifiedUserWithToken("regular@example.com", "user");
    const res = await request(app).get("/api/admin/overview").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test("admins can access admin overview", async () => {
    const { token } = await createVerifiedUserWithToken("admin2@example.com", "admin");
    const res = await request(app).get("/api/admin/overview").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("totalUsers");
  });
});

describe("Bot ownership isolation", () => {
  test("a user cannot access another user's bot", async () => {
    const owner = await createVerifiedUserWithToken("owner@example.com");
    const intruder = await createVerifiedUserWithToken("intruder@example.com");

    const created = await request(app)
      .post("/api/bots")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ name: "Private Bot" });
    const botId = created.body.data.bot.id;

    const res = await request(app)
      .get(`/api/bots/${botId}`)
      .set("Authorization", `Bearer ${intruder.token}`);
    expect(res.status).toBe(404);
  });
});
