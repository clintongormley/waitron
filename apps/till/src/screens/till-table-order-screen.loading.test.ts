import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WtButton } from "@waitron/ui";
import { cleanupWidgets, pageAt, resetPage } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { PrintProblem } from "../api/kitchen-api.js";
import { mount, resized } from "./till-table-order-screen.test-helpers.js";
import { openPartyMenu } from "./till-table-order-screen.bill-switcher.test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(() => {
  vi.useRealTimers();
  cleanupWidgets();
});

const shown = (el: TillTableOrderScreen, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector);

describe("till-table-order-screen while loading", () => {
  it.each([
    [390, 844],
    [700, 390],
  ] as const)("keeps Menu visible at the foot of a %i × %i phone", async (width, height) => {
    await pageAt(width, height);
    try {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const { el, host } = await mount({ loading: true });
      host.id = "app";
      await vi.advanceTimersByTimeAsync(300);
      const foot = shown(el, "footer")!.getBoundingClientRect();
      const menu = shown(el, "footer wt-button")!.getBoundingClientRect();
      expect(menu.bottom).toBeLessThanOrEqual(height);
      expect(foot.bottom).toBeCloseTo(height, 0);
    } finally {
      vi.useRealTimers();
      await resetPage();
    }
  });

  it("while loading it keeps Back and draws quiet rows after a short wait", async () => {
    const problems: PrintProblem[] = [
      {
        workingOrderId: "wo-4",
        stationId: "st-1",
        stationName: "Cocina",
        since: "2026-09-27T10:00:00Z",
      },
    ];
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { el, host } = await mount({ loading: true, printProblems: problems });
    host.style.width = "390px";
    expect(shown(el, "[data-loading]")?.textContent?.trim()).toBe("");
    expect(shown(el, "wt-placeholder")).toBeNull();
    await vi.advanceTimersByTimeAsync(300);
    const root = el.shadowRoot!;
    const widths = [...root.querySelectorAll(".loading-order-row wt-placeholder:nth-child(2)")].map(
      (bar) => bar.getBoundingClientRect().width,
    );
    expect(widths).toEqual([170, 120, 200, 140]);
    const row = root.querySelector(".loading-order-row")!;
    const quantity = row.querySelector("wt-placeholder")!;
    expect(quantity.getBoundingClientRect().left - row.getBoundingClientRect().left).toBe(16);
    const menu = root.querySelector<WtButton>("footer wt-button");
    expect(menu?.textContent?.trim()).toBe("Menu");
    expect(menu?.disabled).toBe(true);
    expect(shown(el, "section.screen")?.getAttribute("aria-busy")).toBe("true");
    expect(shown(el, "[data-back]")).not.toBeNull();
    expect(shown(el, "[data-draft-pane]")).toBeNull();
    expect(shown(el, "[data-party-menu]")).toBeNull();
    expect(shown(el, "[data-table-menu]")).toBeNull();
    expect(shown(el, "till-order-kitchen-note")).toBeNull();
    expect(shown(el, "till-table-status")).toBeNull();
    expect(shown(el, "[data-print-problem]")).toBeNull();
  });

  it("keeps the order notice when the menu answers but the order is still loading", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { el } = await mount({ loading: true, menuFirstRead: "waiting" });
    await vi.advanceTimersByTimeAsync(6_000);
    el.menuFirstRead = undefined;
    await el.updateComplete;
    expect(shown(el, "[data-first-read-status]")?.textContent?.trim()).toBe(
      "Still waiting for the box…",
    );
  });

  it("a table menu step left open is not shown while loading", async () => {
    const { el } = await mount();
    await openPartyMenu(el);
    shown(el, '[data-party-menu] [data-action="move"]')!.click();
    await el.updateComplete;
    expect(shown(el, "[data-action-panel]")).not.toBeNull();
    el.loading = true;
    await el.updateComplete;
    expect(shown(el, "[data-action-panel]")).toBeNull();
    expect(shown(el, "[data-loading]")).not.toBeNull();
  });

  it("follows the screen's width after loading ends", async () => {
    const { el, host } = await mount({ loading: true });
    host.style.width = "1280px";
    await resized(el);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    el.serviceVisit++;
    await el.updateComplete;
    await vi.advanceTimersByTimeAsync(300);
    const menu = shown(el, ".first-menu-read")?.getBoundingClientRect();
    const order = shown(el, ".loading-order-row")?.getBoundingClientRect();
    expect(menu?.width ?? 0).toBeGreaterThan(0);
    expect(menu!.right).toBeLessThanOrEqual(order!.left);
    vi.useRealTimers();
    el.loading = false;
    await resized(el);
    const sideBySide = () => shown(el, "[data-draft-pane]")?.checkVisibility() ?? false;
    expect(sideBySide()).toBe(true);
    host.style.width = "400px";
    await resized(el);
    expect(sideBySide()).toBe(false);
    host.style.width = "1280px";
    await resized(el);
    expect(sideBySide()).toBe(true);
  });

  it("Back while loading still asks to go back to the floor", async () => {
    const { el } = await mount({ loading: true });
    let backs = 0;
    el.addEventListener("back-to-floor", () => backs++);
    shown(el, "[data-back]")!.click();
    expect(backs).toBe(1);
  });

  it("the order replaces the loading line once loading ends", async () => {
    const { el } = await mount({ loading: true });
    el.loading = false;
    await el.updateComplete;
    expect(shown(el, "[data-loading]")).toBeNull();
    expect(shown(el, "section.screen")?.hasAttribute("aria-busy")).toBe(false);
    expect(shown(el, "[data-draft-pane]")).not.toBeNull();
    expect(shown(el, "[data-party-menu]")).not.toBeNull();
    expect(shown(el, "till-order-kitchen-note")).not.toBeNull();
  });
});
