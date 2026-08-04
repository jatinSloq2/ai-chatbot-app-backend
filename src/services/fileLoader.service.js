const fs = require("fs");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const ApiError = require("../utils/ApiError");

// Extracts plain text from an uploaded file buffer, based on its mimetype/extension.
const extractTextFromFile = async (file) => {
  const { mimetype, originalname, buffer } = file;
  const ext = originalname.split(".").pop().toLowerCase();

  try {
    if (mimetype === "application/pdf" || ext === "pdf") {
      const data = await pdfParse(buffer);
      return data.text;
    }

    if (
      mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      ext === "docx"
    ) {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }

    if (mimetype === "text/plain" || ext === "txt" || mimetype === "text/csv" || ext === "csv") {
      return buffer.toString("utf-8");
    }

    if (mimetype === "text/markdown" || ext === "md") {
      return buffer.toString("utf-8");
    }

    throw new ApiError(
      400,
      `Unsupported file type: ${ext}. Supported: pdf, docx, txt, csv, md`
    );
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(400, `Failed to extract text from file: ${err.message}`);
  }
};

module.exports = { extractTextFromFile };
