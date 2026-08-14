// Shared by every SSE endpoint (AI chat streaming, visitor handover stream,
// agent realtime stream) so headers/heartbeat behavior stays consistent.

function setupSSE(req, res, extraHeaders = {}) {
    const origin = req.headers.origin || "*";
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering, if present
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
    res.setHeader("Vary", "Origin");
    Object.entries(extraHeaders).forEach(([k, v]) => res.setHeader(k, v));
    if (res.flushHeaders) res.flushHeaders();
}

function sendEvent(res, event, data) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Long-lived connections get killed by some proxies/load balancers if
// nothing is written for a while — a comment line (ignored by EventSource)
// keeps the connection alive without triggering a client-side event.
function startHeartbeat(res, intervalMs = 25000) {
    const timer = setInterval(() => {
        try {
            res.write(": ping\n\n");
        } catch {
            clearInterval(timer);
        }
    }, intervalMs);
    return () => clearInterval(timer);
}

module.exports = { setupSSE, sendEvent, startHeartbeat };