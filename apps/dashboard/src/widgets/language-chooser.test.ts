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

afterEach(() => {
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

    // Collapsed: no menu, and — with the list unfetched — the trigger falls back to the active code.
    expect(loadLocales).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector('[role="menu"]')).toBeNull();
    const trigger = el.shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!;
    expect(trigger.textContent).toContain("es-ES");

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
});
