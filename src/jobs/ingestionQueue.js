const ApiError = require("../utils/ApiError");

const REDIS_URL = process.env.REDIS_URL;
let queue = null;
let worker = null;

// Lazily initialize BullMQ only if Redis is actually configured. This keeps
// local development frictionless (no Redis required) while giving production
// a real, crash-resistant job queue once REDIS_URL is set.
const getQueue = () => {
  if (!REDIS_URL) return null;
  if (queue) return queue;

  const { Queue } = require("bullmq");
  const IORedis = require("ioredis");
  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

  queue = new Queue("document-ingestion", { connection });
  return queue;
};

// Call once at server startup (only does something if REDIS_URL is set)
const startIngestionWorker = (processFn) => {
  if (!REDIS_URL) {
    console.log("REDIS_URL not set — ingestion will run in-process (fine for dev, not for scale)");
    return;
  }

  const { Worker } = require("bullmq");
  const IORedis = require("ioredis");
  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

  worker = new Worker(
    "document-ingestion",
    async (job) => {
      await processFn(job.data.documentId);
    },
    { connection, concurrency: 3 }
  );

  worker.on("failed", (job, err) => {
    console.error(`Ingestion job failed for document ${job?.data?.documentId}:`, err.message);
  });

  console.log("BullMQ ingestion worker started (Redis-backed)");
};

// Enqueues a document for background processing. Falls back to a plain
// fire-and-forget async call if Redis isn't configured.
const enqueueIngestion = async (documentId, processFn) => {
  const q = getQueue();

  if (q) {
    await q.add("ingest", { documentId }, { attempts: 3, backoff: { type: "exponential", delay: 2000 } });
    return;
  }

  // Fallback: run directly, don't block the HTTP response
  processFn(documentId).catch((err) => {
    console.error(`In-process ingestion failed for document ${documentId}:`, err.message);
  });
};

module.exports = { enqueueIngestion, startIngestionWorker };
