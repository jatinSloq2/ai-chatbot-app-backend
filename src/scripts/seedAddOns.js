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
    price: { inr: 499900, usd: 5999 }, // ₹4999 / $59.99, one-time
    billingType: "lifetime",
    interval: null,
    limit: { amount: 10000, unit: "messages" },
    sampleSheetUrl: null,
    sortOrder: 1,
  },
  {
    name: "Utility Messages — 10K",
    slug: "utility-messages-10k",
    description: "10,000 WhatsApp Business API utility (transactional) messages.",
    price: { inr: 149900, usd: 1799 }, // ₹1499 / $17.99
    billingType: "lifetime",
    interval: null,
    limit: { amount: 10000, unit: "messages" },
    sampleSheetUrl: null,
    sortOrder: 2,
  },
  {
    name: "Marketing Messages — 10K",
    slug: "marketing-messages-10k",
    description: "10,000 WhatsApp Business API marketing/broadcast messages.",
    price: { inr: 199900, usd: 2399 }, // ₹1999 / $23.99
    billingType: "lifetime",
    interval: null,
    limit: { amount: 10000, unit: "messages" },
    sampleSheetUrl: null,
    sortOrder: 3,
  },
  {
    name: "Authentication Messages — 10K",
    slug: "authentication-messages-10k",
    description: "10,000 WhatsApp Business API authentication (OTP) messages.",
    price: { inr: 129900, usd: 1599 }, // ₹1299 / $15.99
    billingType: "lifetime",
    interval: null,
    limit: { amount: 10000, unit: "messages" },
    sampleSheetUrl: null,
    sortOrder: 4,
  },
  {
    name: "Template Messages",
    slug: "template-messages",
    description: "Create and submit WhatsApp message templates for approval.",
    price: { inr: 99900, usd: 1199 }, // ₹999 / $11.99, lifetime feature unlock
    billingType: "lifetime",
    interval: null,
    limit: { amount: null, unit: null },
    sampleSheetUrl: null,
    sortOrder: 5,
  },
  {
    name: "AI Template Builder",
    slug: "ai-template-builder",
    description: "AI-assisted drafting and formatting of WhatsApp message templates.",
    price: { inr: 149900, usd: 1799 }, // ₹1499 / $17.99, lifetime feature unlock
    billingType: "lifetime",
    interval: null,
    limit: { amount: null, unit: null },
    sampleSheetUrl: null,
    sortOrder: 6,
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