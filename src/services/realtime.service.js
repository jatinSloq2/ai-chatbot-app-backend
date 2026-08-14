const { sendEvent } = require("../utils/sse");

// In-memory pub/sub for realtime pushes over SSE. Same single-process
// caveat as lead.service.js's OTP store and notification.service.js's FCM
// token dedup: this only works for one Node instance. If this API ever runs
// as more than one process/container, move this to Redis pub/sub (or a
// managed realtime service) so every instance sees every publish.

const channels = new Map(); // channel name -> Set<res>

const subscribe = (channel, res) => {
  if (!channels.has(channel)) channels.set(channel, new Set());
  channels.get(channel).add(res);
};

const unsubscribe = (channel, res) => {
  const set = channels.get(channel);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) channels.delete(channel);
};

// event/data follow the same shape sendEvent() writes — every subscriber on
// this channel gets it immediately, no polling involved.
const publish = (channel, event, data) => {
  const set = channels.get(channel);
  if (!set || set.size === 0) return;
  for (const res of set) {
    try {
      sendEvent(res, event, data);
    } catch {
      // Dead connection — it'll be cleaned up by its own req.on("close") handler.
    }
  }
};

module.exports = { subscribe, unsubscribe, publish };``