import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { html, render, type LitElement } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { currentHelpMode, setHelpMode } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./till-shell.js";
import type { TillShell } from "./till-shell.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { helpText } from "../i18n/help-strings.js";
import { KITCHEN_HELP_IDLE_MS } from "../state/help-idle.js";

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
  vi.useRealTimers();
  cleanupWidgets();
  setLocale(originalLocale);
  await page.viewport(originalViewport.width, originalViewport.height);
});

const fakeClock = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

const switchOf = (el: TillShell) =>
  el.shadowRoot!.querySelector<HTMLElement & LitElement>('[data-test="help-switch"]');
const buttonOf = (el: TillShell) => switchOf(el)!.shadowRoot!.querySelector("button")!;

const kitchen: Partial<TillShell> = { formFactor: "kds", loadLocales };
const kiosk: Partial<TillShell> = { formFactor: "phone-portrait", kiosk: true, loadLocales };

async function mounted(props: Partial<TillShell>): Promise<TillShell> {
  const { el } = await mountWidget<TillShell>("till-shell", props);
  await settle(el);
  await switchOf(el)?.updateComplete;
  return el;
}

/** Turns help on from the corner's switch, the clock already faked. */
async function helpOn(el: TillShell): Promise<void> {
  await userEvent.click(buttonOf(el));
  expect(currentHelpMode()).toBe(true);
}

