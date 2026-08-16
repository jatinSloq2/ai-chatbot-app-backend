// Run with: node src/scripts/seedPlans.js
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Plan = require("../models/Plan");

// Discount applied to the effective monthly rate for longer commitments —
// same percentages across Starter and Pro so the "why upgrade the interval"
// story is consistent. Quarter/year prices below are the monthly price run
// through this discount and multiplied out, then rounded to a clean number.
const QUARTER_DISCOUNT = 0.10; // ~10% off vs paying month-to-month for 3 months
const YEAR_DISCOUNT = 0.20; // ~20% off vs paying month-to-month for 12 months

const plans = [
  {
    name: "Free",
    slug: "free",
    // Ollama runs on our own infrastructure — every request has a real
    // compute cost to us, so it's no longer part of the Free plan. Free
    // users can still run a bot at zero cost by bringing their own key for
    // any BYOK provider (OpenAI, Anthropic, Google Gemini, Groq, Mistral —
    // allowUserOwnApiKey is true on every plan, and none of these need a
    // plan-level allowedProviders check since the user supplies the key).
    description: "Get started with a single bot using your own API key (OpenAI, Anthropic, Gemini, Groq, or Mistral)",
    price: { inr: 0, usd: 0 },
    interval: "month",
    limits: {
      maxBots: 1,
      maxDocumentsPerBot: 5,
      maxMessagesPerMonth: 100,
      allowUserOwnApiKey: true,
      allowedProviders: ["openai", "anthropic", "google", "groq", "mistral"],
      maxAgents: 0,
      maxTeams: 0,
      maxAgentsPerTeam: 0,
      hideWatermark: false,
    },
    sortOrder: 1,
  },

  // --- Starter ---
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
      allowedProviders: ["ollama", "openai", "anthropic", "google", "groq", "mistral"],
      maxAgents: 2,
      maxTeams: 1,
      maxAgentsPerTeam: 2,
      hideWatermark: true,
    },
    sortOrder: 2,
  },
  {
    name: "Starter",
    slug: "starter-quarterly",
    description: "For small projects that need more bots and higher limits — billed every 3 months",
    price: {
      inr: Math.round(79900 * 3 * (1 - QUARTER_DISCOUNT) / 100) * 100,
      usd: Math.round(999 * 3 * (1 - QUARTER_DISCOUNT)),
    },
    interval: "quarter",
    limits: {
      maxBots: 5,
      maxDocumentsPerBot: 50,
      maxMessagesPerMonth: 2000,
      allowUserOwnApiKey: true,
      allowedProviders: ["ollama", "openai", "anthropic", "google", "groq", "mistral"],
      maxAgents: 2,
      maxTeams: 1,
      maxAgentsPerTeam: 2,
      hideWatermark: true,
    },
    sortOrder: 2,
  },
  {
    name: "Starter",
    slug: "starter-yearly",
    description: "For small projects that need more bots and higher limits — billed annually",
    price: {
      inr: Math.round(79900 * 12 * (1 - YEAR_DISCOUNT) / 100) * 100,
      usd: Math.round(999 * 12 * (1 - YEAR_DISCOUNT)),
    },
    interval: "year",
    limits: {
      maxBots: 5,
      maxDocumentsPerBot: 50,
      maxMessagesPerMonth: 2000,
      allowUserOwnApiKey: true,
      allowedProviders: ["ollama", "openai", "anthropic", "google", "groq", "mistral"],
      maxAgents: 2,
      maxTeams: 1,
      maxAgentsPerTeam: 2,
      hideWatermark: true,
    },
    sortOrder: 2,
  },

  // --- Pro ---
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
      allowedProviders: ["ollama", "openai", "anthropic", "google", "groq", "mistral"],
      maxAgents: 10,
      maxTeams: 5,
      maxAgentsPerTeam: 10,
      hideWatermark: true,
    },
    sortOrder: 3,
  },
  {
    name: "Pro",
    slug: "pro-quarterly",
    description: "For businesses running multiple bots at scale — billed every 3 months",
    price: {
      inr: Math.round(249900 * 3 * (1 - QUARTER_DISCOUNT) / 100) * 100,
      usd: Math.round(2999 * 3 * (1 - QUARTER_DISCOUNT)),
    },
    interval: "quarter",
    limits: {
      maxBots: 25,
      maxDocumentsPerBot: 500,
      maxMessagesPerMonth: 20000,
      allowUserOwnApiKey: true,
      allowedProviders: ["ollama", "openai", "anthropic", "google", "groq", "mistral"],
      maxAgents: 10,
      maxTeams: 5,
      maxAgentsPerTeam: 10,
      hideWatermark: true,
    },
    sortOrder: 3,
  },
  {
    name: "Pro",
    slug: "pro-yearly",
    description: "For businesses running multiple bots at scale — billed annually",
    price: {
      inr: Math.round(249900 * 12 * (1 - YEAR_DISCOUNT) / 100) * 100,
      usd: Math.round(2999 * 12 * (1 - YEAR_DISCOUNT)),
    },
    interval: "year",
    limits: {
      maxBots: 25,
      maxDocumentsPerBot: 500,
      maxMessagesPerMonth: 20000,
      allowUserOwnApiKey: true,
      allowedProviders: ["ollama", "openai", "anthropic", "google", "groq", "mistral"],
      maxAgents: 10,
      maxTeams: 5,
      maxAgentsPerTeam: 10,
      hideWatermark: true,
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
    console.log(`Upserted plan: ${plan.name} (${plan.slug})`);
  }

  console.log("Done seeding plans.");
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});