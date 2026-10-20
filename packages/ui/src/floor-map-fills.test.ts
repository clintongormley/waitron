import { afterEach, describe, expect, it } from "vitest";
import { FLOOR_MAP_FILLS, type FloorMapFill, floorMapFillStyles } from "./floor-map-fills.js";

let host: HTMLElement | undefined;

afterEach(() => {
  host?.remove();
  host = undefined;
});

/** Each fill's background token, then its text token. */
const TOKENS: Record<FloorMapFill, readonly [string, string]> = {
  free: ["--wt-color-table-free", "--wt-color-on-table-free"],
  seated: ["--wt-color-table-seated", "--wt-color-on-table-seated"],
  bill: ["--wt-color-table-bill", "--wt-color-on-table-bill"],
  reserved: ["--wt-color-table-reserved", "--wt-color-on-table-reserved"],
  calm: ["--wt-color-table-calm", "--wt-color-on-table-calm"],
  ready: ["--wt-color-success", "--wt-color-on-success"],
  danger: ["--wt-color-danger", "--wt-color-on-danger"],
  warning: ["--wt-color-warning", "--wt-color-on-warning"],
  plain: ["--wt-color-surface", "--wt-color-text"],
};

describe("floor map fills", () => {
  it("paints each fill from its tokens", () => {
    host = document.createElement("div");
    document.body.append(host);
    const root = host.attachShadow({ mode: "open" });
    root.adoptedStyleSheets = [floorMapFillStyles.styleSheet!];
    for (const [i, fill] of FLOOR_MAP_FILLS.entries()) {
      const [background, text] = TOKENS[fill];
      host.style.setProperty(background, `rgb(${i}, 2, 3)`);
      host.style.setProperty(text, `rgb(4, 5, ${i})`);
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

  it("lists the nine fills", () => {
    expect(FLOOR_MAP_FILLS).toEqual([
      "free",
      "seated",
      "bill",
      "reserved",
      "calm",
      "ready",
      "danger",
      "warning",
      "plain",
    ]);
  });
});
