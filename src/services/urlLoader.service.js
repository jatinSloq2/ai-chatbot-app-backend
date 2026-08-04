const axios = require("axios");
const cheerio = require("cheerio");
const ApiError = require("../utils/ApiError");

const extractTextFromUrl = async (url) => {
  let html;
  try {
    const { data } = await axios.get(url, {
      timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RAGBot/1.0)" },
    });
    html = data;
  } catch (err) {
    throw new ApiError(400, `Failed to fetch URL: ${err.message}`);
  }

  const $ = cheerio.load(html);
  $("script, style, nav, footer, noscript, svg, header").remove();

  const title = $("title").first().text().trim() || url;
  const text = $("body").text().replace(/\s+/g, " ").trim();

  if (!text || text.length < 20) {
    throw new ApiError(400, "Could not extract meaningful text content from this URL");
  }

  return { title, text };
};

module.exports = { extractTextFromUrl };
