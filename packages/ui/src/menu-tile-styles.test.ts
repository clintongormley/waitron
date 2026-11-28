import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { applyTokens } from "@waitron/ui-core/tokens";
import { baseStyles } from "./base-styles.js";
import { menuTileStyles } from "./menu-tile-styles.js";

let host: HTMLElement | undefined;

afterEach(() => {
  host?.remove();
  host = undefined;
});

async function drawTile(width: number): Promise<HTMLElement> {
  await page.viewport(width, 800);
  host = document.createElement("div");
  document.body.append(host);
  applyTokens(host);
  const root = host.attachShadow({ mode: "open" });
  root.adoptedStyleSheets = [baseStyles.styleSheet!, menuTileStyles.styleSheet!];
  root.innerHTML = `<div class="grid"><div class="tile"><span class="label"><span class="name">Bravas</span></span></div></div>`;
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
});
