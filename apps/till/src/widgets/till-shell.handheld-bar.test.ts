import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./till-shell.js";
import type { TillShell } from "./till-shell.js";
import type { BarTable } from "../state/bar-tables.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { WtRowActions } from "@waitron/ui";

let originalLocale = currentLocale();

beforeEach(() => {
  originalLocale = currentLocale();
});

afterEach(() => {
  cleanupWidgets();
  setLocale(originalLocale);
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function atViewport(width: number, height: number, run: () => Promise<void>): Promise<void> {
  const before = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(width, height);
  await frame();
  try {
    await run();
  } finally {
    await page.viewport(before.width, before.height);
  }
}

const tablesOf = (count: number, current?: string): BarTable[] =>
  Array.from({ length: count }, (_, i) => ({
    tableId: `t${i + 1}`,
    name: `T${i + 1}`,
    unsent: true,
    current: `t${i + 1}` === current,
    held: false,
  }));

const withLongName = (tables: BarTable[], tableId: string): BarTable[] =>
  tables.map((table) =>
    table.tableId === tableId ? { ...table, name: "Outside terrace by the garden" } : table,
  );

const fadeOf = (scroller: HTMLElement) =>
  parseFloat(getComputedStyle(scroller).getPropertyValue("--fade-width"));

const floorOf = (el: TillShell) => el.shadowRoot!.querySelector<HTMLElement>("header .tab")!;
const scrollerOf = (el: TillShell) =>
  el.shadowRoot!.querySelector<HTMLElement>("header [data-bar-table]")!.parentElement!;

describe("a handheld's bar with more table buttons than fit", () => {
  for (const width of [360, 390]) {
    for (const theme of ["light", "dark"] as const) {
      it(`keeps Floor in view at the start while the table buttons scroll, at ${width} in ${theme}`, async () => {
        setLocale("en-GB");
        await atViewport(width, 844, async () => {
          const { el } = await mountWidget<TillShell>(
            "till-shell",
            {
              formFactor: "phone-portrait",
              activeScreen: "order",
              operatorName: "Ana",
              barTables: tablesOf(10, "t10"),
            },
            theme,
          );
          const scroller = scrollerOf(el);
          await vi.waitFor(() => expect(Math.abs(scroller.scrollLeft)).toBeGreaterThan(0));
          expect(scroller.contains(floorOf(el))).toBe(false);
          const header = el.shadowRoot!.querySelector("header")!.getBoundingClientRect();
          const floor = floorOf(el).getBoundingClientRect();
          expect(floor.width).toBeGreaterThan(0);
          expect(floor.left).toBeGreaterThanOrEqual(header.left);
          expect(floor.right).toBeLessThanOrEqual(scroller.getBoundingClientRect().left + 0.5);
          scroller.scrollLeft = 0;
          await frame();
          expect(floorOf(el).getBoundingClientRect().left).toBe(floor.left);
        });
      });
    }
  }

  it("fades the cut edge on the side that has more buttons, and neither once they all fit", async () => {
    setLocale("en-GB");
    await atViewport(390, 844, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", {
        formFactor: "phone-portrait",
        activeScreen: "floor",
        operatorName: "Ana",
        barTables: tablesOf(10),
      });
      const scroller = scrollerOf(el);
      await vi.waitFor(() => expect(scroller.dataset.overflow).toBe("end"));
      expect(getComputedStyle(scroller).maskImage).not.toBe("none");
      scroller.scrollLeft = scroller.scrollWidth;
      await vi.waitFor(() => expect(scroller.dataset.overflow).toBe("start"));
      scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
      await vi.waitFor(() => expect(scroller.dataset.overflow).toBe("both"));
      el.barTables = tablesOf(1);
      await el.updateComplete;
      await vi.waitFor(() => expect(scrollerOf(el).dataset.overflow).toBeUndefined());
      expect(getComputedStyle(scrollerOf(el)).maskImage).toBe("none");
    });
  });

  it("scrolls the selected table clear of the fade when a button lies beyond it", async () => {
    setLocale("en-GB");
    await atViewport(390, 844, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", {
        formFactor: "phone-portrait",
        activeScreen: "order",
        operatorName: "Ana",
        barTables: tablesOf(10, "t5"),
      });
      const scroller = scrollerOf(el);
      const fade = () => parseFloat(getComputedStyle(scroller).getPropertyValue("--fade-width"));
      await vi.waitFor(() => expect(scroller.dataset.overflow).toBe("both"));
      expect(fade()).toBeGreaterThan(0);
      const view = scroller.getBoundingClientRect();
      const box = el.shadowRoot!.querySelector('[data-bar-table="t5"]')!.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(view.left + fade() - 0.5);
      expect(box.right).toBeLessThanOrEqual(view.right - fade() + 0.5);
    });
  });

  it("still fades the hidden buttons when an unselected table's name is wider than the strip", async () => {
    setLocale("en-GB");
    await atViewport(390, 844, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", {
        formFactor: "phone-portrait",
        activeScreen: "order",
        operatorName: "Ana",
        barTables: withLongName(tablesOf(10, "t5"), "t3"),
      });
      const scroller = scrollerOf(el);
      const long = el.shadowRoot!.querySelector('[data-bar-table="t3"]')!;
      expect(long.getBoundingClientRect().width).toBeGreaterThan(scroller.clientWidth);
      await vi.waitFor(() => expect(scroller.dataset.overflow).toBe("both"));
      expect(fadeOf(scroller)).toBeGreaterThan(0);
      expect(getComputedStyle(scroller).maskImage).not.toBe("none");
    });
  });

  it("fades at full width while Floor is selected, whatever the tables' names", async () => {
    setLocale("en-GB");
    await atViewport(390, 844, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", {
        formFactor: "phone-portrait",
        activeScreen: "floor",
        operatorName: "Ana",
        barTables: withLongName(tablesOf(10), "t1"),
      });
      const scroller = scrollerOf(el);
      const full = parseFloat(getComputedStyle(scroller).getPropertyValue("--wt-space-6")) * 2;
      await vi.waitFor(() => expect(scroller.dataset.overflow).toBe("end"));
      await vi.waitFor(() => expect(fadeOf(scroller)).toBe(full));
    });
  });

  for (const direction of ["ltr", "rtl"] as const) {
    it(`shows the start of a selected table's name wider than the strip, in ${direction}`, async () => {
      setLocale("en-GB");
      await atViewport(390, 844, async () => {
        const { el, host } = await mountWidget<TillShell>("till-shell", {
          formFactor: "phone-portrait",
          activeScreen: "floor",
          operatorName: "Ana",
          barTables: withLongName(tablesOf(10), "t5"),
        });
        host.dir = direction;
        await frame();
        el.activeScreen = "order";
        el.barTables = withLongName(tablesOf(10, "t5"), "t5");
        await el.updateComplete;
        const scroller = scrollerOf(el);
        const button = el.shadowRoot!.querySelector('[data-bar-table="t5"]')!;
        await vi.waitFor(() => expect(Math.abs(scroller.scrollLeft)).toBeGreaterThan(0));
        await frame();
        const view = scroller.getBoundingClientRect();
        const box = button.getBoundingClientRect();
        expect(box.width).toBeGreaterThan(view.width);
        if (direction === "ltr") expect(box.left).toBeCloseTo(view.left, 0);
        else expect(box.right).toBeCloseTo(view.right, 0);
      });
    });
  }

  it("leaves the fade's width alone while the strip scrolls", async () => {
    setLocale("en-GB");
    await atViewport(390, 844, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", {
        formFactor: "phone-portrait",
        activeScreen: "floor",
        operatorName: "Ana",
        barTables: tablesOf(10),
      });
      const scroller = scrollerOf(el);
      await vi.waitFor(() => expect(scroller.dataset.overflow).toBe("end"));
      await frame();
      await frame();
      scroller.style.setProperty("--fade-width", "7px");
      scroller.scrollLeft = scroller.scrollWidth;
      await vi.waitFor(() => expect(scroller.dataset.overflow).toBe("start"));
      expect(scroller.style.getPropertyValue("--fade-width")).toBe("7px");
    });
  });
});

