import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { html, render, type LitElement } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { currentHelpMode, setHelpMode } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./till-shell.js";
import type { ShellAffordance, TillShell } from "./till-shell.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { helpText } from "../i18n/help-strings.js";

const loadLocales = async () => [
  { code: "en-GB", label: "English" },
  { code: "es-ES", label: "Español" },
];

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const settle = async (el: TillShell) => {
  await frame();
  await frame();
  await el.updateComplete;
};

let originalLocale = currentLocale();
let originalViewport = { width: 0, height: 0 };

beforeEach(() => {
  originalLocale = currentLocale();
  originalViewport = { width: window.innerWidth, height: window.innerHeight };
});

afterEach(async () => {
  setHelpMode(false);
  cleanupWidgets();
  setLocale(originalLocale);
  await page.viewport(originalViewport.width, originalViewport.height);
});

const switchOf = (el: TillShell) =>
  el.shadowRoot!.querySelector<HTMLElement & LitElement>('[data-test="help-switch"]');
const buttonOf = (el: TillShell) => switchOf(el)!.shadowRoot!.querySelector("button")!;
const moreOf = (el: TillShell) =>
  el.shadowRoot!.querySelector<HTMLElement & LitElement>('header [data-test="more-menu"]');

async function openMore(el: TillShell): Promise<void> {
  const menu = moreOf(el)!;
  await menu.updateComplete;
  const trigger = menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
  await userEvent.click(trigger);
  const popup = menu.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
}

/** Every `[popover]:popover-open` in the document, inside shadow roots too. */
function openPopovers(root: Document | ShadowRoot = document): Element[] {
  const found: Element[] = [];
  for (const node of root.querySelectorAll("*")) {
    if (node.matches("[popover]:popover-open")) found.push(node);
    if (node.shadowRoot) found.push(...openPopovers(node.shadowRoot));
  }
  return found;
}

const handheld: Partial<TillShell> = {
  formFactor: "phone-portrait",
  activeScreen: "floor",
  operatorName: "Ana",
  loadLocales,
};

const till: Partial<TillShell> = {
  formFactor: "till",
  activeScreen: "counter",
  operatorName: "Ana",
  parkedCount: 2,
  waitingCount: 1,
  loadLocales,
};

