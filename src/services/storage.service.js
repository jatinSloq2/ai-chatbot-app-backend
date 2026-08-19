const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cloudinaryConfig = require("../config/cloudinary");
const logger = require("../utils/logger");

// --- Storage backend toggle ---
// USING_VPS=true  -> media is written to local disk (see MEDIA_ROOT below),
//                    the same way this always worked. Use this when the
//                    backend is deployed somewhere with a persistent disk
//                    (a VPS, a Docker volume, etc).
// USING_VPS=false / unset -> media is uploaded to Cloudinary instead. Use
//                    this on platforms like Render whose filesystem is
//                    ephemeral (anything written to disk is wiped on every
//                    restart/redeploy), so files MUST live somewhere
//                    external.
// Read at call-time (not module load) so tests can flip it via env without
// re-requiring the module.
const isUsingVps = () => String(process.env.USING_VPS || "").trim().toLowerCase() === "true";

// Root directory everything gets written under. Overridable via env for
// deployments that mount a persistent volume somewhere other than the repo
// root (e.g. a Docker volume, an EFS mount, etc).
const MEDIA_ROOT = process.env.MEDIA_STORAGE_DIR || path.join(process.cwd(), "uploads");
const STATIC_ASSETS_DIR = path.join(process.cwd(), "assets");
const STATIC_PREFIX = "/assets";

// Base URL prefix the stored files are served from (see app.js's
// express.static("/uploads", ...) mount). Kept separate from MEDIA_ROOT so
// the on-disk layout and the public URL layout can diverge if needed.
// Only relevant when isUsingVps() — Cloudinary uploads return their own
// absolute secure_url instead.
const PUBLIC_PREFIX = "/uploads";

// Root "folder" Cloudinary uploads are namespaced under, so this app's
// assets are easy to find/browse in the Cloudinary media library and don't
// collide with anything else using the same account.
const CLOUDINARY_ROOT_FOLDER = process.env.CLOUDINARY_ROOT_FOLDER || "jestbot";

const IMAGE_MIME_PREFIX = "image/";
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "avif"]);

const sanitizeSegment = (segment) =>
  String(segment)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80) || "misc";

const sanitizeFileName = (name) => {
  const base = path.basename(String(name || "file"));
  return base.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 150) || "file";
};

const extOf = (name) => (String(name || "").split(".").pop() || "").toLowerCase();

const kindOf = (file) =>
  (file.mimetype || "").startsWith(IMAGE_MIME_PREFIX) || IMAGE_EXTENSIONS.has(extOf(file.originalname))
    ? "image"
    : "file";

/**
 * Media is stored (and therefore served/organised) at a path that mirrors
 * the platform's ownership hierarchy, exactly so it's easy to reason about /
 * audit / clean up — whether that's an on-disk path (VPS mode) or a
 * Cloudinary folder (Cloudinary mode):
 *
 *   <ownerUserId>/<botId>/<actorType>/<actorId>/<uniqueName>
 *
 * - ownerUserId — the dashboard account that owns the bot
 * - botId       — which bot the conversation belongs to
 * - actorType   — "agent" (an agent sent/attached this) or "visitor" (a
 *                 chat visitor/lead uploaded this)
 * - actorId     — the agent's _id, or the visitor's conversation/lead
 *                 identifier (sessionId), so every visitor's uploads live
 *                 in their own folder instead of one shared bucket
 */
const buildSegments = ({ ownerId, botId, actorType, actorId }) => [
  sanitizeSegment(ownerId),
  sanitizeSegment(botId),
  sanitizeSegment(actorType),
  sanitizeSegment(actorId),
];

const buildDir = (segments) => path.join(MEDIA_ROOT, ...segments);

const buildPublicUrl = (absPath) => {
  const rel = path.relative(MEDIA_ROOT, absPath).split(path.sep).join("/");
  return `${PUBLIC_PREFIX}/${rel}`;
};

// --- VPS (local disk) ---
const saveToDisk = async (segments, file) => {
  const dir = buildDir(segments);
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
    kind: kindOf(file),
    provider: "vps",
  };
};

