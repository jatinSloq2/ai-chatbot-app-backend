const { cosineSimilarity } = require("../../src/utils/vectorMath");

describe("cosineSimilarity", () => {
  test("identical vectors score 1", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });

  test("orthogonal vectors score 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  test("opposite vectors score -1", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  test("similar-direction vectors score high but not 1", () => {
    const score = cosineSimilarity([1, 2, 3], [1, 2, 4]);
    expect(score).toBeGreaterThan(0.9);
    expect(score).toBeLessThan(1);
  });

  test("zero vector returns 0 instead of NaN", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});
