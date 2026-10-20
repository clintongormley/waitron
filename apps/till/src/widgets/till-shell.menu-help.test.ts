import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { LitElement } from "lit";
import { setHelpMode } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./till-shell.js";
import type { TillShell } from "./till-shell.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { helpEn, helpEs } from "../i18n/help-strings.js";

type Lit = HTMLElement & LitElement;

const loadLocales = async () => [
  { code: "en-GB", label: "English" },
  { code: "es-ES", label: "Español" },
];

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

let originalLocale = currentLocale();
let originalViewport = { width: 0, height: 0 };

beforeEach(() => {
  originalLocale = currentLocale();
  originalViewport = { width: window.innerWidth, height: window.innerHeight };
  setLocale("en-GB");
});

afterEach(async () => {
  setHelpMode(false);
  cleanupWidgets();
  setLocale(originalLocale);
  await page.viewport(originalViewport.width, originalViewport.height);
});

const clockState = {
  personId: "ana",
  locationId: "venue",
  businessDay: "2026-10-14",
  state: "working" as const,
  activeLocationId: "venue",
  lastEntryId: "entry",
  firstClockIn: false,
};

const handheld: Partial<TillShell> = {
  formFactor: "phone-portrait",
  activeScreen: "floor",
  operatorName: "Ana",
  affordances: ["find-bill", "station", "expo", "schedule"],
  canSwitchProfile: true,
  transferAvailable: true,
  loadLocales,
};

const till: Partial<TillShell> = {
  formFactor: "till",
  activeScreen: "counter",
  operatorName: "Ana",
  affordances: ["find-bill", "schedule", "station", "expo"],
  canSwitchProfile: true,
  testingKitchen: true,
  loadLocales,
};

const forms = { handheld: [handheld, 320], till: [till, 1280] } as const;

async function mountShell(props: Partial<TillShell>, width: number): Promise<TillShell> {
  await page.viewport(width, 844);
  const { el } = await mountWidget<TillShell>("till-shell", props);
  await frame();
  await frame();
  await el.updateComplete;
  return el;
}

const moreOf = (el: TillShell) =>
  el.shadowRoot!.querySelector<Lit>('header [data-test="more-menu"]')!;
const personOf = (el: TillShell) =>
  el.shadowRoot!.querySelector<Lit>("wt-row-actions.operator-menu")!;
const popupOf = (menu: Lit) => menu.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
const isOpen = (popover: HTMLElement) => popover.matches(":popover-open");

async function openMenu(menu: Lit): Promise<void> {
  await menu.updateComplete;
  await userEvent.click(menu.shadowRoot!.querySelector("button")!);
  await vi.waitFor(() => expect(isOpen(popupOf(menu))).toBe(true));
}

/** The option whose text is `label`, as a wt-button anywhere in the menu's light tree. */
function option(menu: Lit, label: string): Lit {
  const found = [...menu.querySelectorAll<Lit>("wt-button")].find(
    (button) => button.textContent!.trim() === label,
  );
  expect(found, label).toBeDefined();
  return found!;
}

const inner = (button: Lit) => button.shadowRoot!.querySelector("button")!;

function badgeOf(button: Lit): Lit | null {
  const row = button.parentElement;
  return row?.localName === "wt-menu-row"
    ? row.shadowRoot!.querySelector<Lit>("wt-help-tooltip")
    : null;
}

function badgeButton(button: Lit): HTMLButtonElement {
  return badgeOf(button)!.shadowRoot!.querySelector("button")!;
}

function boxOf(button: Lit): HTMLElement {
  return badgeOf(button)!.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
}

/** The labels of the options in `menu` drawn with a visible badge. */
async function badged(menu: Lit): Promise<string[]> {
  const rows = [...menu.querySelectorAll<Lit>("wt-menu-row")];
  await Promise.all(rows.map((row) => row.updateComplete));
  return rows
    .filter((row) => row.shadowRoot!.querySelector("wt-help-tooltip")?.checkVisibility())
    .map((row) => row.querySelector("wt-button")!.textContent!.trim());
}

