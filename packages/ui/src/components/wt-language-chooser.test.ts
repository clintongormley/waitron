import { html } from "lit";
import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import type { DataTableColumn, WtDataTable } from "./wt-data-table.js";
import "./wt-data-table.js";
import { WtLanguageChooser } from "./wt-language-chooser.js";

const twoLocales = async () => [
  { code: "es-ES", label: "Español (servidor)" },
  { code: "en-GB", label: "English (server)" },
];

async function mountChooser(props: Partial<WtLanguageChooser> = {}): Promise<WtLanguageChooser> {
  const el = (await mount("<wt-language-chooser></wt-language-chooser>")) as WtLanguageChooser;
  Object.assign(el, props);
  await el.updateComplete;
  return el;
}

const triggerOf = (el: WtLanguageChooser) =>
  el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    '[data-test="lang-trigger"]',
  )!;
const menuOf = (el: WtLanguageChooser) =>
  el.shadowRoot!.querySelector<HTMLElement>('[role="menu"]');
const optionOf = (el: WtLanguageChooser, code: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="lang-${code}"]`);
const innerTriggerOf = (el: WtLanguageChooser) =>
  triggerOf(el).shadowRoot!.querySelector("button")!;
const nameOf = (el: WtLanguageChooser) =>
  triggerOf(el).querySelector('[part="name"]')!.textContent!.trim();
const codePartOf = (el: WtLanguageChooser) =>
  triggerOf(el).querySelector<HTMLElement>('[part="code"]')!;
const namePartOf = (el: WtLanguageChooser) =>
  triggerOf(el).querySelector<HTMLElement>('[part="name"]')!;
/** The element holding focus, followed through every open shadow root. */
function deepActive(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/** The first open awaits `loadLocales()` before flipping `open`, so one `updateComplete` is not enough. */
async function settle(el: WtLanguageChooser): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
}

async function open(el: WtLanguageChooser): Promise<void> {
  triggerOf(el).click();
  await settle(el);
}

const viewport = { width: window.innerWidth, height: window.innerHeight };
afterEach(async () => {
  await page.viewport(viewport.width, viewport.height);
  cleanup();
});

describe("wt-language-chooser", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("wt-language-chooser")).toBe(WtLanguageChooser);
  });

  it("is collapsed and lazy: it names the active language and fetches nothing until opened", async () => {
    const loadLocales = vi.fn(twoLocales);
    const el = await mountChooser({ active: "es-ES", loadLocales });

    expect(loadLocales).not.toHaveBeenCalled();
    expect(menuOf(el)).toBeNull();
    // Before the list loads, the name comes from the languages every app supports.
    expect(nameOf(el)).toBe("Español");

    await open(el);
    expect(loadLocales).toHaveBeenCalledTimes(1);
    expect(menuOf(el)).not.toBeNull();
    expect(optionOf(el, "es-ES")!.textContent!.trim()).toBe("Español (servidor)");
    expect(optionOf(el, "en-GB")!.textContent!.trim()).toBe("English (server)");
    // Once loaded, the trigger reads the loaded name.
    expect(nameOf(el)).toBe("Español (servidor)");
  });

  it("tells a screen reader the trigger opens a menu, and whether it is open, on the inner button", async () => {
    const el = await mountChooser({ active: "es-ES", loadLocales: twoLocales });
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
    const el = await mountChooser({ active: "es-ES", loadLocales });

    await open(el);
    await open(el);
    expect(menuOf(el)).toBeNull();
    await open(el);

    expect(loadLocales).toHaveBeenCalledTimes(1);
    expect(menuOf(el)).not.toBeNull();
  });

  it("a pick closes the menu and sends wt-locale-selected with the code, leaving the language to its parent", async () => {
    const el = await mountChooser({ active: "es-ES", loadLocales: twoLocales });
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
    const el = await mountChooser({ active: "es-ES", loadLocales: twoLocales });
    await open(el);
    let clicks = 0;
    host.addEventListener("click", () => clicks++);

    optionOf(el, "en-GB")!.click();

    expect(clicks).toBe(0);
  });

  it("wt-locale-selected crosses shadow boundaries, so an ancestor outside a wrapping shadow root hears it", async () => {
    const el = (await mountInShadowRoot(
      "<wt-language-chooser active='es-ES'></wt-language-chooser>",
    )) as WtLanguageChooser;
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
    const el = await mountChooser({ active: "es-ES", loadLocales: twoLocales });
    await open(el);
    expect(optionOf(el, "es-ES")!.getAttribute("aria-checked")).toBe("true");
    expect(optionOf(el, "en-GB")!.getAttribute("aria-checked")).toBe("false");

    el.active = "en-GB";
    await el.updateComplete;
    expect(nameOf(el)).toBe("English (server)");
    expect(optionOf(el, "es-ES")!.getAttribute("aria-checked")).toBe("false");
    expect(optionOf(el, "en-GB")!.getAttribute("aria-checked")).toBe("true");
  });

  it("reads the active language from its attribute too", async () => {
    const el = (await mount(
      '<wt-language-chooser active="en-GB"></wt-language-chooser>',
    )) as WtLanguageChooser;
    expect(nameOf(el)).toBe("English");
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
      const el = await mountChooser({ active: "es-ES", loadLocales });
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
    const el = await mountChooser({ active: "es-ES" });
    await open(el);
    const options = [...el.shadowRoot!.querySelectorAll('[role="menuitemradio"]')];
    expect(options.map((option) => option.getAttribute("data-test"))).toEqual([
      "lang-es-ES",
      "lang-en-GB",
    ]);
    expect(options.map((option) => option.textContent!.trim())).toEqual(["Español", "English"]);
  });

  it("names a language nobody has labelled by its code", async () => {
    const el = await mountChooser({ active: "fr-FR", loadLocales: twoLocales });
    expect(nameOf(el)).toBe("fr-FR");
    await open(el);
    expect(nameOf(el)).toBe("fr-FR");
  });

  it("takes its place in the page's flow, between what comes before and after it", async () => {
    await page.viewport(390, 844);
    await mount(
      '<div><p class="before">Before</p><wt-language-chooser active="es-ES"></wt-language-chooser><p class="after">After</p></div>',
    );
    const el = host.querySelector<WtLanguageChooser>("wt-language-chooser")!;
    await el.updateComplete;
    expect(getComputedStyle(el).position).toBe("static");

    const own = el.getBoundingClientRect();
    const before = host.querySelector(".before")!.getBoundingClientRect();
    const after = host.querySelector(".after")!.getBoundingClientRect();
    expect(own.top).toBeGreaterThanOrEqual(before.bottom);
    expect(after.top).toBeGreaterThanOrEqual(own.bottom);
    const trigger = triggerOf(el).getBoundingClientRect();
    expect(trigger.top).toBeGreaterThanOrEqual(own.top);
    expect(trigger.bottom).toBeLessThanOrEqual(own.bottom);
  });

  it("at the trailing end of a top bar, opens its menu downwards, aligned to the trigger's trailing edge, on screen, over what follows", async () => {
    await page.viewport(390, 844);
    await mount(
      '<div><header style="display: flex; justify-content: space-between; align-items: center"><span>Waitron</span><wt-language-chooser active="en-GB"></wt-language-chooser></header><main style="position: relative; height: 400px; background: var(--wt-color-bg)"><button>Below</button></main></div>',
    );
    const el = host.querySelector<WtLanguageChooser>("wt-language-chooser")!;
    el.loadLocales = twoLocales;
    await el.updateComplete;
    const trigger = triggerOf(el).getBoundingClientRect();
    expect(window.innerWidth - trigger.right).toBeLessThanOrEqual(32);

    await open(el);
    const menu = menuOf(el)!.getBoundingClientRect();
    expect(menu.top).toBeGreaterThanOrEqual(trigger.bottom);
    expect(Math.abs(menu.right - trigger.right)).toBeLessThanOrEqual(1);
    expect(menu.left).toBeGreaterThanOrEqual(0);
    expect(menu.right).toBeLessThanOrEqual(window.innerWidth);

    const option = optionOf(el, "es-ES")!.getBoundingClientRect();
    const x = option.left + option.width / 2;
    const y = option.top + option.height / 2;
    expect(y).toBeGreaterThan(host.querySelector("main")!.getBoundingClientRect().top);
    expect(document.elementFromPoint(x, y)).toBe(el);
    expect(el.shadowRoot!.elementFromPoint(x, y)).toBe(optionOf(el, "es-ES"));
  });

  it("opened over a table whose pinned column sits right under the bar, every option is still the thing a press reaches", async () => {
    await page.viewport(390, 844);
    await mount(
      '<div><header style="display: flex; justify-content: space-between; align-items: center"><span>Waitron</span><wt-language-chooser active="en-GB"></wt-language-chooser></header><main><wt-data-table aria-label="Products" style="display: block; width: 100%"></wt-data-table></main></div>',
    );
    const wide = "A long cell that keeps the table wider than the page";
    type Row = { id: string; name: string };
    const table = host.querySelector<WtDataTable<Row>>("wt-data-table")!;
    Object.assign(table, {
      rows: ["a", "b", "c", "d"].map((id) => ({ id, name: `${id}: ${wide}` })),
      rowKey: (row: Row) => row.id,
      columns: [
        { key: "name", label: "Name", cell: (row: Row) => row.name },
        {
          key: "actions",
          label: "Actions",
          pinned: "end",
          cell: () => html`<button>Edit</button>`,
        },
      ] satisfies DataTableColumn<Row>[],
    });
    await table.updateComplete;
    const el = host.querySelector<WtLanguageChooser>("wt-language-chooser")!;
    el.loadLocales = twoLocales;
    await open(el);

    const pinned = [...table.shadowRoot!.querySelectorAll('[data-pinned="end"]')].map((cell) =>
      cell.getBoundingClientRect(),
    );
    for (const code of ["es-ES", "en-GB"]) {
      const option = optionOf(el, code)!.getBoundingClientRect();
      const y = option.top + option.height / 2;
      const under = pinned.find((cell) => y >= cell.top && y <= cell.bottom);
      // The precondition that makes this a test: the pinned column runs under part of the option.
      expect(under, code).toBeDefined();
      expect(under!.left, code).toBeLessThan(option.right);
      const x = (Math.max(option.left, under!.left) + Math.min(option.right, under!.right)) / 2;
      expect(document.elementFromPoint(x, y), code).toBe(el);
      expect(el.shadowRoot!.elementFromPoint(x, y), code).toBe(optionOf(el, code));
    }
  });

  it("shows the full name on the trigger and hides the short code, by default", async () => {
    const el = await mountChooser({ active: "en-GB", loadLocales: twoLocales });
    expect(nameOf(el)).toBe("English");
    expect(codePartOf(el).textContent!.trim()).toBe("EN");
    expect(codePartOf(el).getAttribute("aria-hidden")).toBe("true");
    expect(getComputedStyle(namePartOf(el)).display).not.toBe("none");
    expect(getComputedStyle(codePartOf(el)).display).toBe("none");

    el.active = "es-ES";
    await el.updateComplete;
    expect(codePartOf(el).textContent!.trim()).toBe("ES");
  });

  it("names the trigger with the full language name, for a screen reader, on the inner button", async () => {
    const el = await mountChooser({ active: "es-ES", loadLocales: twoLocales });
    await triggerOf(el).updateComplete;
    expect(innerTriggerOf(el).getAttribute("aria-label")).toBe("Español");

    await open(el);
    await triggerOf(el).updateComplete;
    expect(innerTriggerOf(el).getAttribute("aria-label")).toBe("Español (servidor)");
  });

  it("a page's ::part rules swap the name for the code, and the trigger keeps the full name for a screen reader", async () => {
    const el = await mountChooser({ active: "en-GB", loadLocales: twoLocales });
    const style = document.createElement("style");
    style.textContent =
      "wt-language-chooser::part(name) { display: none } wt-language-chooser::part(code) { display: inline }";
    host.append(style);
    await triggerOf(el).updateComplete;

    expect(getComputedStyle(namePartOf(el)).display).toBe("none");
    expect(getComputedStyle(codePartOf(el)).display).not.toBe("none");
    expect(codePartOf(el).getBoundingClientRect().width).toBeGreaterThan(0);
    expect(innerTriggerOf(el).getAttribute("aria-label")).toBe("English");
  });

  it("the same ::part rules work from the shadow root of the app that holds it", async () => {
    const el = (await mountInShadowRoot(
      "<wt-language-chooser active='es-ES'></wt-language-chooser>",
    )) as WtLanguageChooser;
    const style = document.createElement("style");
    style.textContent =
      "wt-language-chooser::part(name) { display: none } wt-language-chooser::part(code) { display: inline }";
    el.getRootNode().appendChild(style);
    await triggerOf(el).updateComplete;

    expect(getComputedStyle(namePartOf(el)).display).toBe("none");
    expect(codePartOf(el).getBoundingClientRect().width).toBeGreaterThan(0);
    expect(codePartOf(el).textContent!.trim()).toBe("ES");
    expect(innerTriggerOf(el).getAttribute("aria-label")).toBe("Español");
  });

  it("shortens a language nobody has labelled from its code: the language subtag, or a bare code whole, uppercased", async () => {
    const el = await mountChooser({ active: "fr-FR", loadLocales: twoLocales });
    expect(codePartOf(el).textContent!.trim()).toBe("FR");

    el.active = "eu";
    await el.updateComplete;
    expect(nameOf(el)).toBe("eu");
    expect(codePartOf(el).textContent!.trim()).toBe("EU");
  });

  it("paints its menu from the surface and border tokens", async () => {
    const el = await mountChooser({ active: "es-ES", loadLocales: twoLocales });
    host.style.setProperty("--wt-color-surface", "rgb(1, 2, 3)");
    host.style.setProperty("--wt-color-border", "rgb(4, 5, 6)");
    await open(el);
    const menu = getComputedStyle(menuOf(el)!);
    expect(menu.backgroundColor).toBe("rgb(1, 2, 3)");
    expect(menu.borderTopColor).toBe("rgb(4, 5, 6)");
  });

  it("lifts its menu off the page with the shadow token", async () => {
    const el = await mountChooser({ active: "es-ES", loadLocales: twoLocales });
    host.style.setProperty("--wt-shadow-2", "1px 2px 3px 4px rgb(9, 10, 11)");
    await open(el);
    expect(getComputedStyle(menuOf(el)!).boxShadow).toBe("rgb(9, 10, 11) 1px 2px 3px 4px");
  });

  it("follows its trigger when the part of the page holding it scrolls while the menu is open", async () => {
    await mount(
      '<div class="scroller" style="height: 400px; overflow: auto"><div style="height: 3000px"><div style="height: 200px"></div><div style="display: flex; justify-content: flex-end"><wt-language-chooser active="en-GB"></wt-language-chooser></div></div></div>',
    );
    const el = host.querySelector<WtLanguageChooser>("wt-language-chooser")!;
    el.loadLocales = twoLocales;
    // A resize left over from an earlier test's viewport change would re-place the menu by itself.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await open(el);
    const before = triggerOf(el).getBoundingClientRect();

    host.querySelector(".scroller")!.scrollTop = 150;
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const trigger = triggerOf(el).getBoundingClientRect();
    const menu = menuOf(el)!.getBoundingClientRect();
    expect(before.top - trigger.top).toBeCloseTo(150, 0);
    expect(menu.top).toBeGreaterThanOrEqual(trigger.bottom);
    expect(menu.top - trigger.bottom).toBeLessThan(trigger.height);
    expect(Math.abs(menu.right - trigger.right)).toBeLessThanOrEqual(1);
  });

  it("follows its trigger when a container inside the shadow root holding it scrolls", async () => {
    const scroller = await mountInShadowRoot(
      '<div style="height: 400px; overflow: auto"><div style="height: 3000px"><div style="height: 200px"></div><wt-language-chooser active="en-GB"></wt-language-chooser></div></div>',
    );
    const el = scroller.querySelector<WtLanguageChooser>("wt-language-chooser")!;
    el.loadLocales = twoLocales;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await open(el);
    const before = triggerOf(el).getBoundingClientRect();

    scroller.scrollTop = 150;
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const trigger = triggerOf(el).getBoundingClientRect();
    const menu = menuOf(el)!.getBoundingClientRect();
    expect(before.top - trigger.top).toBeCloseTo(150, 0);
    expect(menu.top).toBeGreaterThanOrEqual(trigger.bottom);
    expect(menu.top - trigger.bottom).toBeLessThan(trigger.height);
  });

  it("stops listening for scrolls in the shadow root holding it once the menu closes or it leaves the page", async () => {
    const el = (await mountInShadowRoot(
      "<wt-language-chooser active='es-ES'></wt-language-chooser>",
    )) as WtLanguageChooser;
    el.loadLocales = twoLocales;
    const root = el.getRootNode() as ShadowRoot;
    const added = vi.spyOn(root, "addEventListener");
    const removed = vi.spyOn(root, "removeEventListener");
    try {
      await open(el);
      expect(added.mock.calls.map(([type]) => type)).toEqual(["scroll"]);
      await open(el);
      expect(removed.mock.calls).toEqual(added.mock.calls);

      await open(el);
      el.remove();
      expect(removed.mock.calls).toEqual(added.mock.calls);
    } finally {
      added.mockRestore();
      removed.mockRestore();
    }
  });

  it("a page scroll while the list is still loading opens nothing early", async () => {
    let finish!: (value: Awaited<ReturnType<typeof twoLocales>>) => void;
    const el = await mountChooser({
      active: "es-ES",
      loadLocales: () => new Promise((resolve) => (finish = resolve)),
    });
    triggerOf(el).click();
    window.dispatchEvent(new Event("scroll"));
    expect(menuOf(el)).toBeNull();
    finish(await twoLocales());
    await settle(el);
    expect(menuOf(el)).not.toBeNull();
  });

  it("a menu wider than the room before its trigger stays on screen", async () => {
    await page.viewport(390, 844);
    await mount('<wt-language-chooser active="en-GB"></wt-language-chooser>');
    const el = host.querySelector<WtLanguageChooser>("wt-language-chooser")!;
    el.loadLocales = async () => [
      { code: "es-ES", label: "A language whose name is far longer than the button" },
      { code: "en-GB", label: "English" },
    ];
    await open(el);
    const trigger = triggerOf(el).getBoundingClientRect();
    const menu = menuOf(el)!.getBoundingClientRect();
    expect(menu.width).toBeGreaterThan(trigger.right);
    expect(menu.left).toBeGreaterThanOrEqual(0);
    expect(menu.right).toBeLessThanOrEqual(window.innerWidth);
    expect(menu.top).toBeGreaterThanOrEqual(trigger.bottom);
  });

  it("in a right-to-left page, lines its menu up with the trigger's trailing edge, which is the left one", async () => {
    await page.viewport(390, 844);
    await mount(
      '<div dir="rtl" style="display: flex; justify-content: flex-end; padding-left: 100px"><wt-language-chooser active="en-GB"></wt-language-chooser></div>',
    );
    const el = host.querySelector<WtLanguageChooser>("wt-language-chooser")!;
    el.loadLocales = async () => [
      { code: "es-ES", label: "A language with a longer name" },
      { code: "en-GB", label: "English" },
    ];
    await open(el);
    const trigger = triggerOf(el).getBoundingClientRect();
    const menu = menuOf(el)!.getBoundingClientRect();
    expect(trigger.left).toBeCloseTo(100, 0);
    expect(menu.width).toBeGreaterThan(trigger.width);
    expect(Math.abs(menu.left - trigger.left)).toBeLessThanOrEqual(1);
  });

  it("listens to the window's scrolling and resizing only while open", async () => {
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    const ours = (spy: typeof added) =>
      spy.mock.calls.filter(([type]) => type === "scroll" || type === "resize");
    try {
      const el = await mountChooser({ active: "es-ES", loadLocales: twoLocales });
      expect(ours(added)).toEqual([]);

      await open(el);
      expect(
        ours(added)
          .map(([type]) => type)
          .sort(),
      ).toEqual(["resize", "scroll"]);

      await open(el);
      expect(ours(removed)).toEqual(ours(added));

      await open(el);
      el.remove();
      expect(ours(removed)).toEqual(ours(added));
    } finally {
      added.mockRestore();
      removed.mockRestore();
    }
  });

  it("spaces its menu from the trigger by the spacing token", async () => {
    const el = await mountChooser({ active: "es-ES", loadLocales: twoLocales });
    host.style.setProperty("--wt-space-1", "17px");
    await open(el);
    const trigger = triggerOf(el).getBoundingClientRect();
    const menu = menuOf(el)!.getBoundingClientRect();
    expect(menu.top - trigger.bottom).toBeCloseTo(17, 0);
  });
});

describe("wt-language-chooser keyboard, dismissal and focus", () => {
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

  async function openWithEnter(el: WtLanguageChooser): Promise<void> {
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
    const el = await mountChooser({ active: "en-GB", loadLocales: twoLocales });
    await openWithEnter(el);
    expect(deepActive()).toBe(optionOf(el, "en-GB"));
  });

  it("opening moves focus to the first option when none is checked", async () => {
    const el = await mountChooser({ active: "fr-FR", loadLocales: twoLocales });
    await openWithEnter(el);
    expect(deepActive()).toBe(optionOf(el, "es-ES"));
  });

  it("closed again before its menu draws, it leaves focus on the trigger", async () => {
    const el = await mountChooser({ active: "es-ES", loadLocales: twoLocales });
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
    const el = await mountChooser({ active: "es-ES", loadLocales: twoLocales });
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
    const el = await mountChooser({ active: "es-ES", loadLocales: twoLocales });
    await openWithEnter(el);
    innerTriggerOf(el).focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(deepActive()).toBe(innerTriggerOf(el));
  });

  it("Escape closes the menu, returns focus to the trigger, and goes no further", async () => {
    const el = await mountChooser({ active: "es-ES", loadLocales: twoLocales });
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

  it("Escape with the menu closed passes on to whatever surrounds the chooser", async () => {
    const el = await mountChooser({ active: "es-ES", loadLocales: twoLocales });
    const heard: string[] = [];
    host.addEventListener("keydown", (event) => heard.push(event.key));
    innerTriggerOf(el).focus();

    await userEvent.keyboard("{Escape}");

    expect(heard).toEqual(["Escape"]);
  });

  it("an Escape something inside already handled leaves the menu open", async () => {
    const el = await mountChooser({ active: "es-ES", loadLocales: twoLocales });
    await openWithEnter(el);
    optionOf(el, "es-ES")!.addEventListener("keydown", (event) => event.preventDefault());

    await userEvent.keyboard("{Escape}");
    await el.updateComplete;

    expect(menuOf(el)).not.toBeNull();
  });

  it("a press outside closes the menu and leaves focus where the press put it", async () => {
    const el = await mountChooser({ active: "es-ES", loadLocales: twoLocales });
    const outside = addOutsideButton();
    await openWithEnter(el);

    await userEvent.click(outside);
    await el.updateComplete;

    expect(menuOf(el)).toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  it("a press outside on something that takes no focus closes the menu", async () => {
    const el = await mountChooser({ active: "es-ES", loadLocales: twoLocales });
    const text = document.createElement("p");
    text.textContent = "Some text";
    host.append(text);
    await openWithEnter(el);

    await userEvent.click(text);
    await el.updateComplete;

    expect(menuOf(el)).toBeNull();
  });

  it("a press inside the menu does not close it", async () => {
    const el = await mountChooser({ active: "es-ES", loadLocales: twoLocales });
    await openWithEnter(el);

    menuOf(el)!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    await el.updateComplete;

    expect(menuOf(el)).not.toBeNull();
  });

  it("focus moving outside closes the menu without taking focus back", async () => {
    const el = await mountChooser({ active: "en-GB", loadLocales: twoLocales });
    const outside = addOutsideButton();
    await openWithEnter(el);

    await userEvent.tab();
    await el.updateComplete;

    expect(document.activeElement).toBe(outside);
    expect(menuOf(el)).toBeNull();
  });

  it("a pick with the keyboard closes the menu and returns focus to the trigger", async () => {
    const el = await mountChooser({ active: "es-ES", loadLocales: twoLocales });
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
      const el = await mountChooser({ active: "es-ES", loadLocales: twoLocales });
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
    const el = await mountChooser({ active: "es-ES", loadLocales });

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
    const el = await mountChooser({ active: "es-ES", loadLocales });

    triggerOf(el).click();
    triggerOf(el).click();
    triggerOf(el).click();
    finishes[0]!(await twoLocales());
    await settle(el);

    expect(loadLocales).toHaveBeenCalledTimes(1);
    expect(menuOf(el)).not.toBeNull();
  });

  it("a loader that throws before returning a promise stays closed, and the next open tries again", async () => {
    const el = await mountChooser({
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
    const el = await mountChooser({ active: "es-ES", loadLocales: load.loadLocales });
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
    const el = await mountChooser({ active: "es-ES", loadLocales: load.loadLocales });
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
    const el = await mountChooser({ active: "es-ES", loadLocales: load.loadLocales });
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
    const el = await mountChooser({ active: "es-ES", loadLocales: load.loadLocales });
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
      const a = await mountChooser({ active: "es-ES", loadLocales: opened.loadLocales });
      triggerOf(a).click();
      opened.finish();
      await settle(a);
      expect(menuOf(a)).not.toBeNull();
      await open(a);
      listeners.expectNoneLeft();

      const cancelled = deferredLoad();
      const b = await mountChooser({ active: "es-ES", loadLocales: cancelled.loadLocales });
      triggerOf(b).click();
      triggerOf(b).click();
      cancelled.finish();
      await settle(b);
      expect(menuOf(b)).toBeNull();
      listeners.expectNoneLeft();

      const refused = deferredLoad();
      const c = await mountChooser({ active: "es-ES", loadLocales: refused.loadLocales });
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
    const el = await mountChooser({
      active: "es-ES",
      loadLocales: async () => [{ code: "en-GB", label: "English" }],
    });
    await open(el);
    expect(nameOf(el)).toBe("Español");
    expect(el.shadowRoot!.querySelector('[aria-checked="true"]')).toBeNull();
  });
});
