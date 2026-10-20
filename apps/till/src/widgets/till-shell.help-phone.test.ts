import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { LitElement } from "lit";
import { setHelpMode } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./till-shell.js";
import type { TillShell } from "./till-shell.js";
import { currentLocale, setLocale } from "../i18n/t.js";

const loadLocales = async () => [
  { code: "en-GB", label: "English" },
  { code: "es-ES", label: "Español" },
];

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const settle = async (el: TillShell) => {
  for (let i = 0; i < 4; i += 1) {
    await frame();
    await el.updateComplete;
  }
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
  el.shadowRoot!.querySelector<HTMLElement & LitElement>('[data-test="help-switch"]')!;
const moreOf = (el: TillShell) =>
  el.shadowRoot!.querySelector<HTMLElement & LitElement>('header [data-test="more-menu"]');
const barChooser = (el: TillShell) =>
  el.shadowRoot!.querySelector<HTMLElement & LitElement>(".session > wt-language-chooser");
const moreChooser = (el: TillShell) =>
  moreOf(el)?.querySelector<HTMLElement & LitElement>(":scope > wt-language-chooser") ?? null;
const popupOf = (el: TillShell) => moreOf(el)!.shadowRoot!.querySelector<HTMLElement>("[popover]")!;

/** True when the chooser is in More, false when on the bar; fails when it is in both or neither. */
function chooserInMore(el: TillShell): boolean {
  expect(el.shadowRoot!.querySelectorAll("wt-language-chooser")).toHaveLength(1);
  return moreChooser(el) !== null;
}

async function openMore(el: TillShell): Promise<void> {
  const menu = moreOf(el)!;
  await menu.updateComplete;
  await userEvent.click(menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!);
  await vi.waitFor(() => expect(popupOf(el).matches(":popover-open")).toBe(true));
}

async function closeMore(el: TillShell): Promise<void> {
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(popupOf(el).matches(":popover-open")).toBe(false));
}

async function expectTappable(host: HTMLElement & LitElement): Promise<void> {
  await host.updateComplete;
  const r = host.shadowRoot!.querySelector("button")!.getBoundingClientRect();
  expect(r.width).toBeGreaterThanOrEqual(44);
  expect(r.height).toBeGreaterThanOrEqual(44);
  expect(r.left).toBeGreaterThanOrEqual(0);
  expect(r.top).toBeGreaterThanOrEqual(0);
  expect(r.right).toBeLessThanOrEqual(window.innerWidth);
  expect(r.bottom).toBeLessThanOrEqual(window.innerHeight);
}

const handheld: Partial<TillShell> = {
  formFactor: "phone-portrait",
  activeScreen: "floor",
  operatorName: "Ana",
  parkedCount: 2,
  waitingCount: 1,
  loadLocales,
};

const LONG_NAME = "Alex Morgan Smith Jones";

const till: Partial<TillShell> = {
  formFactor: "till",
  activeScreen: "counter",
  operatorName: LONG_NAME,
  parkedCount: 2,
  waitingCount: 1,
  loadLocales,
};

const zones: Partial<TillShell> = {
  counterZones: [
    { id: "z1", name: "Downstairs bar" },
    { id: "z2", name: "Terraza" },
  ],
  selectedCounterZoneId: "z1",
};

/** What `.till-strip` is left with the long name and the "?" on the bar (the plan's M2). */
const TILL_STRIP_WIDTH: Record<number, number> = { 320: 8, 360: 48, 390: 78 };

const widths = [320, 360, 390] as const;
const locales = ["en-GB", "es-ES"] as const;
const cases = widths.flatMap((width) => locales.map((locale) => [width, locale] as const));