describe("a handheld's bar above phone width", () => {
  it("keeps Floor where it is as table buttons appear, at 1024", async () => {
    setLocale("en-GB");
    await atViewport(1024, 768, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", {
        formFactor: "tablet-landscape",
        activeScreen: "floor",
        operatorName: "Marta Ruiz",
        barTables: [],
      });
      await frame();
      const at = [floorOf(el).getBoundingClientRect().left];
      for (const count of [1, 2]) {
        el.barTables = tablesOf(count);
        await el.updateComplete;
        await frame();
        at.push(floorOf(el).getBoundingClientRect().left);
      }
      expect(at).toEqual([at[0], at[0], at[0]]);
    });
  });
});

describe("a handheld's More on a short phone", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`opens below ☰ and scrolls rather than covering it, at 360×640 in ${theme}`, async () => {
      setLocale("es-ES");
      await atViewport(360, 640, async () => {
        const { el } = await mountWidget<TillShell>(
          "till-shell",
          {
            formFactor: "phone-portrait",
            activeScreen: "floor",
            operatorName: "Marta Ruiz",
            clockAvailable: true,
            clockState: {
              personId: "marta",
              locationId: "venue",
              businessDay: "2026-10-29",
              state: "working",
              activeLocationId: "venue",
              lastEntryId: "entry",
              firstClockIn: false,
            },
            affordances: ["find-bill", "schedule", "expo"],
            canSwitchProfile: true,
            transferAvailable: true,
            transferCount: 0,
            loadLocales: async () => [
              { code: "es-ES", label: "Español" },
              { code: "en-GB", label: "English" },
            ],
          },
          theme,
        );
        const menu = el.shadowRoot!.querySelector<HTMLElement>(
          'header wt-row-actions[data-test="more-menu"]',
        )!;
        const trigger = menu.shadowRoot!.querySelector("button")!;
        await userEvent.click(trigger);
        const popup = menu.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
        expect(popup.matches(":popover-open")).toBe(true);
        await frame();
        const box = popup.getBoundingClientRect();
        expect(box.top).toBeGreaterThanOrEqual(trigger.getBoundingClientRect().bottom - 0.5);
        expect(box.bottom).toBeLessThanOrEqual(innerHeight + 0.5);
        expect(popup.scrollHeight).toBeGreaterThan(popup.clientHeight);
        (menu as WtRowActions).hide();
        (menu as WtRowActions).show();
        expect(popup.getBoundingClientRect().top, "placed under ☰ as it opens").toBe(box.top);
      });
    });
  }
});
