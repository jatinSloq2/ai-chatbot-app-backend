// Run with: node src/scripts/makeAdmin.js someone@example.com
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../models/User");

const run = async () => {
  const email = "jatinsingh098hp@gmail.com";
  if (!email) {
    console.error("Usage: node src/scripts/makeAdmin.js <email>");
    process.exit(1);
  }

  await connectDB();

  const user = await User.findOneAndUpdate(
    { email: email.toLowerCase() },
    { role: "admin" },
    { new: true }
  );

  if (!user) {
    console.error(`No user found with email: ${email}`);
  } else {
    console.log(`${user.email} is now an admin.`);
  }

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