describe("till-shell's language chooser at phone width, beside the Help switch", () => {
  it.each(cases)(
    "a handheld at %ipx in %s keeps the chooser on the bar only when the bar fits",
    async (width, locale) => {
      setLocale(locale);
      await page.viewport(width, 844);
      const { el } = await mountWidget<TillShell>("till-shell", handheld);
      await settle(el);
      expect(switchOf(el).parentElement!.classList.contains("session")).toBe(true);
      const head = el.shadowRoot!.querySelector<HTMLElement>(".head")!;
      expect(head.scrollWidth).toBeLessThanOrEqual(head.clientWidth);
      const tabs = el.shadowRoot!.querySelector<HTMLElement>(".head .tabs")!;
      expect(tabs.scrollWidth).toBeLessThanOrEqual(tabs.clientWidth);
      expect(chooserInMore(el)).toBe(width === 320);
      await expectTappable(switchOf(el));
      await expectTappable(moreOf(el)!);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    },
  );

  describe.each([
    ["without", {}],
    ["with", zones],
  ] as const)("%s a counter-zone menu", (_label, extra) => {
    it.each(cases)(
      "a till at %ipx in %s keeps the chooser in More and the switch on the bar",
      async (width, locale) => {
        setLocale(locale);
        await page.viewport(width, 844);
        const { el } = await mountWidget<TillShell>("till-shell", { ...till, ...extra });
        await settle(el);
        expect(chooserInMore(el)).toBe(true);
        expect(moreChooser(el)!.getAttribute("layout")).toBe("group");
        const help = switchOf(el);
        expect(help.nextElementSibling!.classList.contains("operator-menu")).toBe(true);
        await expectTappable(help);
        await expectTappable(
          el.shadowRoot!.querySelector<HTMLElement & LitElement>(".session > .operator-menu")!,
        );
        await expectTappable(moreOf(el)!);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
        const strip = el.shadowRoot!.querySelector<HTMLElement>(".till-strip")!;
        strip.scrollLeft = strip.scrollWidth;
        const box = strip.getBoundingClientRect();
        const last = strip.lastElementChild!.getBoundingClientRect();
        expect(last.right).toBeLessThanOrEqual(box.right + 0.5);
        // Known limit, not a target: the strip is only this wide with a long name (plan decision 3;
        // its backlog entry asks the owner whether the name should give room). A change that narrows
        // it further fails here; a fix for decision 3 updates these numbers on purpose.
        expect(Math.abs(strip.clientWidth - TILL_STRIP_WIDTH[width]!)).toBeLessThanOrEqual(2);
      },
    );
  });

  it("in More the languages come last, after Theme", async () => {
    await page.viewport(320, 844);
    const { el } = await mountWidget<TillShell>("till-shell", handheld);
    await settle(el);
    await openMore(el);
    const last = moreOf(el)!.lastElementChild!;
    expect(last.localName).toBe("wt-language-chooser");
    expect(last.getAttribute("layout")).toBe("group");
    expect(last.previousElementSibling!.getAttribute("data-test")).toBe("theme-choices");
  });

  it("picking a language in More asks for it", async () => {
    setLocale("en-GB");
    await page.viewport(320, 844);
    const { el } = await mountWidget<TillShell>("till-shell", handheld);
    await settle(el);
    const picked: string[] = [];
    el.addEventListener("wt-locale-selected", (event) =>
      picked.push((event as CustomEvent<{ code: string }>).detail.code),
    );
    await openMore(el);
    const chooser = moreChooser(el)!;
    await vi.waitFor(() =>
      expect(chooser.shadowRoot!.querySelector('[data-test="lang-es-ES"]')).not.toBeNull(),
    );
    await userEvent.click(chooser.shadowRoot!.querySelector('[data-test="lang-es-ES"]')!);
    expect(picked).toEqual(["es-ES"]);
  });

  it("widening to 390 brings the chooser back to the bar", async () => {
    await page.viewport(320, 844);
    const { el } = await mountWidget<TillShell>("till-shell", handheld);
    await settle(el);
    expect(chooserInMore(el)).toBe(true);
    await page.viewport(390, 844);
    await settle(el);
    expect(chooserInMore(el)).toBe(false);
    expect(switchOf(el).previousElementSibling).toBe(barChooser(el));
  });

  it("the chooser does not move while More is open", async () => {
    await page.viewport(360, 844);
    const { el } = await mountWidget<TillShell>("till-shell", handheld);
    await settle(el);
    expect(chooserInMore(el)).toBe(false);
    await openMore(el);
    await page.viewport(320, 844);
    await settle(el);
    expect(chooserInMore(el)).toBe(false);
    await closeMore(el);
    await settle(el);
    expect(chooserInMore(el)).toBe(true);
  });

  it("above phone width the chooser never leaves the bar", async () => {
    setLocale("es-ES");
    await page.viewport(660, 844);
    const { el } = await mountWidget<TillShell>("till-shell", {
      ...handheld,
      affordances: ["find-bill", "schedule", "station", "expo"],
      canSwitchProfile: true,
      transferAvailable: true,
      transferCount: 3,
      clockAvailable: true,
    });
    await settle(el);
    expect(chooserInMore(el)).toBe(false);
  });

  it("going from 320 to above phone width puts the chooser back on the bar", async () => {
    await page.viewport(320, 844);
    const { el } = await mountWidget<TillShell>("till-shell", handheld);
    await settle(el);
    expect(chooserInMore(el)).toBe(true);
    await page.viewport(700, 844);
    await settle(el);
    expect(chooserInMore(el)).toBe(false);
  });

  it("a newer fit that starts while an older one steps back decides where the chooser goes", async () => {
    await page.viewport(320, 844);
    const { el } = await mountWidget<TillShell>("till-shell", handheld);
    await settle(el);
    expect(chooserInMore(el)).toBe(true);
    // The step-back puts the chooser on the bar before it measures; when it lands there, change the
    // form factor so a newer fit starts before the older one has settled.
    let superseded = false;
    const watcher = new MutationObserver(() => {
      if (!superseded && barChooser(el) !== null) {
        superseded = true;
        el.formFactor = "tablet-landscape";
      }
    });
    watcher.observe(el.shadowRoot!, { childList: true, subtree: true });
    el.operatorName = "Bea";
    await settle(el);
    watcher.disconnect();
    expect(superseded).toBe(true);
    expect(el.formFactor).toBe("tablet-landscape");
    expect(chooserInMore(el)).toBe(true);
  });
});
