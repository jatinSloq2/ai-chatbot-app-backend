const multer = require("multer");
const ApiError = require("../utils/ApiError");

const ALLOWED_EXTENSIONS = ["pdf", "docx", "txt", "csv", "md"];
const MAX_FILE_SIZE_MB = 15;

const storage = multer.memoryStorage(); // keep in memory, we only need the buffer briefly

const fileFilter = (req, file, cb) => {
  const ext = file.originalname.split(".").pop().toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(
      new ApiError(400, `Unsupported file type ".${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`)
    );
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
});

// --- Chat media (images/files attached to a message or a canned response) ---
// Deliberately a wider, but still bounded, set of extensions than the
// knowledge-base document uploader above — chat attachments are shown/
// downloaded as-is, never parsed for RAG.
const MEDIA_ALLOWED_EXTENSIONS = [
  "jpg", "jpeg", "png", "gif", "webp", "svg",
  "pdf", "doc", "docx", "txt", "csv", "xlsx", "ppt", "pptx",
];
const MAX_MEDIA_SIZE_MB = 20;

const mediaStorage = multer.memoryStorage();

const mediaFileFilter = (req, file, cb) => {
  const ext = file.originalname.split(".").pop().toLowerCase();
  if (!MEDIA_ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(
      new ApiError(400, `Unsupported file type ".${ext}". Allowed: ${MEDIA_ALLOWED_EXTENSIONS.join(", ")}`)
    );
  }
  cb(null, true);
};

const mediaUpload = multer({
  storage: mediaStorage,
  fileFilter: mediaFileFilter,
  limits: { fileSize: MAX_MEDIA_SIZE_MB * 1024 * 1024 },
});

// --- Avatars (profile pictures — dashboard user, agent) ---
// Images only, and a tighter size cap than general chat media — these are
// rendered small (a circle in a header/sidebar), so there's no reason to
// accept a 20MB file for one.
const AVATAR_ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp"];
const MAX_AVATAR_SIZE_MB = 5;

const avatarStorage = multer.memoryStorage();

const avatarFileFilter = (req, file, cb) => {
  const ext = file.originalname.split(".").pop().toLowerCase();
  if (!AVATAR_ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(
      new ApiError(400, `Unsupported image type ".${ext}". Allowed: ${AVATAR_ALLOWED_EXTENSIONS.join(", ")}`)
    );
  }
  cb(null, true);
};

const avatarUpload = multer({
  storage: avatarStorage,
  fileFilter: avatarFileFilter,
  limits: { fileSize: MAX_AVATAR_SIZE_MB * 1024 * 1024 },
});

module.exports = { upload, mediaUpload, avatarUpload };