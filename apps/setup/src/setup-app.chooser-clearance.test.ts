import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import type { SetupApp, Screen } from "./setup-app.js";
import type { SetupApi } from "./api/client.js";
import { setLocale } from "./i18n/t.js";
import "./setup-app.js";

const mounted: HTMLElement[] = [];

afterEach(() => {
  for (const host of mounted.splice(0)) host.remove();
  document.body.style.margin = "";
  setLocale("en-GB");
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

// A small phone's height (iPhone SE).
const VIEWPORT_HEIGHT = 667;

type Chooser = HTMLElement & { updateComplete: Promise<unknown> };

const chooserOf = (el: SetupApp) => el.shadowRoot!.querySelector<Chooser>("wt-language-chooser")!;

describe("the language chooser in the card's header", () => {
  const cases = (["admin", "venue", "cert", "connect", "restore-bucket", "mode"] as const).flatMap(
    (screen) =>
      (["en-GB", "es-ES"] as const).flatMap((locale) =>
        ([390, 1280] as const).map((width) => ({ screen, locale, width })),
      ),
  );

  it.each(cases)(
    "covers nothing interactive on the $screen screen ($locale, $width wide)",
    async ({ screen, locale, width }) => {
      await page.viewport(width, VIEWPORT_HEIGHT);
      const el = await mountAt(screen, [locale]);

      const trigger = chooserOf(el)
        .shadowRoot!.querySelector("[data-test=lang-trigger]")!
        .getBoundingClientRect();
      const screenRoot = el.shadowRoot!.querySelector(`[data-test=screen-${screen}]`)!.shadowRoot!;
      const logo = el.shadowRoot!.querySelector("[data-test=setup-logo]")!;
      const covered = [...screenRoot.querySelectorAll<HTMLElement>(INTERACTIVE), logo]
        .filter((node) => overlaps(trigger, node.getBoundingClientRect()))
        .map((node) => `${node.localName} "${node.textContent!.trim().slice(0, 40)}"`);
      expect(covered).toEqual([]);
    },
  );

  it.each(cases)(
    "opens its menu on screen and over the $screen screen ($locale, $width wide)",
    async ({ screen, locale, width }) => {
      await page.viewport(width, VIEWPORT_HEIGHT);
      const el = await mountAt(screen, [locale]);
      const chooser = chooserOf(el);
      chooser.shadowRoot!.querySelector<HTMLElement>("[data-test=lang-trigger]")!.click();
      await new Promise((resolve) => setTimeout(resolve));
      await chooser.updateComplete;

      const menu = chooser.shadowRoot!.querySelector<HTMLElement>("[role=menu]")!;
      const box = menu.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(window.innerWidth);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);

      const screenTop = el
        .shadowRoot!.querySelector(`[data-test=screen-${screen}]`)!
        .getBoundingClientRect().top;
      const options = [...menu.querySelectorAll<HTMLElement>("[role=menuitemradio]")];
      expect(options.length).toBeGreaterThan(1);
      for (const option of options) {
        const r = option.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        expect(document.elementFromPoint(x, y)).toBe(el);
        expect(el.shadowRoot!.elementFromPoint(x, y)).toBe(chooser);
        expect(chooser.shadowRoot!.elementFromPoint(x, y)).toBe(option);
      }
      const last = options.at(-1)!.getBoundingClientRect();
      expect(last.top + last.height / 2, "the menu reaches over the screen below").toBeGreaterThan(
        screenTop,
      );
    },
  );
});
