const { connectTestDB, clearTestDB, closeTestDB } = require("../testApp");
const mongoose = require("mongoose");
const User = require("../../src/models/User");
const Plan = require("../../src/models/Plan");
const Subscription = require("../../src/models/Subscription");
const billingService = require("../../src/services/billing.service");

beforeAll(async () => {
  await connectTestDB();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await closeTestDB();
});

const makeUser = async () => User.create({ name: "Billing Test", email: `b${Date.now()}${Math.random()}@x.com`, password: "hashed", isEmailVerified: true });

describe("billing.service.computeCharge", () => {
  test("first-time purchase: full price, no credit, no discount", async () => {
    const user = await makeUser();
    const plan = await Plan.create({
      name: "Starter",
      slug: `starter-${Date.now()}`,
      price: { inr: 79900, usd: 999 },
      interval: "month",
      limits: { maxBots: 5, maxDocumentsPerBot: 50, maxMessagesPerMonth: 2000, allowedProviders: ["ollama"] },
    });

    const charge = await billingService.computeCharge({ userId: user._id, newPlan: plan, currency: "inr" });

    expect(charge.isUpgrade).toBe(false);
    expect(charge.proratedCredit).toBe(0);
    expect(charge.discountApplied).toBe(0);
    expect(charge.chargeAmount).toBe(79900);
  });

  test("upgrade mid-cycle: unused days are credited, then 10% off the remainder", async () => {
    const user = await makeUser();

    const oldPlan = await Plan.create({
      name: "Starter",
      slug: `starter-${Date.now()}`,
      price: { inr: 30000, usd: 400 }, // ₹300/mo
      interval: "month",
      limits: { maxBots: 5, maxDocumentsPerBot: 50, maxMessagesPerMonth: 2000, allowedProviders: ["ollama"] },
    });
    const newPlan = await Plan.create({
      name: "Pro",
      slug: `pro-${Date.now()}`,
      price: { inr: 90000, usd: 1200 }, // ₹900/mo
      interval: "month",
      limits: { maxBots: 25, maxDocumentsPerBot: 500, maxMessagesPerMonth: 20000, allowedProviders: ["ollama"] },
    });

    // Simulate: user is exactly 15 days into a 30-day cycle on the old plan
    const now = new Date();
    const startDate = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
    const endDate = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);

    await Subscription.create({
      user: user._id,
      plan: oldPlan._id,
      currency: "inr",
      amount: 30000,
      status: "active",
      startDate,
      endDate,
    });

    const charge = await billingService.computeCharge({ userId: user._id, newPlan, currency: "inr" });

    // Old plan: ₹300/mo = 1000 paise/day (30-day cycle approximation). 15 days
    // remaining -> credit ≈ 15000 paise (₹150)
    expect(charge.proratedCredit).toBeGreaterThan(14000);
    expect(charge.proratedCredit).toBeLessThan(16000);

    // New plan full price 90000, minus ~15000 credit = ~75000, then -10% upgrade discount
    expect(charge.isUpgrade).toBe(true);
    expect(charge.discountApplied).toBeGreaterThan(0);
    expect(charge.chargeAmount).toBeLessThan(90000 - charge.proratedCredit); // discount actually reduced it further
    expect(charge.chargeAmount).toBeGreaterThan(0);
  });

  test("charge never goes negative even with a huge credit", async () => {
    const user = await makeUser();
    const oldPlan = await Plan.create({
      name: "Pro",
      slug: `pro-${Date.now()}`,
      price: { inr: 500000, usd: 6000 },
      interval: "month",
      limits: { maxBots: 25, maxDocumentsPerBot: 500, maxMessagesPerMonth: 20000, allowedProviders: ["ollama"] },
    });
    const cheaperPlan = await Plan.create({
      name: "Starter",
      slug: `starter-${Date.now()}`,
      price: { inr: 10000, usd: 200 },
      interval: "month",
      limits: { maxBots: 5, maxDocumentsPerBot: 50, maxMessagesPerMonth: 2000, allowedProviders: ["ollama"] },
    });

    await Subscription.create({
      user: user._id,
      plan: oldPlan._id,
      currency: "inr",
      amount: 500000,
      status: "active",
      startDate: new Date(),
      endDate: new Date(Date.now() + 29 * 24 * 60 * 60 * 1000), // almost the full cycle still remaining
    });

    const charge = await billingService.computeCharge({ userId: user._id, newPlan: cheaperPlan, currency: "inr" });
    expect(charge.chargeAmount).toBeGreaterThanOrEqual(0);
  });
});
