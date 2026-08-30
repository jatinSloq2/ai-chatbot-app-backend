// Run with: node src/scripts/seedAddOns.js
//
// Deliberately a flat list — every row here is sold as its own standalone
// item, not grouped under a "channel" or "messaging" category in the
// catalog itself (the UI is free to group them for display, but the model
// doesn't encode a category).
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const AddOn = require("../models/AddOn");

const addOns = [
  {
    name: "WhatsApp Inbox",
    slug: "whatsapp-inbox",
    description: "Unlock the WhatsApp Business inbox alongside your bot's existing channels — lifetime access.",
    price: { inr: 199900, usd: 2499 }, // ₹1999 / $24.99, one-time
    billingType: "lifetime",
    interval: null,
    limit: { amount: 10000, unit: "messages" },
    sampleSheetUrl: null,
    sortOrder: 1,
  },
  {
    name: "Template Messages — 10K",
    slug: "template-messages-10k",
    description: "10,000 WhatsApp Business API template messages (Utility, Marketing, and Authentication).",
    price: { inr: 49900, usd: 599 }, // ₹499 / $5.99
    billingType: "lifetime",
    interval: null,
    limit: { amount: 10000, unit: "messages" },
    sampleSheetUrl: null,
    sortOrder: 2,
  },
  {
    name: "Template Management",
    slug: "template-management",
    description: "Create and submit WhatsApp message templates for approval.",
    price: { inr: 29900, usd: 399 }, // ₹299 / $3.99, lifetime feature unlock
    billingType: "lifetime",
    interval: null,
    limit: { amount: null, unit: null },
    sampleSheetUrl: null,
    sortOrder: 3,
  },
  {
    name: "AI Template Builder",
    slug: "ai-template-builder",
    description: "AI-assisted drafting and formatting of WhatsApp message templates.",
    price: { inr: 49900, usd: 599 }, // ₹499 / $5.99, lifetime feature unlock
    billingType: "lifetime",
    interval: null,
    limit: { amount: null, unit: null },
    sampleSheetUrl: null,
    sortOrder: 4,
  },
];

const run = async () => {
  await connectDB();

  for (const addOn of addOns) {
    await AddOn.findOneAndUpdate({ slug: addOn.slug }, addOn, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });
    console.log(`Upserted add-on: ${addOn.name} (${addOn.slug})`);
  }

  console.log("Done seeding add-ons.");
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});