// --- Cloudinary ---
const saveToCloudinary = async (segments, file) => {
  const fileName = sanitizeFileName(file.originalname);
  const unique = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const folder = [CLOUDINARY_ROOT_FOLDER, ...segments].join("/");
  const kind = kindOf(file);

  // IMPORTANT: for resource_type:"raw" (every non-image upload — pdfs,
  // docs, etc), Cloudinary does NOT track a separate "format" the way it
  // does for images/video. Whatever public_id we give it is exactly what
  // ends up in the delivered secure_url. Stripping the extension here used
  // to leave the delivered URL extensionless, so when that link got fetched
  // by a third party (e.g. WhatsApp's Cloud API downloading a "send by
  // link" media message) there was no filename/extension to infer a type
  // from and it came back down as a generic .bin. Keeping the real
  // extension on the public_id for raw uploads fixes that — images/video
  // still get it stripped since Cloudinary appends their format itself.
  const publicId =
    kind === "image" ? `${unique}-${fileName.replace(/\.[^.]+$/, "")}` : `${unique}-${fileName}`;

  const result = await cloudinaryConfig.uploadBuffer(file.buffer, {
    folder,
    publicId,
    resourceType: kind === "image" ? "image" : "raw",
  });

  return {
    url: result.secure_url,
    fileName,
    mimeType: file.mimetype || null,
    size: file.size || file.buffer.length,
    kind,
    provider: "cloudinary",
    publicId: result.public_id,
  };
};

const saveToBackend = (segments, file) => (isUsingVps() ? saveToDisk(segments, file) : saveToCloudinary(segments, file));

/**
 * Persist a multer (memory storage) file buffer to whichever backend is
 * active, and return the metadata shape stored on
 * Conversation.messages[].media / CannedResponse.media.
 */
const saveMedia = async ({ ownerId, botId, actorType, actorId, file }) => {
  if (!file?.buffer) throw new Error("No file buffer to store");
  const segments = buildSegments({ ownerId, botId, actorType, actorId });
  return saveToBackend(segments, file);
};

/**
 * Same idea as saveMedia, but for account-level profile pictures (a
 * dashboard user or an agent) which aren't scoped to a bot/conversation.
 * actorType is "owner" | "agent"; actorId is the User/Agent _id.
 */
const saveAvatar = async ({ actorType, actorId, file }) => {
  if (!file?.buffer) throw new Error("No file buffer to store");
  const segments = [sanitizeSegment("avatars"), sanitizeSegment(actorType), sanitizeSegment(actorId)];
  const saved = await saveToBackend(segments, file);
  if (saved.kind !== "image") {
    logger.warn(`[storage] Avatar upload for ${actorType}:${actorId} wasn't detected as an image (${saved.mimeType})`);
  }
  return saved;
};

// Best-effort delete, used when replacing/removing a previously-uploaded
// media item. Safe to call on anything saveMedia/saveAvatar ever returned —
// it no-ops for whichever backend didn't create the file.
const deleteMedia = async (media) => {
  if (!media) return;
  try {
    if (media.provider === "cloudinary" && media.publicId) {
      await cloudinaryConfig.destroy(media.publicId, { resourceType: media.kind === "image" ? "image" : "raw" });
    } else if (media.provider === "vps" && media.url?.startsWith(PUBLIC_PREFIX)) {
      const rel = media.url.slice(PUBLIC_PREFIX.length + 1);
      const absPath = path.join(MEDIA_ROOT, rel);
      await fs.promises.unlink(absPath).catch(() => {});
    }
  } catch (err) {
    logger.error(`[storage] Failed to delete media ${media.url}: ${err.message}`);
  }
};

module.exports = {
  saveMedia,
  saveAvatar,
  deleteMedia,
  isUsingVps,
  MEDIA_ROOT,
  PUBLIC_PREFIX,
  STATIC_ASSETS_DIR,
  STATIC_PREFIX,
};