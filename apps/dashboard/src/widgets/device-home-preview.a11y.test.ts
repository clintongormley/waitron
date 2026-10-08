import { afterEach, describe, expect, it } from "vitest";
import type { HomeTile, MenuDocument } from "../api/client.js";
import type { DocumentTile } from "@waitron/catalogue/src/menu-document-types.js";
import {
  cleanupWidgets,
  documentProduct,
  documentSection,
  expectNoA11yViolations,
  menuDocument,
  mountWidget,
} from "./test-helpers.js";
import { page, userEvent } from "vitest/browser";
import "./device-home-preview.js";
import type { DeviceHomePreview } from "./device-home-preview.js";

afterEach(cleanupWidgets);

const SHORTCUTS: DocumentTile[] = [
  { kind: "product", productId: "p-lemonade" },
  { kind: "empty" },
  { kind: "section", sectionId: "s-drinks" },
];

/** Drinks › Beer, a dark-painted Lemonade with a photo, a pale-painted Ham, and a plain Water. */
function lunch(tiles: "colours" | "thumbnails" = "colours"): MenuDocument {
  const drinks = {
    ...documentSection("s-drinks", "Drinks", [documentProduct("mi-beer", "p-beer")]),
    color: "#1f3a5f",
    image: "drinks.webp",
  } as const;
  const document = menuDocument(
    [
      drinks,
      documentProduct("mi-lemonade", "p-lemonade"),
      documentProduct("mi-ham", "p-ham"),
      documentProduct("mi-water", "p-water"),
    ],
    { "p-beer": "Beer", "p-lemonade": "Lemonade", "p-ham": "Ham", "p-water": "Water" },
  );
  Object.assign(document.offers["mi-lemonade"]!, { image: "lemonade.webp", color: "#256bb1" });
  document.offers["mi-ham"]!.color = "#f5e663";
  return {
    ...document,
    home: {
      shortcuts: SHORTCUTS,
      handheld: { ...document.home.handheld, tiles },
      till: { ...document.home.till, tiles },
    },
  };
}

async function search(el: DeviceHomePreview, text: string): Promise<void> {
  const input = el
    .shadowRoot!.querySelector('[data-region="search"] wt-input')!
    .shadowRoot!.querySelector("input")!;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

describe.each(["light", "dark"] as const)("device home preview (%s)", (theme) => {
  it("painted section tiles keep visible, accessible hover feedback", async () => {
    const { el, host } = await mountWidget<DeviceHomePreview>(
      "dashboard-device-home-preview",
      { document: lunch() },
      theme,
    );
    const tiles = el.shadowRoot!.querySelectorAll("wt-button.tile[data-painted]");
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      const inner = tile.shadowRoot!.querySelector("button")!;
      const border = getComputedStyle(inner).borderTopColor;
      await userEvent.hover(inner);
      expect(inner.matches(":hover")).toBe(true);
      expect(getComputedStyle(inner).opacity).toBe("1");
      expect(getComputedStyle(inner).borderTopColor).not.toBe(border);
      await expectNoA11yViolations(host);
    }
    await page.screenshot({
      element: host,
      path: `__screenshots__/look/a319-preview-${theme}.png`,
    });
  });

  it.each(["handheld", "till"] as const)("renders %s accessibly", async (device) => {
    const { host } = await mountWidget<DeviceHomePreview>(
      "dashboard-device-home-preview",
      { document: lunch(), device },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("renders Thumbnails accessibly", async () => {
    const { host } = await mountWidget<DeviceHomePreview>(
      "dashboard-device-home-preview",
      { document: lunch("thumbnails") },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("renders an open section accessibly", async () => {
    const { el, host } = await mountWidget<DeviceHomePreview>(
      "dashboard-device-home-preview",
      { document: lunch() },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>('[data-region="structure"] wt-button.tile')!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("renders search results, named by a heading drawn for screen readers only, accessibly", async () => {
    const { el, host } = await mountWidget<DeviceHomePreview>(
      "dashboard-device-home-preview",
      { document: lunch() },
      theme,
    );
    await search(el, "a");
    const results = el.shadowRoot!.querySelector('[data-region="results"]')!;
    expect(results.querySelectorAll(".tile").length).toBeGreaterThan(0);
    const heading = el.shadowRoot!.getElementById(results.getAttribute("aria-labelledby")!)!;
    expect(heading.textContent!.trim()).toBe("Resultados de la búsqueda");
    expect(heading.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    await expectNoA11yViolations(host);
  });

  it.each(["handheld", "till"] as const)(
    "renders editing the %s's shortcuts accessibly, missing and unshown ones included",
    async (device) => {
      const shortcut = (memberId: string, ref: HomeTile["ref"], name: string): HomeTile => ({
        memberId,
        position: 0,
        ref,
        missingName: null,
        name,
        reachable: true,
      });
      const { el, host } = await mountWidget<DeviceHomePreview>(
        "dashboard-device-home-preview",
        {
          document: lunch(),
          device,
          shortcuts: [
            shortcut("sc-lemonade", { kind: "product", productId: "p-lemonade" }, "Lemonade"),
            shortcut("sc-drinks", { kind: "section", sectionId: "s-drinks" }, "Drinks"),
            { ...shortcut("sc-gone", { kind: "missing", name: "Soup" }, "Soup"), reachable: false },
            shortcut("sc-unshown", { kind: "section", sectionId: "s-empty" }, "Empty"),
          ],
        },
        theme,
      );
      expect(el.shadowRoot!.querySelectorAll('[data-test^="grip-"]')).toHaveLength(4);
      await expectNoA11yViolations(host);
      el.busy = true;
      await el.updateComplete;
      await expectNoA11yViolations(host);
    },
  );

  it("renders a search with no results accessibly", async () => {
    const { el, host } = await mountWidget<DeviceHomePreview>(
      "dashboard-device-home-preview",
      { document: lunch() },
      theme,
    );
    await search(el, "nothing like this");
    await expectNoA11yViolations(host);
  });
});
