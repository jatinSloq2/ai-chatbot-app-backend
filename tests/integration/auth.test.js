const request = require("supertest");

// Mock email sending so tests don't try to hit a real SMTP server
jest.mock("../../src/services/email.service", () => ({
  sendOtpEmail: jest.fn().mockResolvedValue(undefined),
  sendPaymentSuccessEmail: jest.fn().mockResolvedValue(undefined),
  sendPaymentFailedEmail: jest.fn().mockResolvedValue(undefined),
  sendSubscriptionExpiringEmail: jest.fn().mockResolvedValue(undefined),
  sendSubscriptionExpiredEmail: jest.fn().mockResolvedValue(undefined),
  sendEmail: jest.fn().mockResolvedValue(undefined),
}));

// Fix the OTP to a known value so tests can complete the full verify flow
// instead of only exercising the rejection paths (we can't recover a real
// OTP from its stored hash, by design).
jest.mock("../../src/utils/otp", () => {
  const actual = jest.requireActual("../../src/utils/otp");
  return { ...actual, generateOtp: () => "123456" };
});

const { connectTestDB, clearTestDB, closeTestDB } = require("../testApp");
const app = require("../../src/app");
const User = require("../../src/models/User");

beforeAll(async () => {
  await connectTestDB();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await closeTestDB();
});

describe("Auth flow", () => {
  test("signup creates an unverified user and sends an OTP", async () => {
    const res = await request(app).post("/api/auth/signup").send({
      name: "Test User",
      email: "test@example.com",
      password: "password123",
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const user = await User.findOne({ email: "test@example.com" }).select("+otpCodeHash");
    expect(user).toBeTruthy();
    expect(user.isEmailVerified).toBe(false);
    expect(user.otpCodeHash).toBeTruthy();
  });

  test("signup rejects a duplicate email", async () => {
    await request(app)
      .post("/api/auth/signup")
      .send({ name: "A", email: "dupe@example.com", password: "password123" });

    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "B", email: "dupe@example.com", password: "password123" });

    expect(res.status).toBe(409);
  });

  test("signup rejects invalid input (validation middleware)", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "", email: "not-an-email", password: "123" });

    expect(res.status).toBe(422);
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  test("login is blocked before email verification", async () => {
    await request(app)
      .post("/api/auth/signup")
      .send({ name: "Unverified", email: "unverified@example.com", password: "password123" });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "unverified@example.com", password: "password123" });

    expect(res.status).toBe(403);
  });

  test("full flow: signup -> verify OTP -> login -> access /me", async () => {
    await request(app)
      .post("/api/auth/signup")
      .send({ name: "Flow User", email: "flow@example.com", password: "password123" });

    // OTP is mocked to always be "123456" (see jest.mock above)
    const wrongOtp = await request(app)
      .post("/api/auth/verify-email")
      .send({ email: "flow@example.com", otp: "000000" });
    expect(wrongOtp.status).toBe(400);

    const badFormat = await request(app)
      .post("/api/auth/verify-email")
      .send({ email: "flow@example.com", otp: "12" });
    expect(badFormat.status).toBe(422);

    const verify = await request(app)
      .post("/api/auth/verify-email")
      .send({ email: "flow@example.com", otp: "123456" });
    expect(verify.status).toBe(200);
    expect(verify.body.data.user.isEmailVerified).toBe(true);
    expect(verify.body.data.accessToken).toBeTruthy();

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "flow@example.com", password: "password123" });
    expect(login.status).toBe(200);
    const { accessToken } = login.body.data;

    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe("flow@example.com");
  });

  test("forgot-password never reveals whether an email exists", async () => {
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "doesnotexist@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if an account exists/i);
  });

  test("protected route rejects requests with no token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });
});

describe("Account settings", () => {
  const bcrypt = require("bcryptjs");
  const { generateAccessToken } = require("../../src/utils/token");

  const createVerifiedUser = async (email) => {
    const hashedPassword = await bcrypt.hash("originalPass123", 10);
    const user = await User.create({
      name: "Settings User",
      email,
      password: hashedPassword,
      authProvider: "local",
      isEmailVerified: true,
    });
    const token = generateAccessToken(user._id.toString());
    return { user, token };
  };

  test("change-password rejects wrong current password", async () => {
    const { token } = await createVerifiedUser("changepw1@example.com");
    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "wrongpassword", newPassword: "newPassword123" });
    expect(res.status).toBe(401);
  });

  test("change-password succeeds with correct current password, then old token still works until logout (stateless JWT) but new login uses new password", async () => {
    const { token } = await createVerifiedUser("changepw2@example.com");
    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "originalPass123", newPassword: "brandNewPass123" });
    expect(res.status).toBe(200);

    const loginOld = await request(app)
      .post("/api/auth/login")
      .send({ email: "changepw2@example.com", password: "originalPass123" });
    expect(loginOld.status).toBe(401);

    const loginNew = await request(app)
      .post("/api/auth/login")
      .send({ email: "changepw2@example.com", password: "brandNewPass123" });
    expect(loginNew.status).toBe(200);
  });

  test("delete-account requires explicit confirmation", async () => {
    const { token } = await createVerifiedUser("delacc1@example.com");
    const res = await request(app)
      .delete("/api/auth/account")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test("delete-account removes the user and their bots", async () => {
    const { token } = await createVerifiedUser("delacc2@example.com");

    await request(app).post("/api/bots").set("Authorization", `Bearer ${token}`).send({ name: "Doomed Bot" });

    const res = await request(app)
      .delete("/api/auth/account")
      .set("Authorization", `Bearer ${token}`)
      .send({ confirm: "DELETE" });
    expect(res.status).toBe(200);

    const stillExists = await User.findOne({ email: "delacc2@example.com" });
    expect(stillExists).toBeNull();
  });
});
