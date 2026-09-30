import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import { WtLanguageFooter } from "./wt-language-footer.js";

const twoLocales = async () => [
  { code: "es-ES", label: "Español (servidor)" },
  { code: "en-GB", label: "English (server)" },
];

async function mountFooter(props: Partial<WtLanguageFooter> = {}): Promise<WtLanguageFooter> {
  const el = (await mount("<wt-language-footer></wt-language-footer>")) as WtLanguageFooter;
  Object.assign(el, props);
  await el.updateComplete;
  return el;
}

const triggerOf = (el: WtLanguageFooter) =>
  el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    '[data-test="lang-trigger"]',
  )!;
const menuOf = (el: WtLanguageFooter) => el.shadowRoot!.querySelector<HTMLElement>('[role="menu"]');
const optionOf = (el: WtLanguageFooter, code: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="lang-${code}"]`);

/** The first open awaits `loadLocales()` before flipping `open`, so one `updateComplete` is not enough. */
async function settle(el: WtLanguageFooter): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
}

async function open(el: WtLanguageFooter): Promise<void> {
  triggerOf(el).click();
  await settle(el);
}

const viewport = { width: window.innerWidth, height: window.innerHeight };
afterEach(async () => {
  await page.viewport(viewport.width, viewport.height);
  cleanup();
});

describe("wt-language-footer", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("wt-language-footer")).toBe(WtLanguageFooter);
  });

  it("is collapsed and lazy: it names the active language and fetches nothing until opened", async () => {
    const loadLocales = vi.fn(twoLocales);
    const el = await mountFooter({ active: "es-ES", loadLocales });

    expect(loadLocales).not.toHaveBeenCalled();
    expect(menuOf(el)).toBeNull();
    // Before the list loads, the name comes from the languages every app supports.
    expect(triggerOf(el).textContent!.trim()).toBe("Español");

    await open(el);
    expect(loadLocales).toHaveBeenCalledTimes(1);
    expect(menuOf(el)).not.toBeNull();
    expect(optionOf(el, "es-ES")!.textContent!.trim()).toBe("Español (servidor)");
    expect(optionOf(el, "en-GB")!.textContent!.trim()).toBe("English (server)");
    // Once loaded, the trigger reads the loaded name.
    expect(triggerOf(el).textContent!.trim()).toBe("Español (servidor)");
  });

  it("tells a screen reader the trigger opens a menu, and whether it is open, on the inner button", async () => {
    const el = await mountFooter({ active: "es-ES", loadLocales: twoLocales });
    const trigger = triggerOf(el);
    const inner = trigger.shadowRoot!.querySelector("button")!;
    await trigger.updateComplete;
    expect(inner.getAttribute("aria-haspopup")).toBe("menu");
    expect(inner.getAttribute("aria-expanded")).toBe("false");

    await open(el);
    await trigger.updateComplete;
    expect(inner.getAttribute("aria-expanded")).toBe("true");

    await open(el);
    await trigger.updateComplete;
    expect(inner.getAttribute("aria-expanded")).toBe("false");
  });

  it("fetches once: closing and re-opening does not fetch again", async () => {
    const loadLocales = vi.fn(twoLocales);
    const el = await mountFooter({ active: "es-ES", loadLocales });

    await open(el);
    await open(el);
    expect(menuOf(el)).toBeNull();
    await open(el);

    expect(loadLocales).toHaveBeenCalledTimes(1);
    expect(menuOf(el)).not.toBeNull();
  });

  it("a pick closes the menu and sends wt-locale-selected with the code, leaving the language to its parent", async () => {
    const el = await mountFooter({ active: "es-ES", loadLocales: twoLocales });
    await open(el);

    const heard: CustomEvent<{ code: string }>[] = [];
    el.addEventListener("wt-locale-selected", (e) =>
      heard.push(e as CustomEvent<{ code: string }>),
    );
    optionOf(el, "en-GB")!.click();
    await el.updateComplete;

    expect(heard).toHaveLength(1);
    expect(heard[0]!.bubbles).toBe(true);
    expect(heard[0]!.composed).toBe(true);
    expect(heard[0]!.detail).toEqual({ code: "en-GB" });
    expect(el.active).toBe("es-ES");
    expect(menuOf(el)).toBeNull();
  });

  it("does not let the option's own click escape the component", async () => {
    const el = await mountFooter({ active: "es-ES", loadLocales: twoLocales });
    await open(el);
    let clicks = 0;
    host.addEventListener("click", () => clicks++);

    optionOf(el, "en-GB")!.click();

    expect(clicks).toBe(0);
  });

  it("wt-locale-selected crosses shadow boundaries, so an ancestor outside a wrapping shadow root hears it", async () => {
    const el = (await mountInShadowRoot(
      "<wt-language-footer active='es-ES'></wt-language-footer>",
    )) as WtLanguageFooter;
    el.loadLocales = twoLocales;
    await open(el);
    let code: string | undefined;
    document.addEventListener(
      "wt-locale-selected",
      (e) => (code = (e as CustomEvent<{ code: string }>).detail.code),
      { once: true },
    );

    optionOf(el, "en-GB")!.click();

    expect(code).toBe("en-GB");
  });

  it("marks the active option, and follows its parent when the active language changes", async () => {
    const el = await mountFooter({ active: "es-ES", loadLocales: twoLocales });
    await open(el);
    expect(optionOf(el, "es-ES")!.getAttribute("aria-checked")).toBe("true");
    expect(optionOf(el, "en-GB")!.getAttribute("aria-checked")).toBe("false");

    el.active = "en-GB";
    await el.updateComplete;
    expect(triggerOf(el).textContent!.trim()).toBe("English (server)");
    expect(optionOf(el, "es-ES")!.getAttribute("aria-checked")).toBe("false");
    expect(optionOf(el, "en-GB")!.getAttribute("aria-checked")).toBe("true");
  });

  it("reads the active language from its attribute too", async () => {
    const el = (await mount(
      '<wt-language-footer active="en-GB"></wt-language-footer>',
    )) as WtLanguageFooter;
    expect(triggerOf(el).textContent!.trim()).toBe("English");
  });

  it("a failed load stays closed, raises no unhandled rejection, and the next open tries again", async () => {
    const rejections: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent): void => {
      rejections.push(event.reason);
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", onRejection);
    try {
      const loadLocales = vi.fn().mockRejectedValue({ code: "server.internal" });
      const el = await mountFooter({ active: "es-ES", loadLocales });
      const trigger = triggerOf(el);

      await open(el);
      // Give an unhandled-rejection notification time to surface.
      await settle(el);
      await trigger.updateComplete;

      expect(loadLocales).toHaveBeenCalledTimes(1);
      expect(menuOf(el)).toBeNull();
      expect(trigger.shadowRoot!.querySelector("button")!.getAttribute("aria-expanded")).toBe(
        "false",
      );
      expect(rejections).toEqual([]);

      loadLocales.mockResolvedValue([{ code: "en-GB", label: "English" }]);
      await open(el);
      expect(loadLocales).toHaveBeenCalledTimes(2);
      expect(menuOf(el)).not.toBeNull();
    } finally {
      window.removeEventListener("unhandledrejection", onRejection);
    }
  });

  it("offers every language the apps support when it is given no list", async () => {
    const el = await mountFooter({ active: "es-ES" });
    await open(el);
    const options = [...el.shadowRoot!.querySelectorAll('[role="menuitemradio"]')];
    expect(options.map((option) => option.getAttribute("data-test"))).toEqual([
      "lang-es-ES",
      "lang-en-GB",
    ]);
    expect(options.map((option) => option.textContent!.trim())).toEqual(["Español", "English"]);
  });

  it("names a language nobody has labelled by its code", async () => {
    const el = await mountFooter({ active: "fr-FR", loadLocales: twoLocales });
    expect(triggerOf(el).textContent!.trim()).toBe("fr-FR");
    await open(el);
    expect(triggerOf(el).textContent!.trim()).toBe("fr-FR");
  });

  it("takes its place in the page's flow, between what comes before and after it", async () => {
    await page.viewport(390, 844);
    await mount(
      '<div><p class="before">Before</p><wt-language-footer active="es-ES"></wt-language-footer><p class="after">After</p></div>',
    );
    const el = host.querySelector<WtLanguageFooter>("wt-language-footer")!;
    await el.updateComplete;
    const footer = el.shadowRoot!.querySelector("footer")!;
    expect(getComputedStyle(el).position).toBe("static");
    expect(["static", "relative"]).toContain(getComputedStyle(footer).position);

    const own = el.getBoundingClientRect();
    const before = host.querySelector(".before")!.getBoundingClientRect();
    const after = host.querySelector(".after")!.getBoundingClientRect();
    expect(own.top).toBeGreaterThanOrEqual(before.bottom);
    expect(after.top).toBeGreaterThanOrEqual(own.bottom);
    const trigger = triggerOf(el).getBoundingClientRect();
    expect(trigger.top).toBeGreaterThanOrEqual(own.top);
    expect(trigger.bottom).toBeLessThanOrEqual(own.bottom);
  });

  it("puts the trigger at the trailing edge and opens its menu upwards, on screen, at phone width", async () => {
    await page.viewport(390, 844);
    await mount(
      '<div style="padding-top: 200px"><wt-language-footer active="en-GB"></wt-language-footer></div>',
    );
    const el = host.querySelector<WtLanguageFooter>("wt-language-footer")!;
    el.loadLocales = twoLocales;
    await el.updateComplete;
    const own = el.getBoundingClientRect();
    const trigger = triggerOf(el).getBoundingClientRect();
    expect(own.right - trigger.right).toBeLessThanOrEqual(32);
    expect(trigger.left).toBeGreaterThan(own.left + own.width / 2);

    await open(el);
    const menu = menuOf(el)!.getBoundingClientRect();
    expect(menu.bottom).toBeLessThanOrEqual(trigger.top);
    expect(menu.left).toBeGreaterThanOrEqual(0);
    expect(menu.right).toBeLessThanOrEqual(window.innerWidth);
  });

  it("paints its menu from the surface and border tokens", async () => {
    const el = await mountFooter({ active: "es-ES", loadLocales: twoLocales });
    host.style.setProperty("--wt-color-surface", "rgb(1, 2, 3)");
    host.style.setProperty("--wt-color-border", "rgb(4, 5, 6)");
    await open(el);
    const menu = getComputedStyle(menuOf(el)!);
    expect(menu.backgroundColor).toBe("rgb(1, 2, 3)");
    expect(menu.borderTopColor).toBe("rgb(4, 5, 6)");
  });

  it("spaces the footer from the spacing token", async () => {
    const el = await mountFooter({ active: "es-ES" });
    host.style.setProperty("--wt-space-3", "17px");
    const footer = getComputedStyle(el.shadowRoot!.querySelector("footer")!);
    expect(footer.paddingTop).toBe("17px");
  });
});
