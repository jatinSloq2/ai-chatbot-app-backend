// Shared test helper: connects mongoose to the in-memory MongoDB instance
// created by globalSetup, and exports the Express app (without starting
// cron jobs / BullMQ workers / a real HTTP listener - see server.js for that).
const fs = require("fs");
const mongoose = require("mongoose");

const getMongoUri = () => {
  if (process.env.MONGO_URI) return process.env.MONGO_URI;
  return fs.readFileSync(__dirname + "/.mongo-uri", "utf-8").trim();
};

let connected = false;

const connectTestDB = async () => {
  if (connected) return;
  const uri = getMongoUri();
  await mongoose.connect(uri);
  connected = true;
};

const clearTestDB = async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
};

const closeTestDB = async () => {
  await mongoose.connection.close();
};

module.exports = { connectTestDB, clearTestDB, closeTestDB };
