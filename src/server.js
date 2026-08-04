require("dotenv").config();
const app = require("./app");
const connectDB = require("./config/db");
const { startCronJobs } = require("./jobs/subscriptionExpiry.job");
const { startIngestionWorker } = require("./jobs/ingestionQueue");
const ragService = require("./services/rag.service");

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();
  startCronJobs();
  startIngestionWorker(ragService.processDocument);

  app.listen(PORT, () => {
    console.log(`Server running in ${process.env.NODE_ENV || "development"} mode on port ${PORT}`);
  });
};

startServer();

// Safety nets for unhandled issues
process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
  process.exit(1);
});
