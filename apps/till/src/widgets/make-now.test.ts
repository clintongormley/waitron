import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { currentContentLanguages, setContentLanguages } from "@waitron/ui";
import { currentLocale, setLocale } from "../i18n/t.js";
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
    extras: [{ name: "Lime", quantity: "2.000", unitName: null, soldInEach: true, perDish: 1 }],
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

  for (const [locale, dish, ham] of [
    ["es-ES", "0,375 kg× Pulpo", "+ Ham 0,125 rac"],
    ["en-GB", "0.375 kg× Pulpo", "+ Ham 0.125 srv"],
  ] as const)
    it(`writes a dish and its extras with the ${locale} screen's decimal mark`, async () => {
      const prior = currentLocale();
      const priorLanguages = currentContentLanguages();
      setLocale(locale);
      setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] });
      try {
        const { el } = await mountWidget<TillMakeNow>("till-make-now", {
          items: [
            {
              ...item,
              name: "Pulpo",
              quantity: "0.375",
              unitName: { es: "kg", en: "kg" },
              soldInEach: false,
              optionSnapshots: [],
              extras: [
                {
                  name: "Ham",
                  quantity: "0.125",
                  unitName: { en: "srv", es: "rac" },
                  soldInEach: false,
                  perDish: 1,
                },
                { name: "Lima", quantity: "2.000", unitName: null, soldInEach: false, perDish: 2 },
              ],
              note: null,
            },
          ],
        });
        const details = [...el.shadowRoot!.querySelectorAll(".detail")].map((span) =>
          span.textContent!.trim(),
        );
        expect(el.shadowRoot!.querySelector("strong")!.textContent).toBe(dish);
        expect(details).toEqual([ham, "+ Lima x2"]);
      } finally {
        setContentLanguages(priorLanguages);
        setLocale(prior);
      }
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
