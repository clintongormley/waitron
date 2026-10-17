import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import type { ThemeChoice } from "../theme-choice.js";
import { WtThemeChooser } from "./wt-theme-chooser.js";
import "./wt-icon.js";

async function mountChooser(props: Partial<WtThemeChooser> = {}): Promise<WtThemeChooser> {
  const el = (await mount("<wt-theme-chooser></wt-theme-chooser>")) as WtThemeChooser;
  Object.assign(el, props);
  await el.updateComplete;
  await triggerOf(el).updateComplete;
  return el;
}

const triggerOf = (el: WtThemeChooser) =>
  el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    '[data-test="theme-trigger"]',
  )!;
const innerTriggerOf = (el: WtThemeChooser) => triggerOf(el).shadowRoot!.querySelector("button")!;
const triggerIconOf = (el: WtThemeChooser) => triggerOf(el).querySelector("wt-icon")!;
const menuOf = (el: WtThemeChooser) => el.shadowRoot!.querySelector<HTMLElement>('[role="menu"]');
const optionOf = (el: WtThemeChooser, choice: ThemeChoice) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="theme-${choice}"]`);
const optionsOf = (el: WtThemeChooser) => [
  ...el.shadowRoot!.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
];

/** The element holding focus, followed through every open shadow root. */
function deepActive(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

async function open(el: WtThemeChooser): Promise<void> {
  triggerOf(el).click();
  await el.updateComplete;
  await triggerOf(el).updateComplete;
}

async function openWithEnter(el: WtThemeChooser): Promise<void> {
  innerTriggerOf(el).focus();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  await el.updateComplete;
  expect(menuOf(el)).not.toBeNull();
}

function addOutsideButton(): HTMLButtonElement {
  const outside = document.createElement("button");
  outside.textContent = "Outside";
  host.append(outside);
  return outside;
}

const viewport = { width: window.innerWidth, height: window.innerHeight };
afterEach(async () => {
  await page.viewport(viewport.width, viewport.height);
  cleanup();
});

describe("wt-theme-chooser", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("wt-theme-chooser")).toBe(WtThemeChooser);
  });

  it("draws the active choice's icon and names its trigger with the label and the choice", async () => {
    const el = await mountChooser({ active: "dark" });
    expect(triggerIconOf(el).getAttribute("name")).toBe("theme-dark");
    await expect
      .element(page.elementLocator(innerTriggerOf(el)))
      .toHaveAccessibleName("Theme: Dark");

    el.labels = { theme: "Tema", light: "Claro", dark: "Oscuro", device: "Según el dispositivo" };
    await el.updateComplete;
    await triggerOf(el).updateComplete;
    await expect
      .element(page.elementLocator(innerTriggerOf(el)))
      .toHaveAccessibleName("Tema: Oscuro");
  });

  it("draws Follow device for no choice or a choice it does not know", async () => {
    const el = await mountChooser();
    expect(triggerIconOf(el).getAttribute("name")).toBe("theme-device");
    await expect
      .element(page.elementLocator(innerTriggerOf(el)))
      .toHaveAccessibleName("Theme: Follow device");

    cleanup();
    const unknown = (await mount(
      '<wt-theme-chooser active="sepia"></wt-theme-chooser>',
    )) as WtThemeChooser;
    await triggerOf(unknown).updateComplete;
    expect(triggerIconOf(unknown).getAttribute("name")).toBe("theme-device");
    await expect
      .element(page.elementLocator(innerTriggerOf(unknown)))
      .toHaveAccessibleName("Theme: Follow device");
    await open(unknown);
    expect(optionsOf(unknown).map((o) => o.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "true",
    ]);
  });

  it("tells a screen reader the trigger opens a menu, and whether it is open", async () => {
    const el = await mountChooser({ active: "light" });
    const inner = innerTriggerOf(el);
    expect(inner.getAttribute("aria-haspopup")).toBe("menu");
    expect(inner.getAttribute("aria-expanded")).toBe("false");

    await open(el);
    expect(inner.getAttribute("aria-expanded")).toBe("true");

    await open(el);
    expect(inner.getAttribute("aria-expanded")).toBe("false");
    expect(menuOf(el)).toBeNull();
  });

  it("opens a menu of Light, Dark and Follow device, in that order, with the active one checked", async () => {
    const el = await mountChooser({ active: "dark" });
    expect(menuOf(el)).toBeNull();
    await open(el);
    const options = optionsOf(el);
    expect(options).toHaveLength(3);
    expect(options.map((o) => o.textContent!.trim())).toEqual(["Light", "Dark", "Follow device"]);
    expect(options.map((o) => o.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(options.map((o) => o.querySelector("wt-icon")!.getAttribute("name"))).toEqual([
      "theme-light",
      "theme-dark",
      "theme-device",
    ]);
  });

  it("follows its parent when the active choice changes", async () => {
    const el = await mountChooser({ active: "dark" });
    await open(el);
    el.active = "light";
    await el.updateComplete;
    expect(optionsOf(el).map((o) => o.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    expect(triggerIconOf(el).getAttribute("name")).toBe("theme-light");
  });

  it("a pick closes the menu, returns focus to the trigger, and sends wt-theme-selected, leaving the theme alone", async () => {
    const el = await mountChooser({ active: "dark" });
    const rootTheme = document.documentElement.getAttribute("data-theme");
    const hostTheme = host.getAttribute("data-theme");
    await open(el);
    const heard: CustomEvent<{ choice: ThemeChoice }>[] = [];
    const listener = (e: Event) => heard.push(e as CustomEvent<{ choice: ThemeChoice }>);
    document.addEventListener("wt-theme-selected", listener);
    try {
      optionOf(el, "light")!.click();
      await el.updateComplete;
    } finally {
      document.removeEventListener("wt-theme-selected", listener);
    }

    expect(heard).toHaveLength(1);
    expect(heard[0]!.detail).toEqual({ choice: "light" });
    expect(heard[0]!.bubbles).toBe(true);
    expect(heard[0]!.composed).toBe(true);
    expect(menuOf(el)).toBeNull();
    expect(deepActive()).toBe(innerTriggerOf(el));
    expect(el.active).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe(rootTheme);
    expect(host.getAttribute("data-theme")).toBe(hostTheme);
  });

  it("does not let the option's own click escape the component", async () => {
    const el = await mountChooser({ active: "dark" });
    await open(el);
    const option = optionOf(el, "light")!;
    const escaped: EventTarget[] = [];
    host.addEventListener("click", (event) => escaped.push(event.composedPath()[0]!));

    option.click();

    expect(escaped).not.toContain(option);
  });

  it("wt-theme-selected crosses shadow boundaries", async () => {
    const el = (await mountInShadowRoot(
      "<wt-theme-chooser active='light'></wt-theme-chooser>",
    )) as WtThemeChooser;
    await open(el);
    let choice: ThemeChoice | undefined;
    document.addEventListener(
      "wt-theme-selected",
      (e) => (choice = (e as CustomEvent<{ choice: ThemeChoice }>).detail.choice),
      { once: true },
    );

    optionOf(el, "device")!.click();

    expect(choice).toBe("device");
  });

  it("opening focuses the checked option; arrow keys wrap; Home and End reach the ends; Escape closes and returns focus", async () => {
    const el = await mountChooser({ active: "dark" });
    const heard: string[] = [];
    host.addEventListener("keydown", (event) => heard.push(event.key));
    await openWithEnter(el);
    const [light, dark, device] = [
      optionOf(el, "light"),
      optionOf(el, "dark"),
      optionOf(el, "device"),
    ];
    expect(deepActive()).toBe(dark);

    await userEvent.keyboard("{ArrowDown}");
    expect(deepActive()).toBe(device);
    await userEvent.keyboard("{ArrowDown}");
    expect(deepActive()).toBe(light);
    await userEvent.keyboard("{ArrowUp}");
    expect(deepActive()).toBe(device);
    await userEvent.keyboard("{Home}");
    expect(deepActive()).toBe(light);
    await userEvent.keyboard("{End}");
    expect(deepActive()).toBe(device);

    heard.length = 0;
    await userEvent.keyboard("{Escape}");
    await el.updateComplete;
    expect(menuOf(el)).toBeNull();
    expect(deepActive()).toBe(innerTriggerOf(el));
    expect(heard).toEqual([]);

    // Closed, a key passes through untouched.
    await userEvent.keyboard("{Escape}");
    expect(heard).toEqual(["Escape"]);
  });

  it("a press outside closes the menu, and so does focus moving outside", async () => {
    const el = await mountChooser({ active: "device" });
    const outside = addOutsideButton();
    await openWithEnter(el);

    await userEvent.click(outside);
    await el.updateComplete;
    expect(menuOf(el)).toBeNull();
    expect(document.activeElement).toBe(outside);

    await openWithEnter(el);
    await userEvent.tab();
    await el.updateComplete;
    expect(document.activeElement).toBe(outside);
    expect(menuOf(el)).toBeNull();
  });

  it("closes when it leaves the page while open, so it comes back closed", async () => {
    const el = await mountChooser({ active: "device" });
    await open(el);
    el.remove();
    host.append(el);
    await el.updateComplete;
    expect(menuOf(el)).toBeNull();
  });

  it("at the trailing end of a top bar, opens below its trigger, trailing edges lined up, on screen", async () => {
    await page.viewport(390, 844);
    await mount(
      '<header style="display: flex; justify-content: flex-end; padding-inline: var(--wt-space-3)"><wt-theme-chooser active="light"></wt-theme-chooser></header>',
    );
    const el = host.querySelector<WtThemeChooser>("wt-theme-chooser")!;
    await el.updateComplete;
    await open(el);

    const space = parseFloat(getComputedStyle(el).getPropertyValue("--wt-space-1"));
    const trigger = triggerOf(el).getBoundingClientRect();
    const menu = menuOf(el)!.getBoundingClientRect();
    expect(Math.abs(menu.top - (trigger.bottom + space))).toBeLessThanOrEqual(1);
    expect(Math.abs(menu.right - trigger.right)).toBeLessThanOrEqual(1);
    expect(menu.left).toBeGreaterThanOrEqual(0);
    expect(menu.right).toBeLessThanOrEqual(window.innerWidth);
    expect(menu.bottom).toBeLessThanOrEqual(window.innerHeight);
  });

  it("paints its menu from the surface, text and border tokens", async () => {
    const el = await mountChooser({ active: "dark" });
    host.style.setProperty("--wt-color-surface", "rgb(1, 2, 3)");
    host.style.setProperty("--wt-color-text", "rgb(4, 5, 6)");
    host.style.setProperty("--wt-color-border", "rgb(7, 8, 9)");
    await open(el);
    const menu = getComputedStyle(menuOf(el)!);
    expect(menu.backgroundColor).toBe("rgb(1, 2, 3)");
    expect(getComputedStyle(optionOf(el, "light")!).color).toBe("rgb(4, 5, 6)");
    expect(menu.borderTopColor).toBe("rgb(7, 8, 9)");
  });

  it("lays each option's icon beside its label", async () => {
    const el = await mountChooser({ active: "dark" });
    await open(el);
    const option = optionOf(el, "light")!;
    expect(getComputedStyle(option).display).toBe("flex");
    const icon = option.querySelector("wt-icon")!.getBoundingClientRect();
    const range = document.createRange();
    const label = [...option.childNodes].find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim() === "Light",
    )!;
    range.selectNodeContents(label);
    const text = range.getBoundingClientRect();
    expect(icon.right).toBeLessThanOrEqual(text.left);
    expect(Math.abs(icon.top + icon.height / 2 - (text.top + text.height / 2))).toBeLessThanOrEqual(
      2,
    );
  });

  it.each(["theme-light", "theme-dark", "theme-device"])("draws its %s icon", async (name) => {
    const icon = (await mount(`<wt-icon name="${name}"></wt-icon>`)) as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await icon.updateComplete;
    const d = icon.shadowRoot!.querySelector("path")?.getAttribute("d");
    expect(d).toBeTruthy();
  });
});
