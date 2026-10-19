import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { TillHeldOrders } from "./held-orders.js";
import { TillCounterWaiting } from "./counter-waiting.js";
import type { HeldOrderSummary, CounterWaitingOrder } from "../api/client.js";

afterEach(cleanupWidgets);
const items = [
  {
    lineId: "dish",
    name: "Crema de calabaza (Ración grande)",
    quantity: "0.375",
    note: "Sin sal. Servir el queso aparte, por favor.",
    extras: [{ lineId: "extra", name: "Queso curado de oveja", quantity: "0.750" }],
  },
  { lineId: "plain", name: "Agua mineral", quantity: "2.000", note: null, extras: [] },
  { lineId: "blank", name: "Pan", quantity: "1.000", note: "", extras: [] },
];
const held: HeldOrderSummary = {
  items,
  id: "held",
  orderNumber: 41,
  label: "Ana Isabel García López — comedor de la terraza",
  itemCount: 4,
  total: "18.50",
  outstanding: "18.50",
  hasPayments: false,
  partyId: null,
  openedAt: "2026-10-19T10:00:00.000Z",
  signals: [],
};
const waiting: CounterWaitingOrder = {
  items,
  id: "sent",
  orderNumber: 42,
  label: "Luis",
  status: "placed",
  total: "18.50",
  openedAt: "2026-10-19T10:00:00.000Z",
  settledAt: null,
  collectedAt: null,
  canHandOver: true,
  serviceMode: "ticket_then_pay",
  movableDishes: [],
};

describe.each(["en-GB", "es-ES"])("A738 native previews %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    it.each([390, 1280])("A738 preview bounds accessibility and LOOK at %i", async (width) => {
      const before = { width: innerWidth, height: innerHeight, locale: currentLocale() };
      await page.viewport(width, 844);
      setLocale(locale);
      try {
        expect(innerWidth).toBe(width);
        const parked = await mountWidget<TillHeldOrders>(
          "till-held-orders",
          {
            orders: [
              held,
              {
                ...held,
                id: "empty",
                orderNumber: 43,
                items: [],
                label: null,
                itemCount: 0,
                total: "0.00",
                outstanding: "0.00",
              },
            ],
          },
          theme,
        );
        const sent = await mountWidget<TillCounterWaiting>(
          "till-counter-waiting",
          { orders: [waiting] },
          theme,
        );
        for (const { el, host } of [parked, sent]) {
          const summary = el.shadowRoot!.querySelector<HTMLButtonElement>("button.summary")!;
          await userEvent.click(summary);
          await el.updateComplete;
          expect(summary.getAttribute("aria-expanded")).toBe("true");
          const preview = el.shadowRoot!.querySelector<HTMLElement>(".order-preview")!;
          expect(preview.checkVisibility()).toBe(true);
          expect(preview.querySelectorAll(".preview-note")).toHaveLength(1);
          expect(preview.querySelectorAll("[data-preview-dish]")).toHaveLength(3);
          expect(preview.querySelectorAll("[data-preview-extra]")).toHaveLength(1);
          expect(
            [...preview.querySelectorAll(".preview-quantity")].map((quantity) =>
              quantity.textContent!.trim(),
            ),
          ).toEqual(
            locale === "es-ES"
              ? ["0,375 ×", "0,750 ×", "2,000 ×", "1,000 ×"]
              : ["0.375 ×", "0.750 ×", "2.000 ×", "1.000 ×"],
          );
          const box = summary.getBoundingClientRect();
          expect(box.height).toBeGreaterThanOrEqual(
            parseFloat(getComputedStyle(el).getPropertyValue("--wt-tap-min")),
          );
          expect(preview.getBoundingClientRect().right).toBeLessThanOrEqual(width);
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
          await expectNoA11yViolations(host);
        }
        const empty =
          parked.el.shadowRoot!.querySelectorAll<HTMLButtonElement>("button.summary")[1]!;
        await userEvent.click(empty);
        await parked.el.updateComplete;
        expect(empty.getAttribute("aria-expanded")).toBe("true");
        expect(
          parked.el.shadowRoot!.querySelectorAll(".order-preview")[1]!.textContent!.trim(),
        ).toBe("");
        await expectNoA11yViolations(parked.host);
        await page.screenshot({
          path: `__screenshots__/a738-previews/${locale}-${theme}-${width}.png`,
        });
      } finally {
        setLocale(before.locale);
        await page.viewport(before.width, before.height);
      }
    });
  });
});
