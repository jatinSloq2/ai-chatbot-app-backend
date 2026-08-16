const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Root directory everything gets written under. Overridable via env for
// deployments that mount a persistent volume somewhere other than the repo
// root (e.g. a Docker volume, an EFS mount, etc).
const MEDIA_ROOT = process.env.MEDIA_STORAGE_DIR || path.join(process.cwd(), "uploads");
const STATIC_ASSETS_DIR = path.join(process.cwd(), "assets");
const STATIC_PREFIX = "/assets";

// Base URL prefix the stored files are served from (see app.js's
// express.static("/uploads", ...) mount). Kept separate from MEDIA_ROOT so
// the on-disk layout and the public URL layout can diverge if needed.
const PUBLIC_PREFIX = "/uploads";

const IMAGE_MIME_PREFIX = "image/";

const sanitizeSegment = (segment) =>
  String(segment)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80) || "misc";

const sanitizeFileName = (name) => {
  const base = path.basename(String(name || "file"));
  return base.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 150) || "file";
};

/**
 * Media is stored on disk (and therefore served) at a path that mirrors the
 * platform's ownership hierarchy, exactly so it's easy to reason about /
 * audit / clean up:
 *
 *   uploads/<ownerUserId>/<botId>/<actorType>/<actorId>/<uniqueName>
 *
 * - ownerUserId — the dashboard account that owns the bot
 * - botId       — which bot the conversation belongs to
 * - actorType   — "agent" (an agent sent/attached this) or "visitor" (a
 *                 chat visitor/lead uploaded this)
 * - actorId     — the agent's _id, or the visitor's conversation/lead
 *                 identifier (sessionId), so every visitor's uploads live
 *                 in their own folder instead of one shared bucket
 */
const buildDir = ({ ownerId, botId, actorType, actorId }) =>
  path.join(
    MEDIA_ROOT,
    sanitizeSegment(ownerId),
    sanitizeSegment(botId),
    sanitizeSegment(actorType),
    sanitizeSegment(actorId)
  );

const buildPublicUrl = (absPath) => {
  const rel = path.relative(MEDIA_ROOT, absPath).split(path.sep).join("/");
  return `${PUBLIC_PREFIX}/${rel}`;
};

/**
 * Persist an in-memory-multer file buffer to disk under the structured
 * directory above, and return the metadata shape stored on
 * Conversation.messages[].media / CannedResponse.media.
 */
const saveMedia = async ({ ownerId, botId, actorType, actorId, file }) => {
  if (!file?.buffer) throw new Error("No file buffer to store");

  const dir = buildDir({ ownerId, botId, actorType, actorId });
  await fs.promises.mkdir(dir, { recursive: true });

  const unique = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const fileName = sanitizeFileName(file.originalname);
  const storedName = `${unique}-${fileName}`;
  const absPath = path.join(dir, storedName);

  await fs.promises.writeFile(absPath, file.buffer);

  return {
    url: buildPublicUrl(absPath),
    fileName,
    mimeType: file.mimetype || null,
    size: file.size || file.buffer.length,
    kind: (file.mimetype || "").startsWith(IMAGE_MIME_PREFIX) ? "image" : "file",
  };
};

module.exports = { saveMedia, MEDIA_ROOT, PUBLIC_PREFIX, STATIC_ASSETS_DIR, STATIC_PREFIX };