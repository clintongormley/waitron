import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cardFrameStyles } from "@waitron/ui";
import type { TillScheduleScreen } from "../screens/till-schedule-screen.js";
import "../screens/till-schedule-screen.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";

afterEach(cleanupWidgets);

it("the shared frame and till screen paint the card's tokens", async () => {
  const viewport = { width: innerWidth, height: innerHeight };
  await page.viewport(1024, 768);
  try {
    const card = await mountWidget("wt-card", {});
    const screen = await mountWidget<TillScheduleScreen>("till-schedule-screen", {
      api: {
        listMyShifts: vi.fn().mockResolvedValue([]),
        listMySwaps: vi.fn().mockResolvedValue([]),
        listMyAbsences: vi.fn().mockResolvedValue([]),
      } as unknown as TillScheduleScreen["api"],
    });
    const sheet = document.createElement("style");
    sheet.textContent = `.shared-card-probe { ${cardFrameStyles.cssText} }`;
    const shared = document.createElement("section");
    shared.className = "shared-card-probe";
    card.host.append(sheet, shared);
    for (const host of [card.host, screen.host]) {
      host.style.setProperty("--wt-color-surface", "rgb(7, 8, 9)");
      host.style.setProperty("--wt-color-border", "rgb(10, 11, 12)");
      host.style.setProperty("--wt-radius-lg", "13px");
      host.style.setProperty("--wt-space-4", "12px");
    }
    const reference = getComputedStyle(card.el.shadowRoot!.querySelector(".card")!);
    expect(reference.backgroundColor).toBe("rgb(7, 8, 9)");
    expect(reference.borderTopColor).toBe("rgb(10, 11, 12)");
    expect(reference.borderTopLeftRadius).toBe("13px");
    for (const element of [shared, screen.el.shadowRoot!.querySelector(".screen")!]) {
      const style = getComputedStyle(element);
      for (const property of [
        "background-color",
        "border-top-color",
        "border-top-width",
        "border-top-left-radius",
        "padding-inline-start",
        "--wt-form-actions-surface",
      ]) {
        expect(style.getPropertyValue(property)).toBe(reference.getPropertyValue(property));
      }
    }
  } finally {
    await page.viewport(viewport.width, viewport.height);
  }
});
