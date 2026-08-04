// Run with: node src/scripts/seedPlans.js
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Plan = require("../models/Plan");

const plans = [
  {
    name: "Free",
    slug: "free",
    description: "Get started with a single bot using the free Ollama model",
    price: { inr: 0, usd: 0 },
    interval: "month",
    limits: {
      maxBots: 1,
      maxDocumentsPerBot: 5,
      maxMessagesPerMonth: 100,
      allowUserOwnApiKey: true,
      allowedProviders: ["ollama"],
    },
    sortOrder: 1,
  },
  {
    name: "Starter",
    slug: "starter",
    description: "For small projects that need more bots and higher limits",
    price: { inr: 79900, usd: 999 }, // ₹799/mo, $9.99/mo (in paise/cents)
    interval: "month",
    limits: {
      maxBots: 5,
      maxDocumentsPerBot: 50,
      maxMessagesPerMonth: 2000,
      allowUserOwnApiKey: true,
      allowedProviders: ["ollama", "openai", "anthropic"],
    },
    sortOrder: 2,
  },
  {
    name: "Pro",
    slug: "pro",
    description: "For businesses running multiple bots at scale",
    price: { inr: 249900, usd: 2999 }, // ₹2499/mo, $29.99/mo
    interval: "month",
    limits: {
      maxBots: 25,
      maxDocumentsPerBot: 500,
      maxMessagesPerMonth: 20000,
      allowUserOwnApiKey: true,
      allowedProviders: ["ollama", "openai", "anthropic"],
    },
    sortOrder: 3,
  },
];

const run = async () => {
  await connectDB();

  for (const plan of plans) {
    await Plan.findOneAndUpdate({ slug: plan.slug }, plan, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });
    console.log(`Upserted plan: ${plan.name}`);
  }

  console.log("Done seeding plans.");
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
