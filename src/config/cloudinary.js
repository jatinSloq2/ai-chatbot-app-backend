const cloudinary = require("cloudinary").v2;
const logger = require("../utils/logger");

// Cloudinary is only actually used when USING_VPS=false (see
// storage.service.js) — e.g. the backend running on Render, where there's
// no persistent disk to write uploaded media to. Configuration is read
// lazily (on first upload) rather than at require-time so a deployment that
// never uploads anything (or that runs with USING_VPS=true) doesn't need
// these env vars set at all.
let configured = false;
const ensureConfigured = () => {
  if (configured) return;

  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
  const api_key = process.env.CLOUDINARY_API_KEY;
  const api_secret = process.env.CLOUDINARY_API_SECRET;

  if (!cloud_name || !api_key || !api_secret) {
    logger.error(
      "[cloudinary] USING_VPS is not 'true' but CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET " +
        "aren't all set — media uploads will fail until they are."
    );
  }

  cloudinary.config({ cloud_name, api_key, api_secret, secure: true });
  configured = true;
};

/**
 * Uploads an in-memory buffer to Cloudinary under `folder`, and returns the
 * raw Cloudinary result (secure_url, public_id, bytes, resource_type, ...).
 *
 * `resourceType` — "image" for images, "raw" for everything else (docs,
 * spreadsheets, etc). Cloudinary's "auto" also works but "raw" is more
 * predictable for non-image files (avoids it trying to transform them).
 */
const uploadBuffer = (buffer, { folder, publicId, resourceType = "auto" }) => {
  ensureConfigured();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: resourceType,
        overwrite: true,
        use_filename: false,
        unique_filename: false,
      },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
};

const destroy = (publicId, { resourceType = "image" } = {}) => {
  ensureConfigured();
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType }).catch((err) => {
    logger.error(`[cloudinary] Failed to delete ${publicId}: ${err.message}`);
  });
};

module.exports = { cloudinary, uploadBuffer, destroy, ensureConfigured };