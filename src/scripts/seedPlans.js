// Run with: node src/scripts/seedPlans.js

require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Plan = require("../models/Plan");

// Discount applied to the effective monthly rate for longer commitments.
const QUARTER_DISCOUNT = 0.10; // ~10% off vs paying month-to-month for 3 months
const YEAR_DISCOUNT = 0.20; // ~20% off vs paying month-to-month for 12 months

const plans = [
  {
    name: "Free",
    slug: "free",
    description:
      "Get started with a single bot using your own API key (OpenAI, Anthropic, Gemini, Groq, or Mistral)",
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
      allowWhatsApp: false,
      allowTools: false,
    },
    sortOrder: 1,
  },

  // --- Starter ---
  {
    name: "Starter",
    slug: "starter",
    description: "For small projects that need more bots and higher limits",
    price: { inr: 14900, usd: 499 }, // ₹149/mo, $4.99/mo
    interval: "month",
    limits: {
      maxBots: 5,
      maxDocumentsPerBot: 50,
      maxMessagesPerMonth: 2000,
      allowUserOwnApiKey: true,
      allowedProviders: [
        "ollama",
        "openai",
        "anthropic",
        "google",
        "groq",
        "mistral",
      ],
      maxAgents: 2,
      maxTeams: 1,
      maxAgentsPerTeam: 2,
      hideWatermark: true,
      allowWhatsApp: true,
      allowTools: true,
    },
    sortOrder: 2,
  },

  {
    name: "Starter",
    slug: "starter-quarterly",
    description:
      "For small projects that need more bots and higher limits — billed every 3 months",
    price: {
      inr: Math.round(14900 * 3 * (1 - QUARTER_DISCOUNT) / 100) * 100,
      usd: Math.round(499 * 3 * (1 - QUARTER_DISCOUNT)),
    },
    interval: "quarter",
    limits: {
      maxBots: 5,
      maxDocumentsPerBot: 50,
      maxMessagesPerMonth: 2000,
      allowUserOwnApiKey: true,
      allowedProviders: [
        "ollama",
        "openai",
        "anthropic",
        "google",
        "groq",
        "mistral",
      ],
      maxAgents: 2,
      maxTeams: 1,
      maxAgentsPerTeam: 2,
      hideWatermark: true,
      allowWhatsApp: true,
      allowTools: true,
    },
    sortOrder: 2,
  },

  {
    name: "Starter",
    slug: "starter-yearly",
    description:
      "For small projects that need more bots and higher limits — billed annually",
    price: {
      inr: Math.round(14900 * 12 * (1 - YEAR_DISCOUNT) / 100) * 100,
      usd: Math.round(499 * 12 * (1 - YEAR_DISCOUNT)),
    },
    interval: "year",
    limits: {
      maxBots: 5,
      maxDocumentsPerBot: 50,
      maxMessagesPerMonth: 2000,
      allowUserOwnApiKey: true,
      allowedProviders: [
        "ollama",
        "openai",
        "anthropic",
        "google",
        "groq",
        "mistral",
      ],
      maxAgents: 2,
      maxTeams: 1,
      maxAgentsPerTeam: 2,
      hideWatermark: true,
      allowWhatsApp: true,
      allowTools: true,
    },
    sortOrder: 2,
  },

  // --- Pro ---
  {
    name: "Pro",
    slug: "pro",
    description: "For businesses running multiple bots at scale",
    price: { inr: 34900, usd: 999 }, // ₹349/mo, $9.99/mo
    interval: "month",
    limits: {
      maxBots: 25,
      maxDocumentsPerBot: 500,
      maxMessagesPerMonth: 20000,
      allowUserOwnApiKey: true,
      allowedProviders: [
        "ollama",
        "openai",
        "anthropic",
        "google",
        "groq",
        "mistral",
      ],
      maxAgents: 10,
      maxTeams: 5,
      maxAgentsPerTeam: 10,
      hideWatermark: true,
      allowWhatsApp: true,
      allowTools: true,
    },
    sortOrder: 3,
  },

  {
    name: "Pro",
    slug: "pro-quarterly",
    description:
      "For businesses running multiple bots at scale — billed every 3 months",
    price: {
      inr: Math.round(34900 * 3 * (1 - QUARTER_DISCOUNT) / 100) * 100,
      usd: Math.round(999 * 3 * (1 - QUARTER_DISCOUNT)),
    },
    interval: "quarter",
    limits: {
      maxBots: 25,
      maxDocumentsPerBot: 500,
      maxMessagesPerMonth: 20000,
      allowUserOwnApiKey: true,
      allowedProviders: [
        "ollama",
        "openai",
        "anthropic",
        "google",
        "groq",
        "mistral",
      ],
      maxAgents: 10,
      maxTeams: 5,
      maxAgentsPerTeam: 10,
      hideWatermark: true,
      allowWhatsApp: true,
      allowTools: true,
    },
    sortOrder: 3,
  },

  {
    name: "Pro",
    slug: "pro-yearly",
    description:
      "For businesses running multiple bots at scale — billed annually",
    price: {
      inr: Math.round(34900 * 12 * (1 - YEAR_DISCOUNT) / 100) * 100,
      usd: Math.round(999 * 12 * (1 - YEAR_DISCOUNT)),
    },
    interval: "year",
    limits: {
      maxBots: 25,
      maxDocumentsPerBot: 500,
      maxMessagesPerMonth: 20000,
      allowUserOwnApiKey: true,
      allowedProviders: [
        "ollama",
        "openai",
        "anthropic",
        "google",
        "groq",
        "mistral",
      ],
      maxAgents: 10,
      maxTeams: 5,
      maxAgentsPerTeam: 10,
      hideWatermark: true,
      allowWhatsApp: true,
      allowTools: true,
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