describe("till-shell's Help switch", () => {
  it.each([
    ["handheld", 390],
    ["handheld", 1280],
    ["till", 320],
    ["till", 390],
    ["till", 1280],
  ] as const)("the Help switch is on the bar at the top right, at %s %ipx", async (form, width) => {
    await page.viewport(width, 844);
    const { el } = await mountWidget<TillShell>("till-shell", form === "till" ? till : handheld);
    await settle(el);
    const help = switchOf(el);
    expect(help).not.toBeNull();
    expect(help!.localName).toBe("wt-help-switch");
    expect(help!.parentElement!.classList.contains("session")).toBe(true);
    if (form === "till") {
      expect(help!.previousElementSibling).toBeNull();
      expect(help!.nextElementSibling!.classList.contains("operator-menu")).toBe(true);
    } else {
      expect(help!.previousElementSibling!.localName).toBe("wt-language-chooser");
      const next = help!.nextElementSibling!;
      expect(
        next.classList.contains("operator-menu") || next.getAttribute("data-test") === "more-menu",
        next.outerHTML,
      ).toBe(true);
    }
    await help!.updateComplete;
    const r = buttonOf(el).getBoundingClientRect();
    expect(r.width).toBeGreaterThanOrEqual(44);
    expect(r.height).toBeGreaterThanOrEqual(44);
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeLessThanOrEqual(window.innerWidth);
    expect(r.bottom).toBeLessThanOrEqual(window.innerHeight);
  });

  it.each([
    ["handheld", 390],
    ["handheld", 1280],
    ["till", 390],
    ["till", 1280],
  ] as const)("the Help switch is never in More, at %s %ipx", async (form, width) => {
    await page.viewport(width, 844);
    const { el } = await mountWidget<TillShell>("till-shell", {
      ...(form === "till" ? till : handheld),
      affordances: ["find-bill", "schedule"],
      canSwitchProfile: true,
    });
    await settle(el);
    await openMore(el);
    expect(moreOf(el)!.querySelector("wt-help-switch")).toBeNull();
    expect(el.shadowRoot!.querySelectorAll("wt-help-switch")).toHaveLength(1);
  });

  it("the switch turns help on and off and reads as pressed", async () => {
    setLocale("en-GB");
    await page.viewport(1280, 844);
    const { el } = await mountWidget<TillShell>("till-shell", till);
    await settle(el);
    await switchOf(el)!.updateComplete;
    const button = buttonOf(el);
    expect(button.getAttribute("aria-label")).toBe(helpText("help.label"));
    expect(button.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(button);
    expect(currentHelpMode()).toBe(true);
    await vi.waitFor(() => expect(buttonOf(el).getAttribute("aria-pressed")).toBe("true"));
    await userEvent.click(buttonOf(el));
    expect(currentHelpMode()).toBe(false);
    await vi.waitFor(() => expect(buttonOf(el).getAttribute("aria-pressed")).toBe("false"));
  });

  it.each([
    ["a kitchen display", { formFactor: "kds" }],
    ["kiosk mode", { formFactor: "phone-portrait", kiosk: true }],
  ] as const)("a kitchen display and kiosk mode draw no switch: %s", async (_name, props) => {
    await page.viewport(1280, 844);
    const { el } = await mountWidget<TillShell>("till-shell", { ...till, ...props });
    await settle(el);
    expect(el.shadowRoot!.querySelector("wt-help-switch")).toBeNull();
  });

  it("above phone width items still leave for More in LEAVE_ORDER's order", async () => {
    setLocale("es-ES");
    const affordances: ShellAffordance[] = ["find-bill", "station", "expo", "schedule"];
    const leaveOrder = [
      ["transfers", "[data-open-transfers]"],
      ["equipment", ".equipment"],
      ["profile", ".profile"],
      ["schedule", ".schedule"],
      ["station", ".station"],
      ["expo", ".expo"],
      ["operator", ".logout"],
    ] as const;
    const failures: string[] = [];
    for (let width = 660; width <= 1500; width += 40) {
      await page.viewport(width, 844);
      await frame();
      const { el, host } = await mountWidget<TillShell>("till-shell", {
        ...handheld,
        operatorName: "Ana Fernández",
        affordances,
        canSwitchProfile: true,
        transferAvailable: true,
      });
      await settle(el);
      await settle(el);
      const menu = moreOf(el);
      const inMore =
        menu === null
          ? []
          : leaveOrder
              .filter(([, selector]) => menu.querySelector(selector) !== null)
              .map(([k]) => k);
      const leading = leaveOrder.slice(0, inMore.length).map(([k]) => k);
      if (JSON.stringify(inMore) !== JSON.stringify(leading))
        failures.push(`${width}: More holds ${inMore.join(",")}`);
      const head = el.shadowRoot!.querySelector<HTMLElement>(".head")!;
      if (head.scrollWidth > head.clientWidth)
        failures.push(`${width}: head ${head.scrollWidth} > ${head.clientWidth}`);
      host.remove();
    }
    expect(failures).toEqual([]);
  });

  it("the badge size inside the shell is 32px with a 24px circle", async () => {
    await page.viewport(1280, 844);
    const { el } = await mountWidget<TillShell>("till-shell", till);
    const child = document.createElement("div");
    el.appendChild(child);
    await settle(el);
    const style = getComputedStyle(child);
    expect(style.getPropertyValue("--wt-help-badge-target").trim()).toBe("32px");
    expect(style.getPropertyValue("--wt-help-badge-size").trim()).toBe("24px");
  });

  it("help stays on and the switch reads as pressed after a language change", async () => {
    setLocale("en-GB");
    await page.viewport(1280, 844);
    const host = document.createElement("div");
    document.body.appendChild(host);
    try {
      const draw = () =>
        render(
          keyed(
            currentLocale(),
            html`<till-shell
              formFactor="till"
              activeScreen="counter"
              operatorName="Ana"
              .loadLocales=${loadLocales}
            ></till-shell>`,
          ),
          host,
        );
      draw();
      const first = host.querySelector("till-shell")!;
      await settle(first);
      await switchOf(first)!.updateComplete;
      await userEvent.click(buttonOf(first));
      expect(currentHelpMode()).toBe(true);
      setLocale("es-ES");
      draw();
      const second = host.querySelector("till-shell")!;
      expect(second).not.toBe(first);
      await settle(second);
      await switchOf(second)!.updateComplete;
      expect(buttonOf(second).getAttribute("aria-pressed")).toBe("true");
      expect(buttonOf(second).getAttribute("aria-label")).toBe(helpText("help.label", "es-ES"));
      expect(openPopovers()).toEqual([]);
    } finally {
      host.remove();
    }
  });
});
