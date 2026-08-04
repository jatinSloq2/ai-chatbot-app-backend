const { splitTextIntoChunks, sanitizeText } = require("../../src/utils/textSplitter");

describe("splitTextIntoChunks", () => {
  test("returns empty array for empty input", () => {
    expect(splitTextIntoChunks("")).toEqual([]);
    expect(splitTextIntoChunks("   ")).toEqual([]);
  });

  test("returns a single chunk for short text", () => {
    const chunks = splitTextIntoChunks("Hello world.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe("Hello world.");
  });

  test("splits long text into multiple chunks", () => {
    const paragraph = "Sentence. ".repeat(50); // ~500 chars
    const longText = Array(6).fill(paragraph).join("\n\n"); // ~3000 chars across paragraphs
    const chunks = splitTextIntoChunks(longText, { chunkSize: 500, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(600)); // some slack for paragraph boundaries
  });

  test("hard-splits a single paragraph larger than chunkSize", () => {
    const hugeParagraph = "x".repeat(5000);
    const chunks = splitTextIntoChunks(hugeParagraph, { chunkSize: 1000, overlap: 100 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  test("never returns empty-string chunks", () => {
    const chunks = splitTextIntoChunks("Para one.\n\n\n\nPara two.");
    chunks.forEach((c) => expect(c.trim().length).toBeGreaterThan(0));
  });
});

describe("sanitizeText", () => {
  test("strips script tags", () => {
    const dirty = "Hello <script>alert('xss')</script> world";
    expect(sanitizeText(dirty)).not.toMatch(/<script/i);
    expect(sanitizeText(dirty)).toContain("Hello");
    expect(sanitizeText(dirty)).toContain("world");
  });

  test("strips style tags", () => {
    const dirty = "Text <style>body{color:red}</style> more text";
    expect(sanitizeText(dirty)).not.toMatch(/<style/i);
  });

  test("removes null bytes", () => {
    expect(sanitizeText("a\u0000b")).toBe("ab");
  });
});
