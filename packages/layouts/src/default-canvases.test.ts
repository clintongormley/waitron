import { describe, expect, it } from "vitest";
import { FORM_FACTORS } from "./canvas.js";
import { validateCanvas } from "./validate-canvas.js";
import { DEFAULT_CANVASES } from "./default-canvases.js";

describe("default canvases", () => {
  it("ships a canvas for every form factor", () => {
    for (const f of FORM_FACTORS) expect(DEFAULT_CANVASES[f]).toBeDefined();
  });
  it("every default canvas passes validateCanvas", () => {
    for (const f of FORM_FACTORS) expect(() => validateCanvas(DEFAULT_CANVASES[f])).not.toThrow();
  });
  it("the till default is a selling canvas (has the sale-critical cards)", () => {
    const till = validateCanvas(DEFAULT_CANVASES.till);
    const placed = new Set(till.tabs.flatMap((t) => t.cards.map((c) => c.type)));
    for (const c of ["product-grid", "basket", "total", "tender-pay"])
      expect(placed.has(c as never)).toBe(true);
  });
});
