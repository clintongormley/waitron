import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { applyTokens, baseStyles, menuTileStyles } from "@waitron/ui";
import { countedNameStyles } from "./counted-name.js";

let host: HTMLElement | undefined;

afterEach(() => {
  host?.remove();
  host = undefined;
});

/** A counted tile drawn with the till's styles alone, before any count has been measured. */
async function drawCountedTile(width: number): Promise<HTMLElement> {
  await page.viewport(width, 800);
  host = document.createElement("div");
  document.body.append(host);
  applyTokens(host);
  const root = host.attachShadow({ mode: "open" });
  root.adoptedStyleSheets = [
    baseStyles.styleSheet!,
    menuTileStyles.styleSheet!,
    countedNameStyles.styleSheet!,
  ];
  root.innerHTML = `<div class="grid"><div class="tile" data-in-order><span class="label"><span class="name">Bravas</span></span></div></div>`;
  return root.querySelector<HTMLElement>(".tile")!;
}

describe("counted name styles", () => {
  it("keeps a counted name clear of a count at its narrowest until the count is measured", async () => {
    const name = (await drawCountedTile(390)).querySelector<HTMLElement>(".name")!;
    const style = getComputedStyle(name);
    const room = getComputedStyle(name, "::before");
    // Half the phone's 15 px name size each side for "…"; beside the first line, the rest of the
    // 24 px count less the 6 px outside the tile.
    expect(style.fontSize).toBe("15px");
    expect(style.paddingInlineStart).toBe("7.5px");
    expect(style.paddingInlineEnd).toBe("7.5px");
    expect(room.float).toBe("inline-end");
    expect(room.width).toBe("10.5px");
    expect(room.height).toBe(`${name.getBoundingClientRect().height}px`);
  });
});
