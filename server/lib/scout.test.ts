import { describe, expect, it } from "vitest";

import { gapScore } from "./scout.js";

describe("gapScore", () => {
  it("scores real demand with no supply at the top", () => {
    expect(gapScore(1, 1)).toBe(100);
  });

  it("does not call a topic nobody wants a gap, even with no competitors", () => {
    expect(gapScore(0, 1)).toBeLessThan(25);
  });

  it("falls as supply improves", () => {
    expect(gapScore(0.8, 1)).toBeGreaterThan(gapScore(0.8, 0.5));
    expect(gapScore(0.8, 0.5)).toBeGreaterThan(gapScore(0.8, 0.1));
  });

  it("rises with demand when supply is equal", () => {
    expect(gapScore(0.9, 0.7)).toBeGreaterThan(gapScore(0.2, 0.7));
  });

  it("stays within 0 to 100 for out-of-range input", () => {
    expect(gapScore(5, 5)).toBe(100);
    expect(gapScore(-1, -1)).toBeGreaterThanOrEqual(0);
  });
});