function deepActiveElement(): Element | null {
  let focused = document.activeElement;
  while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
  return focused;
}

async function settleBadges(menu: Lit): Promise<void> {
  const rows = [...menu.querySelectorAll<Lit>("wt-menu-row")];
  await Promise.all(rows.map((row) => row.updateComplete));
  await Promise.all(
    rows.map((row) => row.shadowRoot!.querySelector<Lit>("wt-help-tooltip")?.updateComplete),
  );
}

describe("till-shell's menu badges", () => {
  it.each([
    [
      "handheld",
      ["expo.open", "profile.open", "equipment.open", "department_transfer.short"],
      ["find_bill.open", "schedule.open", "station.open", "shell.logout"],
    ],
    [
      "till",
      ["profile.open", "device_zones.settings"],
      ["find_bill.open", "schedule.open", "station.open", "shell.logout"],
    ],
  ] as const)(
    "with help on, More shows a badge beside exactly the options that have help: %s",
    async (form, keys, plain) => {
      const [props, width] = forms[form];
      setHelpMode(true);
      const el = await mountShell(props, width);
      const more = moreOf(el);
      await openMenu(more);
      await settleBadges(more);
      expect(await badged(more)).toEqual(keys.map((key) => t(key)));
      for (const key of plain) expect(badgeOf(option(more, t(key))), key).toBeNull();
      expect(
        more.querySelector("wt-theme-choices wt-menu-row, wt-language-chooser wt-menu-row"),
      ).toBeNull();
    },
  );

  it("on the bar an option with help stays a plain button, with no row", async () => {
    setHelpMode(true);
    const el = await mountShell({ ...handheld, affordances: [], transferAvailable: false }, 1500);
    const profile = el.shadowRoot!.querySelector<Lit>(".session > wt-button.profile");
    expect(profile).not.toBeNull();
    expect(el.shadowRoot!.querySelector("wt-menu-row")).toBeNull();
  });

  it.each([
    ["till", 1280, personOf],
    ["handheld", 320, moreOf],
  ] as const)(
    "the person menu's Fix my hours has a badge: %s at %ipx",
    async (form, width, menuOf) => {
      setHelpMode(true);
      const el = await mountShell({ ...forms[form][0], clockAvailable: true, clockState }, width);
      const menu = menuOf(el);
      await openMenu(menu);
      await settleBadges(menu);
      expect(await badged(menu)).toContain(t("attendance.fix_hours"));
      expect(badgeOf(option(menu, t("hours.mine")))).toBeNull();
    },
  );

  it.each([
    ["handheld", 320, moreOf, "profile.open", "open-profile", false],
    ["till", 1280, moreOf, "device_zones.settings", "open-settings", false],
    ["till", 1280, personOf, "attendance.fix_hours", "fix-my-hours", true],
  ] as const)(
    "a tap on a badge opens its box, leaves the menu open and does not run the option: %s %s",
    async (form, width, menuOf, key, event, clock) => {
      setHelpMode(true);
      const el = await mountShell(
        { ...forms[form][0], ...(clock ? { clockAvailable: true, clockState } : {}) },
        width,
      );
      const ran = vi.fn();
      el.addEventListener(event, ran);
      const menu = menuOf(el);
      await openMenu(menu);
      await settleBadges(menu);
      const choice = option(menu, t(key));
      await userEvent.click(badgeButton(choice));
      await vi.waitFor(() => expect(isOpen(boxOf(choice))).toBe(true));
      expect(isOpen(popupOf(menu))).toBe(true);
      expect(ran).not.toHaveBeenCalled();
    },
  );

  it("Escape closes the box first and puts focus on its badge, then closes the menu", async () => {
    setHelpMode(true);
    const el = await mountShell(till, 1280);
    const more = moreOf(el);
    await openMenu(more);
    await settleBadges(more);
    const settings = option(more, t("device_zones.settings"));
    await userEvent.click(badgeButton(settings));
    await vi.waitFor(() => expect(isOpen(boxOf(settings))).toBe(true));
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(isOpen(boxOf(settings))).toBe(false));
    expect(isOpen(popupOf(more))).toBe(true);
    expect(deepActiveElement()).toBe(badgeButton(settings));
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(isOpen(popupOf(more))).toBe(false));
  });

  it("Tab goes from an option to its badge to the next option", async () => {
    setHelpMode(true);
    const el = await mountShell(till, 1280);
    const more = moreOf(el);
    await openMenu(more);
    await settleBadges(more);
    const settings = option(more, t("device_zones.settings"));
    inner(settings).focus();
    await userEvent.keyboard("{Tab}");
    expect(deepActiveElement()).toBe(badgeButton(settings));
    await userEvent.keyboard("{Tab}");
    expect(deepActiveElement()).toBe(inner(option(more, t("shell.logout"))));
  });

  it("with help off there is no badge and no extra Tab stop", async () => {
    const el = await mountShell(till, 1280);
    const more = moreOf(el);
    await openMenu(more);
    await settleBadges(more);
    expect(await badged(more)).toEqual([]);
    const settings = option(more, t("device_zones.settings"));
    inner(settings).focus();
    await userEvent.keyboard("{Tab}");
    expect(deepActiveElement()).toBe(inner(option(more, t("shell.logout"))));
  });

  it("turning help on from the bar while More is open shows the badges at once", async () => {
    const el = await mountShell(handheld, 390);
    const more = moreOf(el);
    await more.updateComplete;
    const trigger = more.shadowRoot!.querySelector("button")!;
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(isOpen(popupOf(more))).toBe(true));
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    const help = el.shadowRoot!.querySelector<Lit>('[data-test="help-switch"]')!;
    expect(deepActiveElement()).toBe(help.shadowRoot!.querySelector("button"));
    await userEvent.keyboard("{Enter}");
    await settleBadges(more);
    expect(isOpen(popupOf(more))).toBe(true);
    expect(await badged(more)).toEqual([
      t("expo.open"),
      t("profile.open"),
      t("equipment.open"),
      t("department_transfer.short"),
    ]);

    const profile = option(more, t("profile.open"));
    badgeButton(profile).focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(isOpen(boxOf(profile))).toBe(true));
    help.shadowRoot!.querySelector("button")!.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(isOpen(boxOf(profile))).toBe(false));
    await settleBadges(more);
    expect(await badged(more)).toEqual([]);
  });

  it("a tap on the option itself runs it and closes the menu, with help on", async () => {
    setHelpMode(true);
    const el = await mountShell(handheld, 320);
    const ran = vi.fn();
    el.addEventListener("open-profile", ran);
    const more = moreOf(el);
    await openMenu(more);
    await settleBadges(more);
    await userEvent.click(inner(option(more, t("profile.open"))));
    expect(ran).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(isOpen(popupOf(more))).toBe(false));
  });

  it.each([
    ["en-GB", helpEn],
    ["es-ES", helpEs],
  ] as const)(
    "the badge is named 'Help: <option>' in English and 'Ayuda: <option>' in Spanish: %s",
    async (locale, table) => {
      setLocale(locale);
      setHelpMode(true);
      const el = await mountShell(till, 1280);
      const more = moreOf(el);
      await openMenu(more);
      await settleBadges(more);
      for (const key of ["profile.open", "device_zones.settings"] as const) {
        const label = t(key);
        expect(badgeButton(option(more, label)).getAttribute("aria-label")).toBe(
          table["help.badge_label"].replace("{part}", label),
        );
      }
      const help = (row: Lit) => row.closest("wt-menu-row")!.getAttribute("help");
      expect(help(option(more, t("profile.open")))).toBe(table["help.more.profile"]);
      expect(help(option(more, t("device_zones.settings")))).toBe(table["help.more.settings"]);
    },
  );
});