describe("till-shell's Help switch in the kitchen corner", () => {
  it.each(
    (["kitchen display", "kiosk"] as const).flatMap((name) =>
      ([1280, 320] as const).flatMap((width) =>
        (["en-GB", "es-ES"] as const).map((locale) => [name, width, locale] as const),
      ),
    ),
  )(
    "on a %s the Help switch is first in the corner, before the theme and language choosers, at the top right (%ipx, %s)",
    async (name, width, locale) => {
      setLocale(locale);
      await page.viewport(width, 844);
      const el = await mounted(name === "kiosk" ? kiosk : kitchen);
      expect(el.shadowRoot!.querySelector("header")).toBeNull();
      const corner = el.shadowRoot!.querySelector(".language-corner")!;
      const help = corner.firstElementChild as HTMLElement & LitElement;
      expect(help.localName).toBe("wt-help-switch");
      expect(help.getAttribute("data-test")).toBe("help-switch");
      expect(help.nextElementSibling!.localName).toBe("wt-theme-chooser");
      expect(el.shadowRoot!.querySelectorAll("wt-help-switch")).toHaveLength(1);
      await help.updateComplete;
      const r = buttonOf(el).getBoundingClientRect();
      const region = el.shadowRoot!.querySelector(".region")!.getBoundingClientRect();
      expect(r.width).toBeGreaterThanOrEqual(44);
      expect(r.height).toBeGreaterThanOrEqual(44);
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(window.innerWidth);
      expect(r.bottom).toBeLessThanOrEqual(region.top);
      expect(buttonOf(el).getAttribute("aria-label")).toBe(helpText("help.label", locale));
    },
  );

  it("the corner's switch turns help on and off and reads as pressed", async () => {
    await page.viewport(1280, 844);
    const el = await mounted(kitchen);
    expect(buttonOf(el).getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(buttonOf(el));
    expect(currentHelpMode()).toBe(true);
    await vi.waitFor(() => expect(buttonOf(el).getAttribute("aria-pressed")).toBe("true"));
    await userEvent.click(buttonOf(el));
    expect(currentHelpMode()).toBe(false);
    await vi.waitFor(() => expect(buttonOf(el).getAttribute("aria-pressed")).toBe("false"));
  });

  it("on a kitchen screen help goes off two minutes after the last touch", async () => {
    await page.viewport(1280, 844);
    const el = await mounted(kitchen);
    fakeClock();
    await helpOn(el);
    vi.advanceTimersByTime(KITCHEN_HELP_IDLE_MS - 1);
    expect(currentHelpMode()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(currentHelpMode()).toBe(false);
    await vi.waitFor(() => expect(buttonOf(el).getAttribute("aria-pressed")).toBe("false"));
  });

  it("a touch on the board keeps help on", async () => {
    await page.viewport(1280, 844);
    const el = await mounted(kitchen);
    const board = document.createElement("div");
    el.appendChild(board);
    await settle(el);
    fakeClock();
    await helpOn(el);
    vi.advanceTimersByTime(100_000);
    board.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    vi.advanceTimersByTime(KITCHEN_HELP_IDLE_MS - 1);
    expect(currentHelpMode()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(currentHelpMode()).toBe(false);
  });

  it("a touch in the guide's page keeps help on", async () => {
    await page.viewport(1280, 844);
    const el = await mounted(kitchen);
    fakeClock();
    await helpOn(el);
    vi.advanceTimersByTime(100_000);
    el.shadowRoot!.querySelector("till-guide-sheet")!.dispatchEvent(
      new Event("pointerdown", { bubbles: true, composed: true }),
    );
    vi.advanceTimersByTime(KITCHEN_HELP_IDLE_MS - 1);
    expect(currentHelpMode()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(currentHelpMode()).toBe(false);
  });

  it("two minutes without a touch also close an open guide", async () => {
    await page.viewport(1280, 844);
    const el = await mounted(kitchen);
    const board = document.createElement("div");
    el.appendChild(board);
    await settle(el);
    fakeClock();
    await helpOn(el);
    const href = "/help/en/kitchen-service#kitchen-screen";
    board.dispatchEvent(
      new CustomEvent("wt-guide-open", {
        detail: { href },
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
    await el.updateComplete;
    const sheet = el.shadowRoot!.querySelector<HTMLElement & LitElement & { href: string }>(
      "till-guide-sheet",
    )!;
    expect(sheet.href).toBe(href);
    vi.advanceTimersByTime(KITCHEN_HELP_IDLE_MS);
    expect(currentHelpMode()).toBe(false);
    await el.updateComplete;
    await sheet.updateComplete;
    expect(sheet.href).toBe("");
    const modal = sheet.shadowRoot!.querySelector<HTMLElement & { open: boolean }>("wt-modal")!;
    expect(modal.open).toBe(false);
  });

  it("on a kitchen screen with no corner, and so no Help switch, help does not go off by itself", async () => {
    await page.viewport(1280, 844);
    const el = await mounted({ formFactor: "kds" });
    expect(el.shadowRoot!.querySelector(".language-corner")).toBeNull();
    fakeClock();
    setHelpMode(true);
    vi.advanceTimersByTime(KITCHEN_HELP_IDLE_MS);
    expect(currentHelpMode()).toBe(true);
  });

  it.each([
    ["till", { formFactor: "till", activeScreen: "counter", operatorName: "Ana", loadLocales }],
    [
      "phone-portrait",
      { formFactor: "phone-portrait", activeScreen: "floor", operatorName: "Ana", loadLocales },
    ],
  ] as const)("on a %s help does not go off by itself", async (_name, props) => {
    await page.viewport(1280, 844);
    const el = await mounted(props as Partial<TillShell>);
    expect(switchOf(el)!.parentElement!.classList.contains("session")).toBe(true);
    fakeClock();
    await helpOn(el);
    vi.advanceTimersByTime(600_000);
    expect(currentHelpMode()).toBe(true);
  });

  it("a language change on a kitchen screen keeps help on and starts the two minutes again", async () => {
    setLocale("en-GB");
    await page.viewport(1280, 844);
    const host = document.createElement("div");
    document.body.appendChild(host);
    try {
      const draw = () =>
        render(
          keyed(
            currentLocale(),
            html`<till-shell formFactor="kds" .loadLocales=${loadLocales}></till-shell>`,
          ),
          host,
        );
      draw();
      const first = host.querySelector("till-shell")!;
      await settle(first);
      await switchOf(first)!.updateComplete;
      fakeClock();
      await helpOn(first);
      vi.advanceTimersByTime(100_000);
      setLocale("es-ES");
      draw();
      const second = host.querySelector("till-shell")!;
      expect(second).not.toBe(first);
      await settle(second);
      vi.advanceTimersByTime(KITCHEN_HELP_IDLE_MS - 1);
      expect(currentHelpMode()).toBe(true);
      await switchOf(second)!.updateComplete;
      expect(buttonOf(second).getAttribute("aria-pressed")).toBe("true");
      vi.advanceTimersByTime(1);
      expect(currentHelpMode()).toBe(false);
    } finally {
      host.remove();
    }
  });
});
