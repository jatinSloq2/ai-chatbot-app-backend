// Run with: node src/scripts/seedAddOns.js

require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../config/db");
const AddOn = require("../models/AddOn");

const addOns = [
  {
    name: "WhatsApp Inbox",
    slug: "whatsapp-inbox",
    description:
      "Unlock the WhatsApp Business inbox alongside your bot's existing channels — lifetime access.",
    price: { inr: 9900, usd: 199 },
    billingType: "lifetime",
    interval: null,
    limit: { amount: 10000, unit: "messages" },
    sampleSheetUrl: null,
    sortOrder: 1,
  },

  {
    name: "Template Messages — 10K",
    slug: "template-messages-10k",
    description:
      "10,000 WhatsApp Business API template messages (Utility, Marketing, and Authentication).",
    price: { inr: 14900, usd: 199 },
    billingType: "lifetime",
    interval: null,
    limit: { amount: 10000, unit: "messages" },
    sampleSheetUrl: null,
    sortOrder: 2,
  },

  {
    name: "Template Management",
    slug: "template-management",
    description:
      "Create and submit WhatsApp message templates for approval.",
    price: { inr: 9900, usd: 199 },
    billingType: "lifetime",
    interval: null,
    limit: { amount: null, unit: null },
    sampleSheetUrl: null,
    sortOrder: 3,
  },
];

const run = async () => {
  try {
    await connectDB();

    const validSlugs = addOns.map((addOn) => addOn.slug);

    // Delete all stale add-ons that are not in the current seed list
    const deleteResult = await AddOn.deleteMany({
      slug: { $nin: validSlugs },
    });

    console.log(`Deleted stale add-ons: ${deleteResult.deletedCount}`);

    // Update existing add-ons or create missing ones
    for (const addOn of addOns) {
      await AddOn.findOneAndUpdate(
        { slug: addOn.slug },
        addOn,
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        }
      );

      console.log(
        `Upserted add-on: ${addOn.name} (${addOn.slug})`
      );
    }

    console.log("Done syncing add-ons.");
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
