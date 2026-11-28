import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillShell } from "./till-shell.js";
import type { WtRowActions } from "@waitron/ui";

afterEach(cleanupWidgets);

it.each([
  [390, "en-GB"],
  [1280, "en-GB"],
  [390, "es-ES"],
  [1280, "es-ES"],
] as const)(
  "A738 keeps Transfers, Pass, Help and More in reach on the bar at %i in %s",
  async (width, locale) => {
    const before = { width: innerWidth, height: innerHeight, locale: currentLocale() };
    await page.viewport(width, 844);
    setLocale(locale);
    try {
      const { el } = await mountWidget<TillShell>("till-shell", {
        formFactor: "till",
        operatorName: "Alex Morgan Smith Jones",
        transferAvailable: true,
        transferCount: 2,
        affordances: ["find-bill", "station", "expo", "schedule"],
        canSwitchProfile: true,
        loadLocales: async () => [{ code: "en-GB", label: "English" }],
      });
      const root = el.shadowRoot!;
      expect(root.querySelector("[data-counter-orders]")).toBeNull();
      expect(root.querySelector(".till-strip [data-open-transfers]")).not.toBeNull();
      expect(root.querySelector(".till-strip .expo")).not.toBeNull();
      expect(root.querySelector(".session > .operator-menu")?.textContent).toContain(
        "Alex Morgan Smith Jones",
      );
      const more = root.querySelector<WtRowActions>('[data-test="more-menu"]')!;
      expect(more).not.toBeNull();
      expect(more.querySelector(".find-bill")).not.toBeNull();
      expect(more.querySelector(".schedule")).not.toBeNull();
      expect(more.querySelector(".profile")).not.toBeNull();
      expect(more.querySelector("wt-language-chooser")).not.toBeNull();
      expect(more.querySelector(".settings")).not.toBeNull();
      expect(more.querySelector(".logout")).not.toBeNull();
      expect(root.querySelector(".equipment")).toBeNull();
      expect(root.querySelector(".station")).toBeNull();
      expect(root.querySelector(".allergens")).toBeNull();
      await more.updateComplete;
      const moreTrigger = more.shadowRoot!.querySelector("button")!;
      const operator = root.querySelector<WtRowActions>(".operator-menu")!;
      await operator.updateComplete;
      for (const trigger of [moreTrigger, operator.shadowRoot!.querySelector("button")!]) {
        const box = trigger.getBoundingClientRect();
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(innerWidth);
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
      await userEvent.click(moreTrigger);
      expect(more.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
      await userEvent.keyboard("{Escape}");
      await vi.waitFor(() =>
        expect(more.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false),
      );
      el.canSwitchProfile = false;
      el.showCounter = false;
      el.affordances = [];
      await el.updateComplete;
      expect(more.querySelector(".profile")).toBeNull();
      expect(root.querySelector("[data-counter-orders]")).toBeNull();
      expect(root.querySelector(".expo")).toBeNull();
      expect(more.querySelector(".schedule")).toBeNull();
    } finally {
      setLocale(before.locale);
      await page.viewport(before.width, before.height);
    }
  },
);

it.each([
  [390, 844, "en-GB"],
  [700, 390, "es-ES"],
] as const)(
  "keeps the entire Transfers button inside the counter bar at %i × %i",
  async (width, height, locale) => {
    const before = { width: innerWidth, height: innerHeight, locale: currentLocale() };
    await page.viewport(width, height);
    setLocale(locale);
    try {
      const { el } = await mountWidget<TillShell>("till-shell", {
        formFactor: "till",
        activeScreen: "counter",
        phone: width === 390,
        operatorName: "Administrator",
        transferAvailable: true,
        showFloor: true,
        showCounter: true,
        counterZones: [
          { id: "bar", name: "Downstairs bar" },
          { id: "deli", name: "Deli" },
        ],
        selectedCounterZoneId: "bar",
      });
      el.style.setProperty("--wt-page-padding", "24px");
      el.style.width = "calc(100% - 48px)";
      const strip = el.shadowRoot!.querySelector<HTMLElement>(".counter-shortcuts")!;
      const transfer = strip.querySelector("wt-button")!;
      await transfer.updateComplete;
      await vi.waitFor(() => {
        const button = transfer.shadowRoot!.querySelector("button")!.getBoundingClientRect();
        const shown = transfer.closest(".till-strip")!.getBoundingClientRect();
        expect(button.left).toBeGreaterThanOrEqual(shown.left);
        expect(button.right).toBeLessThanOrEqual(shown.right + 0.5);
      });
    } finally {
      setLocale(before.locale);
      await page.viewport(before.width, before.height);
    }
  },
);

it("A738 Kitchen is only inside Testing when both testing and capability allow it", async () => {
  const { el } = await mountWidget<TillShell>("till-shell", {
    formFactor: "till",
    affordances: ["station"],
  });
  expect(el.shadowRoot!.querySelector(".station")).toBeNull();
  el.testingKitchen = true;
  await el.updateComplete;
  const more = el.shadowRoot!.querySelector<WtRowActions>('[data-test="more-menu"]')!;
  await more.updateComplete;
  await userEvent.click(more.shadowRoot!.querySelector("button")!);
  await userEvent.click(more.querySelector("summary")!);
  const fired: string[] = [];
  el.addEventListener("show-station", () => fired.push("station"));
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-testing] .station")!);
  expect(fired).toEqual(["station"]);
  expect(more.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
  el.affordances = [];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-testing]")).toBeNull();
});

it("A738 Language choices remain reachable inside More and emit one selection", async () => {
  const { el } = await mountWidget<TillShell>("till-shell", {
    loadLocales: async () => [
      { code: "en-GB", label: "English" },
      { code: "es-ES", label: "Spanish" },
    ],
  });
  const more = el.shadowRoot!.querySelector<WtRowActions>('[data-test="more-menu"]')!;
  await more.updateComplete;
  await userEvent.click(more.shadowRoot!.querySelector("button")!);
  const chooser =
    more.querySelector<HTMLElementTagNameMap["wt-language-chooser"]>("wt-language-chooser")!;
  await vi.waitFor(() =>
    expect(chooser.shadowRoot!.querySelector('[role="group"]')).not.toBeNull(),
  );
  const spanish = chooser.shadowRoot!.querySelector<HTMLButtonElement>('[data-test="lang-es-ES"]')!;
  expect(spanish.checkVisibility()).toBe(true);
  const picked: unknown[] = [];
  el.addEventListener("wt-locale-selected", (event) => picked.push((event as CustomEvent).detail));
  await userEvent.click(spanish);
  expect(picked).toEqual([{ code: "es-ES" }]);
  expect(more.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
});

it("A738 Transfers keeps a compact visible count and announces the pending total", async () => {
  const previous = currentLocale();
  setLocale("en-GB");
  try {
    const { el } = await mountWidget<TillShell>("till-shell", {
      transferAvailable: true,
      transferCount: 12,
    });
    const button = el.shadowRoot!.querySelector<HTMLElement>("[data-open-transfers]")!;
    expect(button.textContent!.replace(/\s+/g, " ").trim()).toBe("Transfers 12");
    const status = button.querySelector<HTMLElement>('[role="status"]')!;
    await expect.element(status).toHaveAccessibleName("Transfers (12 pending)");
    const calls: unknown[] = [];
    el.addEventListener("open-transfers", (event) => calls.push((event as CustomEvent).detail));
    await userEvent.click(button);
    expect(calls).toEqual([null]);
  } finally {
    setLocale(previous);
  }
});

it.each([390, 1280])(
  "A738 keeps the clock marker visible beside a long operator name at %i",
  async (width) => {
    const before = { width: innerWidth, height: innerHeight };
    await page.viewport(width, 844);
    try {
      const { el } = await mountWidget<TillShell>("till-shell", {
        operatorName: "Alex Morgan Smith Jones",
        clockAvailable: true,
        clockState: {
          personId: "ana",
          businessDay: "2026-10-19",
          state: "working",
          lastEntryId: "entry",
          firstClockIn: false,
          shiftStart: null,
        },
      });
      const operator = el.shadowRoot!.querySelector<HTMLElement>(".operator")!;
      const marker = el.shadowRoot!.querySelector<HTMLElement>(".clock-dot")!;
      const box = marker.getBoundingClientRect();
      expect(box.width).toBeGreaterThan(0);
      expect(box.right).toBeLessThanOrEqual(operator.getBoundingClientRect().right);
      expect(box.left).toBeGreaterThanOrEqual(operator.getBoundingClientRect().left);
      const menu = el.shadowRoot!.querySelector<WtRowActions>(".operator-menu")!;
      await menu.updateComplete;
      await userEvent.click(menu.shadowRoot!.querySelector("button")!);
      expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
      expect(menu.querySelector('[data-clock-action="break-start"]')).not.toBeNull();
      expect(menu.querySelector('[data-clock-action="out"]')).not.toBeNull();
    } finally {
      await page.viewport(before.width, before.height);
    }
  },
);

it("A738 More choices keep their navigation and session events", async () => {
  const { el } = await mountWidget<TillShell>("till-shell", {
    canSwitchProfile: true,
    affordances: ["find-bill", "schedule"],
  });
  const more = el.shadowRoot!.querySelector<WtRowActions>('[data-test="more-menu"]')!;
  await more.updateComplete;
  const cases = [
    ["find-bill", "find-bill"],
    ["schedule", "show-schedule"],
    ["profile", "open-profile"],
    ["settings", "open-settings"],
    ["logout", "logout"],
  ] as const;
  const fired: string[] = [];
  for (const [, event] of cases) el.addEventListener(event, () => fired.push(event));
  for (const [cls] of cases) {
    await userEvent.click(more.shadowRoot!.querySelector("button")!);
    await userEvent.click(more.querySelector<HTMLElement>("." + cls)!);
    expect(more.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
  }
  expect(fired).toEqual(["find-bill", "show-schedule", "open-profile", "open-settings", "logout"]);
});
