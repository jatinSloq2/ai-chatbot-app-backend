const asyncHandler = require("../utils/asyncHandler");
const { LLM_PROVIDERS, EMBEDDING_PROVIDERS } = require("../config/modelRegistry");

// GET /api/models - lets the frontend build provider/model dropdowns without hardcoding them
const listModels = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: { llm: LLM_PROVIDERS, embedding: EMBEDDING_PROVIDERS },
  });
});

module.exports = { listModels };
