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
// 20MB was a flat cap regardless of file type, which was already wrong in
// both directions for WhatsApp specifically: it silently accepted images up
// to 20MB that Meta's Cloud API would reject at 5MB (failing invisibly at
// send time — see relayToWhatsappIfNeeded's deliveryStatus), and it capped
// documents at 20MB when WhatsApp actually allows up to 100MB. The
// per-type WhatsApp ceilines (image 5MB, audio/video 16MB, document 100MB)
// are enforced client-side before upload even starts (see
// agent-chat-sheet.tsx's onFileSelected) so the agent gets instant
// feedback instead of a failed send a few seconds later; this server-side
// limit is just the outer safety net covering every upload path
// (including non-WhatsApp/widget attachments, which have no Meta cap at
// all), sized to the largest thing anything legitimately sends here.
const MAX_MEDIA_SIZE_MB = 100;

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