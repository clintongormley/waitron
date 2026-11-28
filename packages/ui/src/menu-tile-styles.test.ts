import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { applyTokens } from "@waitron/ui-core/tokens";
import { baseStyles } from "./base-styles.js";
import { readableTextColor } from "./category-color.js";
import { menuTilePaint, menuTileStyles } from "./menu-tile-styles.js";

vi.mock("./category-color.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./category-color.js")>();
  return { ...original, readableTextColor: vi.fn(original.readableTextColor) };
});

let host: HTMLElement | undefined;

afterEach(() => {
  host?.remove();
  host = undefined;
});

async function drawTile(width: number, counted = false): Promise<HTMLElement> {
  await page.viewport(width, 800);
  host = document.createElement("div");
  document.body.append(host);
  applyTokens(host);
  const root = host.attachShadow({ mode: "open" });
  root.adoptedStyleSheets = [baseStyles.styleSheet!, menuTileStyles.styleSheet!];
  root.innerHTML = `<div class="grid"><div class="tile"${counted ? " data-in-order" : ""}><span class="label"><span class="name">Bravas</span></span></div></div>`;
  return root.querySelector<HTMLElement>(".tile")!;
}

describe("menu tile styles", () => {
  it.each([
    { width: 390, height: 76 },
    { width: 720, height: 84 },
  ])("draws a tile $height px tall at $width px", async ({ width, height }) => {
    const tile = await drawTile(width);
    expect(tile.getBoundingClientRect().height).toBe(height);
  });

  it("keeps room at the grid's top and end for a corner count", async () => {
    const grid = (await drawTile(390)).parentElement!;
    const style = getComputedStyle(grid);
    expect(style.paddingTop).toBe("8px");
    expect(style.paddingRight).toBe("8px");
    expect(style.rowGap).toBe("8px");
  });

  it("keeps a counted name clear of a count at its narrowest until the count says how wide it is", async () => {
    const name = (await drawTile(390, true)).querySelector<HTMLElement>(".name")!;
    const style = getComputedStyle(name);
    const room = getComputedStyle(name, "::before");
    // Half the 14 px name size each side for "…"; beside the first line, the rest of the 24 px
    // count less the 6 px outside the tile.
    expect(style.paddingInlineStart).toBe("7px");
    expect(style.paddingInlineEnd).toBe("7px");
    expect(room.float).toBe("inline-end");
    expect(room.width).toBe("11px");
    expect(room.height).toBe(`${name.getBoundingClientRect().height}px`);
  });
});

describe("menuTilePaint", () => {
  it("fills a stored colour with black or white ink, whichever reads on it", () => {
    expect(menuTilePaint("#256bb1")).toBe("--tile-fill:#256bb1;--tile-ink:#ffffff");
    expect(menuTilePaint("#f5d76e")).toBe("--tile-fill:#f5d76e;--tile-ink:#000000");
  });

  it.each([null, undefined, "", "#FFFFFF", "#fff", "red"])(
    "paints nothing for %j, which a tile draws neutral",
    (color) => {
      expect(menuTilePaint(color)).toBeUndefined();
    },
  );

  it("works out each colour's ink once", () => {
    const ink = vi.mocked(readableTextColor);
    ink.mockClear();
    const first = menuTilePaint("#3a7d44");
    expect(menuTilePaint("#3a7d44")).toBe(first);
    expect(ink).toHaveBeenCalledTimes(1);
    expect(ink).toHaveBeenCalledWith("#3a7d44");
    menuTilePaint("#7d3a44");
    expect(ink).toHaveBeenCalledTimes(2);
  });
});
