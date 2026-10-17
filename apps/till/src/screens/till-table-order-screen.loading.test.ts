import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { PrintProblem } from "../api/client.js";
import { mount, resized } from "./till-table-order-screen.test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

const shown = (el: TillTableOrderScreen, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector);

describe("till-table-order-screen while loading", () => {
  it("while loading it shows only Back and the loading line", async () => {
    const problems: PrintProblem[] = [
      {
        workingOrderId: "wo-4",
        stationId: "st-1",
        stationName: "Cocina",
        since: "2026-09-27T10:00:00Z",
      },
    ];
    const { el } = await mount({ loading: true, printProblems: problems });
    expect(shown(el, "[data-loading]")?.textContent?.trim()).toBe("Loading…");
    expect(shown(el, "[data-loading]")?.getAttribute("role")).toBe("status");
    expect(shown(el, "section.screen")?.getAttribute("aria-busy")).toBe("true");
    expect(shown(el, "[data-back]")).not.toBeNull();
    expect(shown(el, "[data-draft-pane]")).toBeNull();
    expect(shown(el, "[data-open-drawer]")).toBeNull();
    expect(shown(el, "till-order-kitchen-note")).toBeNull();
    expect(shown(el, "till-table-status")).toBeNull();
    expect(shown(el, "[data-print-problem]")).toBeNull();
  });

  it("a drawer left open is not shown while loading", async () => {
    const { el } = await mount();
    shown(el, "[data-open-drawer]")!.click();
    await el.updateComplete;
    expect(shown(el, "[data-drawer]")).not.toBeNull();
    el.loading = true;
    await el.updateComplete;
    expect(shown(el, "[data-drawer]")).toBeNull();
    expect(shown(el, "[data-loading]")).not.toBeNull();
  });

  it("follows the screen's width after loading ends", async () => {
    const { el, host } = await mount({ loading: true });
    host.style.width = "1280px";
    await resized(el);
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
    expect(shown(el, "[data-open-drawer]")).not.toBeNull();
    expect(shown(el, "till-order-kitchen-note")).not.toBeNull();
  });
});
