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

module.exports = { upload };
