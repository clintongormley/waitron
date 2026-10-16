import { describe, expect, it } from "vitest";
import { CARD_TYPES } from "./canvas.js";

const noDupes = (t: readonly string[]) => new Set(t).size === t.length;

describe("catalogue tuples", () => {
  it("card types are unique and include the counter sale cards + big cards", () => {
    expect(noDupes(CARD_TYPES)).toBe(true);
    for (const c of ["product-grid", "basket", "total", "tender-pay", "floor-plan", "kds-board"])
      expect(CARD_TYPES).toContain(c);
  });
});
