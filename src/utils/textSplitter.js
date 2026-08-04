// Splits text into overlapping chunks, roughly by character count
// (character count is a simple, dependency-free proxy for token count —
// ~4 chars per token for English text, so chunkSize 1500 ~= 375 tokens)
const splitTextIntoChunks = (text, { chunkSize = 1500, overlap = 200 } = {}) => {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];

  // First try splitting on paragraph boundaries to keep chunks semantically coherent
  const paragraphs = cleaned.split(/\n\s*\n/).filter((p) => p.trim());

  const chunks = [];
  let current = "";

  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length <= chunkSize) {
      current = current ? `${current}\n\n${para}` : para;
    } else {
      if (current) chunks.push(current.trim());

      // If a single paragraph itself is bigger than chunkSize, hard-split it
      if (para.length > chunkSize) {
        let start = 0;
        while (start < para.length) {
          const end = Math.min(start + chunkSize, para.length);
          chunks.push(para.slice(start, end).trim());
          start = end - overlap;
          if (start < 0) start = 0;
          if (end === para.length) break;
        }
        current = "";
      } else {
        current = para;
      }
    }
  }
  if (current) chunks.push(current.trim());

  return chunks.filter((c) => c.length > 0);
};

// Strips script/style tags and null bytes from raw text before storage —
// defense in depth in case chunk content is ever rendered as HTML somewhere downstream.
const sanitizeText = (text) => {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\u0000/g, "");
};

module.exports = { splitTextIntoChunks, sanitizeText };
