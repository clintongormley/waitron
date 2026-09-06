import { page } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { LanguageChooser } from "./language-chooser.js";

const twoLocales = async () => [
  { code: "es-ES", label: "Español" },
  { code: "en-GB", label: "English" },
];

/**
 * Let a trigger activation settle. Opening the first time runs the ASYNC `#toggle` (it awaits
 * `loadLocales()` before flipping `open`), so a single `updateComplete` races the awaited fetch; a
 * macrotask drains that microtask chain, then `updateComplete` awaits the repaint. A close / cached
 * re-open flips state synchronously, for which this is simply a harmless extra wait.
 */
async function settle(el: LanguageChooser): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
}

const viewport = { width: window.innerWidth, height: window.innerHeight };
afterEach(async () => {
  await page.viewport(viewport.width, viewport.height);
  cleanupWidgets();
  setLocale("es-ES");
});

describe("dashboard-language-chooser", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("dashboard-language-chooser")).toBe(LanguageChooser);
  });

  it("is collapsed and lazy — shows the current language and does not fetch until opened", async () => {
    const loadLocales = vi.fn(twoLocales);
    const { el } = await mountWidget<LanguageChooser>("dashboard-language-chooser", {
      loadLocales,
    });

    // The initial label is readable before the options have loaded.
    expect(loadLocales).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector('[role="menu"]')).toBeNull();
    const trigger = el.shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!;
    expect(trigger.textContent).toContain("Español");

    // Activating the trigger fetches the list once and renders both options as a menu.
    trigger.click();
    await settle(el);
    expect(loadLocales).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot!.querySelector('[role="menu"]')).not.toBeNull();
    expect(el.shadowRoot!.textContent).toContain("Español");
    expect(el.shadowRoot!.textContent).toContain("English");
    // Once loaded, the trigger reads the active locale's LABEL, not its bare code.
    expect(trigger.textContent).toContain("Español");
  });

  it("shows English before opening and anchors its menu above the bottom-right trigger", async () => {
    await page.viewport(375, 667);
    setLocale("en-GB");
    const { el } = await mountWidget<LanguageChooser>("dashboard-language-chooser", {
      loadLocales: twoLocales,
    });
    const trigger = el.shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!;
    expect(trigger.textContent?.trim()).toBe("English");
    const rect = trigger.getBoundingClientRect();
    expect(window.innerWidth - rect.right).toBeLessThanOrEqual(32);
    expect(window.innerHeight - rect.bottom).toBeLessThanOrEqual(32);
    trigger.click();
    await settle(el);
    const menu = el
      .shadowRoot!.querySelector<HTMLElement>('[role="menu"]')!
      .getBoundingClientRect();
    expect(menu.bottom).toBeLessThanOrEqual(rect.top);
    expect(menu.left).toBeGreaterThanOrEqual(0);
    expect(menu.right).toBeLessThanOrEqual(window.innerWidth);
  });

  it("fetches once and caches — closing then re-opening does not re-fetch", async () => {
    const loadLocales = vi.fn(twoLocales);
    const { el } = await mountWidget<LanguageChooser>("dashboard-language-chooser", {
      loadLocales,
    });
    const trigger = el.shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!;

    trigger.click(); // open (fetch)
    await settle(el);
    trigger.click(); // close (no fetch)
    await settle(el);
    expect(el.shadowRoot!.querySelector('[role="menu"]')).toBeNull();
    trigger.click(); // re-open (still no fetch — cached)
    await settle(el);

    expect(loadLocales).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot!.querySelector('[role="menu"]')).not.toBeNull();
  });

  it("emits a composed locale-selected with the picked code and does NOT call setLocale itself", async () => {
    const before = currentLocale();
    const { el } = await mountWidget<LanguageChooser>("dashboard-language-chooser", {
      loadLocales: async () => [{ code: "en-GB", label: "English" }],
    });
    const trigger = el.shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!;
    trigger.click();
    await settle(el);

    let captured: CustomEvent<{ code: string }> | undefined;
    el.addEventListener("locale-selected", (e) => {
      captured = e as CustomEvent<{ code: string }>;
    });
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="lang-en-GB"]')!.click();
    await el.updateComplete;

    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
    expect(captured!.detail).toEqual({ code: "en-GB" });
    // The widget is presentational: it neither switches the locale nor writes the preference.
    expect(currentLocale()).toBe(before);
    // Picking an option closes the menu.
    expect(el.shadowRoot!.querySelector('[role="menu"]')).toBeNull();
  });

  it("marks the active option and reflects a live locale switch on the trigger", async () => {
    const { el } = await mountWidget<LanguageChooser>("dashboard-language-chooser", {
      loadLocales: twoLocales,
    });
    const trigger = el.shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!;
    trigger.click();
    await settle(el);

    const es = el.shadowRoot!.querySelector('[data-test="lang-es-ES"]')!;
    const en = el.shadowRoot!.querySelector('[data-test="lang-en-GB"]')!;
    expect(es.getAttribute("aria-checked")).toBe("true");
    expect(en.getAttribute("aria-checked")).toBe("false");

    // A live switch (setLocale from elsewhere) repaints via the LocaleChangeController.
    setLocale("en-GB");
    await el.updateComplete;
    expect(trigger.textContent).toContain("English");
    expect(
      el.shadowRoot!.querySelector('[data-test="lang-es-ES"]')!.getAttribute("aria-checked"),
    ).toBe("false");
    expect(
      el.shadowRoot!.querySelector('[data-test="lang-en-GB"]')!.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("a rejected loadLocales does NOT escape as an unhandled rejection and leaves the menu closed", async () => {
    // Opening fetches the list; if that fetch rejects (the server is unreachable when the operator taps
    // the chooser) the widget must degrade gracefully. The click handler fires `void #toggle()`, so an
    // un-caught rejection would escape as an UNHANDLED promise rejection (this repo requires pristine
    // test output). Proven by deletion: strip `#toggle`'s try/catch and `rejections` is non-empty here.
    const rejections: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent): void => {
      rejections.push(event.reason);
      event.preventDefault(); // mark handled so it doesn't pollute sibling tests
    };
    window.addEventListener("unhandledrejection", onRejection);
    try {
      const loadLocales = vi.fn().mockRejectedValue({ code: "server.internal" });
      const { el } = await mountWidget<LanguageChooser>("dashboard-language-chooser", {
        loadLocales,
      });
      const trigger = el.shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!;

      trigger.click();
      await settle(el);
      // Give any pending unhandled-rejection notification a couple of macrotasks to surface.
      await settle(el);

      // Sane state: the fetch was attempted, the menu did NOT open, and the trigger stays usable.
      expect(loadLocales).toHaveBeenCalledTimes(1);
      expect(el.shadowRoot!.querySelector('[role="menu"]')).toBeNull();
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      // The rejection was handled inside #toggle, not left unhandled.
      expect(rejections).toEqual([]);

      // The list is left unset, so a LATER open retries — the mock now resolves and the menu populates.
      loadLocales.mockResolvedValue([{ code: "en-GB", label: "English" }]);
      trigger.click();
      await settle(el);
      expect(loadLocales).toHaveBeenCalledTimes(2);
      expect(el.shadowRoot!.querySelector('[role="menu"]')).not.toBeNull();
    } finally {
      window.removeEventListener("unhandledrejection", onRejection);
    }
  });
});
