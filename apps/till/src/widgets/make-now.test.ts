import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./make-now.js";
import type { TillMakeNow } from "./make-now.js";

afterEach(cleanupWidgets);

describe("till-make-now", () => {
  const item = {
    lineId: "lager",
    name: "Lager",
    quantity: "2.000",
    unitName: null,
    soldInEach: true,
    optionSnapshots: [
      {
        listName: { en: "Size" },
        listCustomerName: { en: "Glass size" },
        listKitchenName: "SZ",
        labelName: { en: "Large" },
        labelCustomerName: { en: "Big" },
        labelKitchenName: "LG",
      },
    ],
    extras: ["Lime"],
    note: "Cold",
  };

  it("shows a persistent staff instruction until Done", async () => {
    const { el } = await mountWidget<TillMakeNow>("till-make-now", { items: [item] });
    expect(el.shadowRoot!.textContent).toContain("Make now");
    expect(el.shadowRoot!.textContent).toContain("2× Lager");
    expect(el.shadowRoot!.textContent).toContain("Size: Large");
    expect(el.shadowRoot!.textContent).not.toContain("Glass size");
    expect(el.shadowRoot!.textContent).toContain("+ Lime");
    expect(el.shadowRoot!.textContent).toContain("Cold");
    const dismissed = vi.fn();
    el.addEventListener("dismiss", dismissed);
    el.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
    expect(dismissed).toHaveBeenCalledOnce();
  });

  it("renders nothing for an empty list", async () => {
    const { el } = await mountWidget<TillMakeNow>("till-make-now", { items: [] });
    expect(el.shadowRoot!.textContent?.trim()).toBe("");
  });

  it("fits a phone without horizontal scrolling", async () => {
    await page.viewport(320, 700);
    try {
      const { el } = await mountWidget<TillMakeNow>("till-make-now", { items: [item] });
      const box = el.shadowRoot!.querySelector("section")!.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(320);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
    } finally {
      await page.viewport(414, 896);
    }
  });
});
