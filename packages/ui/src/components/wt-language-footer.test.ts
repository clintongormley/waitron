import { page, userEvent } from "vitest/browser";
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
const innerTriggerOf = (el: WtLanguageFooter) => triggerOf(el).shadowRoot!.querySelector("button")!;
/** The element holding focus, followed through every open shadow root. */
function deepActive(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

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

describe("wt-language-footer keyboard, dismissal and focus", () => {
  function deferredLoad() {
    let resolve!: (value: Awaited<ReturnType<typeof twoLocales>>) => void;
    let reject!: (reason: unknown) => void;
    return {
      loadLocales: () =>
        new Promise<Awaited<ReturnType<typeof twoLocales>>>((res, rej) => {
          resolve = res;
          reject = rej;
        }),
      finish: async () => resolve(await twoLocales()),
      fail: () => reject({ code: "server.internal" }),
    };
  }

  /** Every document listener added since it started must have been removed with the same arguments. */
  function watchDocumentListeners() {
    const added = vi.spyOn(document, "addEventListener");
    const removed = vi.spyOn(document, "removeEventListener");
    const calls = (spy: typeof added) =>
      spy.mock.calls.map((args) => args.map(String).join(" ")).sort();
    return {
      expectNoneLeft: () => expect(calls(removed)).toEqual(calls(added)),
      restore: () => {
        added.mockRestore();
        removed.mockRestore();
      },
    };
  }

  async function openWithEnter(el: WtLanguageFooter): Promise<void> {
    innerTriggerOf(el).focus();
    await userEvent.keyboard("{Enter}");
    await settle(el);
    expect(menuOf(el)).not.toBeNull();
  }

  function addOutsideButton(): HTMLButtonElement {
    const outside = document.createElement("button");
    outside.textContent = "Outside";
    host.append(outside);
    return outside;
  }

  it("opening with Enter moves focus to the checked option", async () => {
    const el = await mountFooter({ active: "en-GB", loadLocales: twoLocales });
    await openWithEnter(el);
    expect(deepActive()).toBe(optionOf(el, "en-GB"));
  });

  it("opening moves focus to the first option when none is checked", async () => {
    const el = await mountFooter({ active: "fr-FR", loadLocales: twoLocales });
    await openWithEnter(el);
    expect(deepActive()).toBe(optionOf(el, "es-ES"));
  });

  it("closed again before its menu draws, it leaves focus on the trigger", async () => {
    const el = await mountFooter({ active: "es-ES", loadLocales: twoLocales });
    await open(el);
    await open(el);
    innerTriggerOf(el).focus();

    triggerOf(el).click();
    triggerOf(el).click();
    await settle(el);

    expect(menuOf(el)).toBeNull();
    expect(deepActive()).toBe(innerTriggerOf(el));
  });

  it("arrow keys move between the options and wrap; Home and End reach the ends", async () => {
    const el = await mountFooter({ active: "es-ES", loadLocales: twoLocales });
    await openWithEnter(el);
    const es = optionOf(el, "es-ES");
    const en = optionOf(el, "en-GB");

    await userEvent.keyboard("{ArrowDown}");
    expect(deepActive()).toBe(en);
    await userEvent.keyboard("{ArrowDown}");
    expect(deepActive()).toBe(es);
    await userEvent.keyboard("{ArrowUp}");
    expect(deepActive()).toBe(en);
    await userEvent.keyboard("{ArrowUp}");
    expect(deepActive()).toBe(es);
    await userEvent.keyboard("{End}");
    expect(deepActive()).toBe(en);
    await userEvent.keyboard("{Home}");
    expect(deepActive()).toBe(es);
    await userEvent.keyboard("a");
    expect(deepActive()).toBe(es);
    expect(menuOf(el)).not.toBeNull();
  });

  it("an arrow key on the trigger moves nothing", async () => {
    const el = await mountFooter({ active: "es-ES", loadLocales: twoLocales });
    await openWithEnter(el);
    innerTriggerOf(el).focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(deepActive()).toBe(innerTriggerOf(el));
  });

  it("Escape closes the menu, returns focus to the trigger, and goes no further", async () => {
    const el = await mountFooter({ active: "es-ES", loadLocales: twoLocales });
    const heard: string[] = [];
    host.addEventListener("keydown", (event) => heard.push(event.key));
    await openWithEnter(el);
    heard.length = 0;

    await userEvent.keyboard("{Escape}");
    await el.updateComplete;

    expect(menuOf(el)).toBeNull();
    expect(deepActive()).toBe(innerTriggerOf(el));
    expect(heard).toEqual([]);
  });

  it("Escape with the menu closed passes on to whatever surrounds the footer", async () => {
    const el = await mountFooter({ active: "es-ES", loadLocales: twoLocales });
    const heard: string[] = [];
    host.addEventListener("keydown", (event) => heard.push(event.key));
    innerTriggerOf(el).focus();

    await userEvent.keyboard("{Escape}");

    expect(heard).toEqual(["Escape"]);
  });

  it("an Escape something inside already handled leaves the menu open", async () => {
    const el = await mountFooter({ active: "es-ES", loadLocales: twoLocales });
    await openWithEnter(el);
    optionOf(el, "es-ES")!.addEventListener("keydown", (event) => event.preventDefault());

    await userEvent.keyboard("{Escape}");
    await el.updateComplete;

    expect(menuOf(el)).not.toBeNull();
  });

  it("a press outside closes the menu and leaves focus where the press put it", async () => {
    const el = await mountFooter({ active: "es-ES", loadLocales: twoLocales });
    const outside = addOutsideButton();
    await openWithEnter(el);

    await userEvent.click(outside);
    await el.updateComplete;

    expect(menuOf(el)).toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  it("a press outside on something that takes no focus closes the menu", async () => {
    const el = await mountFooter({ active: "es-ES", loadLocales: twoLocales });
    const text = document.createElement("p");
    text.textContent = "Some text";
    host.append(text);
    await openWithEnter(el);

    await userEvent.click(text);
    await el.updateComplete;

    expect(menuOf(el)).toBeNull();
  });

  it("a click on the footer's empty area does not put focus on the trigger", async () => {
    await page.viewport(390, 844);
    const el = await mountFooter({ active: "es-ES", loadLocales: twoLocales });
    const field = document.createElement("input");
    field.setAttribute("aria-label", "Email");
    host.prepend(field);
    await userEvent.click(field);

    const footer = el.shadowRoot!.querySelector("footer")!;
    await userEvent.click(footer, { position: { x: 4, y: 4 } });

    expect(deepActive()).not.toBe(innerTriggerOf(el));
    expect(document.activeElement).toBe(document.body);
  });

  it("a press inside the menu does not close it", async () => {
    const el = await mountFooter({ active: "es-ES", loadLocales: twoLocales });
    await openWithEnter(el);

    menuOf(el)!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    await el.updateComplete;

    expect(menuOf(el)).not.toBeNull();
  });

  it("focus moving outside closes the menu without taking focus back", async () => {
    const el = await mountFooter({ active: "en-GB", loadLocales: twoLocales });
    const outside = addOutsideButton();
    await openWithEnter(el);

    await userEvent.tab();
    await el.updateComplete;

    expect(document.activeElement).toBe(outside);
    expect(menuOf(el)).toBeNull();
  });

  it("a pick with the keyboard closes the menu and returns focus to the trigger", async () => {
    const el = await mountFooter({ active: "es-ES", loadLocales: twoLocales });
    const heard: string[] = [];
    el.addEventListener("wt-locale-selected", (e) =>
      heard.push((e as CustomEvent<{ code: string }>).detail.code),
    );
    await openWithEnter(el);

    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    await el.updateComplete;

    expect(heard).toEqual(["en-GB"]);
    expect(menuOf(el)).toBeNull();
    expect(deepActive()).toBe(innerTriggerOf(el));
  });

  it("listens on the document only while open, and stops when it closes or leaves the page", async () => {
    const added = vi.spyOn(document, "addEventListener");
    const removed = vi.spyOn(document, "removeEventListener");
    try {
      const el = await mountFooter({ active: "es-ES", loadLocales: twoLocales });
      expect(added).not.toHaveBeenCalled();

      await open(el);
      const listeners = added.mock.calls.map(([type, listener]) => [type, listener]);
      expect(listeners.map(([type]) => type).sort()).toEqual(["focusin", "pointerdown"]);

      await open(el);
      expect(removed.mock.calls.map(([type, listener]) => [type, listener])).toEqual(
        expect.arrayContaining(listeners),
      );
      expect(removed).toHaveBeenCalledTimes(2);

      removed.mockClear();
      await open(el);
      el.remove();
      expect(removed).toHaveBeenCalledTimes(2);
    } finally {
      added.mockRestore();
      removed.mockRestore();
    }
  });

  it("a second press while the first load is pending starts no second load, and the menu stays closed", async () => {
    const finishes: ((value: Awaited<ReturnType<typeof twoLocales>>) => void)[] = [];
    const loadLocales = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<typeof twoLocales>>>((resolve) => finishes.push(resolve)),
    );
    const el = await mountFooter({ active: "es-ES", loadLocales });

    triggerOf(el).click();
    triggerOf(el).click();
    expect(loadLocales).toHaveBeenCalledTimes(1);

    finishes[0]!(await twoLocales());
    await settle(el);
    expect(menuOf(el)).toBeNull();

    await open(el);
    expect(loadLocales).toHaveBeenCalledTimes(1);
    expect(menuOf(el)).not.toBeNull();
  });

  it("a third press while the load is pending asks for the menu again, still with one load", async () => {
    const finishes: ((value: Awaited<ReturnType<typeof twoLocales>>) => void)[] = [];
    const loadLocales = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<typeof twoLocales>>>((resolve) => finishes.push(resolve)),
    );
    const el = await mountFooter({ active: "es-ES", loadLocales });

    triggerOf(el).click();
    triggerOf(el).click();
    triggerOf(el).click();
    finishes[0]!(await twoLocales());
    await settle(el);

    expect(loadLocales).toHaveBeenCalledTimes(1);
    expect(menuOf(el)).not.toBeNull();
  });

  it("a loader that throws before returning a promise stays closed, and the next open tries again", async () => {
    const el = await mountFooter({
      active: "es-ES",
      loadLocales: () => {
        throw new Error("refused");
      },
    });
    await open(el);
    expect(menuOf(el)).toBeNull();

    el.loadLocales = twoLocales;
    await open(el);
    expect(menuOf(el)).not.toBeNull();
  });

  it("removed while its first load is pending, it opens nothing and leaves no document listener", async () => {
    const load = deferredLoad();
    const el = await mountFooter({ active: "es-ES", loadLocales: load.loadLocales });
    const listeners = watchDocumentListeners();
    try {
      triggerOf(el).click();
      el.remove();
      load.finish();
      await settle(el);

      expect(menuOf(el)).toBeNull();
      listeners.expectNoneLeft();
    } finally {
      listeners.restore();
    }
  });

  it("press, move focus outside, then the load finishes: the menu stays closed and focus stays where the user put it", async () => {
    const load = deferredLoad();
    const el = await mountFooter({ active: "es-ES", loadLocales: load.loadLocales });
    const field = document.createElement("input");
    field.setAttribute("aria-label", "Email");
    host.append(field);

    await userEvent.click(innerTriggerOf(el));
    await userEvent.click(field);
    load.finish();
    await settle(el);

    expect(menuOf(el)).toBeNull();
    expect(document.activeElement).toBe(field);
  });

  it("a press outside on something that takes no focus, while the load is pending, cancels the opening", async () => {
    const load = deferredLoad();
    const el = await mountFooter({ active: "es-ES", loadLocales: load.loadLocales });
    const text = document.createElement("p");
    text.textContent = "Some text";
    host.append(text);

    await userEvent.click(innerTriggerOf(el));
    await userEvent.click(text);
    load.finish();
    await settle(el);

    expect(menuOf(el)).toBeNull();
  });

  it("Escape while the load is pending cancels the opening and goes no further", async () => {
    const load = deferredLoad();
    const el = await mountFooter({ active: "es-ES", loadLocales: load.loadLocales });
    const heard: string[] = [];
    host.addEventListener("keydown", (event) => heard.push(event.key));
    innerTriggerOf(el).focus();

    await userEvent.keyboard("{Enter}");
    heard.length = 0;
    await userEvent.keyboard("{Escape}");
    load.finish();
    await settle(el);

    expect(menuOf(el)).toBeNull();
    expect(deepActive()).toBe(innerTriggerOf(el));
    expect(heard).toEqual([]);
  });

  it("however a pending load ends, no document listener is left behind once the menu is closed", async () => {
    const listeners = watchDocumentListeners();
    try {
      const opened = deferredLoad();
      const a = await mountFooter({ active: "es-ES", loadLocales: opened.loadLocales });
      triggerOf(a).click();
      opened.finish();
      await settle(a);
      expect(menuOf(a)).not.toBeNull();
      await open(a);
      listeners.expectNoneLeft();

      const cancelled = deferredLoad();
      const b = await mountFooter({ active: "es-ES", loadLocales: cancelled.loadLocales });
      triggerOf(b).click();
      triggerOf(b).click();
      cancelled.finish();
      await settle(b);
      expect(menuOf(b)).toBeNull();
      listeners.expectNoneLeft();

      const refused = deferredLoad();
      const c = await mountFooter({ active: "es-ES", loadLocales: refused.loadLocales });
      triggerOf(c).click();
      refused.fail();
      await settle(c);
      expect(menuOf(c)).toBeNull();
      listeners.expectNoneLeft();
    } finally {
      listeners.restore();
    }
  });

  it("keeps the active language's name when the loaded list does not include it", async () => {
    const el = await mountFooter({
      active: "es-ES",
      loadLocales: async () => [{ code: "en-GB", label: "English" }],
    });
    await open(el);
    expect(triggerOf(el).textContent!.trim()).toBe("Español");
    expect(el.shadowRoot!.querySelector('[aria-checked="true"]')).toBeNull();
  });
});
