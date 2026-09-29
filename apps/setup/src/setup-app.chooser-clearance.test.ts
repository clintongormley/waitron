import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import type { SetupApp, Screen } from "./setup-app.js";
import type { SetupApi } from "./api/client.js";
import "./setup-app.js";

const mounted: HTMLElement[] = [];

afterEach(() => {
  for (const host of mounted.splice(0)) host.remove();
  document.scrollingElement!.scrollTop = 0;
  document.body.style.margin = "";
});

function stubApi(): SetupApi {
  return {
    getDiscovery: vi.fn().mockResolvedValue({ caDownloadAvailable: false }),
    getStatus: vi
      .fn()
      .mockResolvedValue({ provisioned: false, environment: "preproduction", needs: ["venue"] }),
    getVenueDefaults: vi.fn().mockResolvedValue({}),
  } as unknown as SetupApi;
}

async function mountAt(screen: Screen, languages: readonly string[]): Promise<SetupApp> {
  // The page's own body has no margin (index.html).
  document.body.style.margin = "0";
  const host = document.createElement("div");
  document.body.appendChild(host);
  applyTokens(host);
  mounted.push(host);
  const el = document.createElement("setup-app") as SetupApp;
  el.api = stubApi();
  el.browserLanguages = languages;
  host.appendChild(el);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  el.shadowRoot!.querySelector("main")!.dispatchEvent(
    new CustomEvent("setup-goto", { detail: { screen }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  const shown = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    `[data-test=screen-${screen}]`,
  )!;
  await shown.updateComplete;
  return el;
}

const overlaps = (a: DOMRect, b: DOMRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

const INTERACTIVE = "button, a[href], input, select, textarea, wt-button, wt-card, [tabindex]";

describe("the language chooser, with the page scrolled to the bottom", () => {
  const cases = (["admin", "venue", "cert", "connect", "restore-bucket", "mode"] as const).flatMap(
    (screen) =>
      (["en-GB", "es-ES"] as const).flatMap((locale) =>
        ([390, 1280] as const).map((width) => ({ screen, locale, width })),
      ),
  );

  it.each(cases)(
    "covers nothing interactive on the $screen screen ($locale, $width wide)",
    async ({ screen, locale, width }) => {
      await page.viewport(width, 844);
      const el = await mountAt(screen, [locale]);
      const scroller = document.scrollingElement!;
      scroller.scrollTop = scroller.scrollHeight;

      const trigger = el
        .shadowRoot!.querySelector("setup-language-chooser")!
        .shadowRoot!.querySelector("[data-test=lang-trigger]")!
        .getBoundingClientRect();
      const screenRoot = el.shadowRoot!.querySelector(`[data-test=screen-${screen}]`)!.shadowRoot!;
      const covered = [...screenRoot.querySelectorAll<HTMLElement>(INTERACTIVE)]
        .filter((node) => overlaps(trigger, node.getBoundingClientRect()))
        .map((node) => `${node.localName} "${node.textContent!.trim().slice(0, 40)}"`);
      expect(covered).toEqual([]);
    },
  );

  it("is measured on a screen tall enough to scroll at phone width", async () => {
    await page.viewport(390, 844);
    await mountAt("admin", ["es-ES"]);
    const scroller = document.scrollingElement!;
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
  });
});
