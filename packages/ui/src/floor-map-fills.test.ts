import { afterEach, describe, expect, it } from "vitest";
import { FLOOR_MAP_FILLS, floorMapFillStyles } from "./floor-map-fills.js";

let host: HTMLElement | undefined;

afterEach(() => {
  host?.remove();
  host = undefined;
});

describe("floor map fills", () => {
  it("paints each fill from its tokens", () => {
    host = document.createElement("div");
    document.body.append(host);
    const root = host.attachShadow({ mode: "open" });
    root.adoptedStyleSheets = [floorMapFillStyles.styleSheet!];
    for (const [i, fill] of FLOOR_MAP_FILLS.entries()) {
      host.style.setProperty(`--wt-color-table-${fill}`, `rgb(${i}, 2, 3)`);
      host.style.setProperty(`--wt-color-on-table-${fill}`, `rgb(4, 5, ${i})`);
      const table = document.createElement("div");
      table.dataset.fill = fill;
      root.append(table);
    }
    for (const [i, fill] of FLOOR_MAP_FILLS.entries()) {
      const style = getComputedStyle(root.querySelector(`[data-fill="${fill}"]`)!);
      expect(style.backgroundColor, fill).toBe(`rgb(${i}, 2, 3)`);
      expect(style.color, fill).toBe(`rgb(4, 5, ${i})`);
    }
  });

  it("lists the five fills", () => {
    expect(FLOOR_MAP_FILLS).toEqual(["free", "seated", "bill", "clearing", "reserved"]);
  });
});
