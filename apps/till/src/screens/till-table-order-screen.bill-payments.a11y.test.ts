import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { resized } from "./till-table-order-screen.test-helpers.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./till-table-order-screen.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { BillBalance, PartyBill, TabLine, TableParty } from "../api/client.js";

beforeEach(() => setLocale("es-ES"));
afterEach(cleanupWidgets);

const party: TableParty = {
  kitchenNote: { scope: { partyId: "v1" }, note: null, revision: 0, ownerRevision: 4 },
  id: "v1",
  revision: 4,
  guestCount: 3,
  state: "open",
  name: null,
  displayName: "4",
  mainBillId: "wo-4",
  outstanding: "39.00",
  billCount: 1,
  tableIds: ["t4"],
  unsentDrafts: [],
  reminder: null,
};

const bill: PartyBill = {
  workingOrderId: "wo-4",
  revision: 0,
  invoiceType: "F2",
  recipient: null,
  partyId: "v1",
  label: null,
  status: "open",
  total: "45.00",
  outstanding: "39.00",
  hasPayments: true,
  receiptAvailable: false,
};

function line(over: Partial<TabLine>): TabLine {
  return {
    stationId: null,
    movable: false,
    id: `line-${over.lineNo}`,
    groupId: null,
    lineNo: 1,
    productId: "p",
    quantity: "1.000",
    unitPrecision: 0,
    unitPriceGross: "1.00",
    servedAt: null,
    courseId: null,
    sentAt: null,
    firedAt: null,
    state: null,
    note: null,
    listId: null,
    menuItemId: null,
    parentProductId: null,
    ...over,
  };
}

const balance: BillBalance = {
  workingOrderId: "wo-4",
  status: "open",
  total: "45.00",
  received: "6.00",
  reserved: "0.00",
  outstanding: "39.00",
  tips: "0.00",
  payments: [],
  paidLines: [
    { lineId: "line-2", lineNo: 2, paidQuantity: "1.000" },
    { lineId: "line-3", lineNo: 3, paidQuantity: "1.000" },
  ],
};

const lines = [
  line({ lineNo: 1, name: "Paella", unitPriceGross: "30.00" }),
  line({ lineNo: 2, name: "Caña", quantity: "3.000", unitPriceGross: "3.00" }),
  line({ lineNo: 3, name: "Tiramisú", unitPriceGross: "6.00" }),
];

async function mountHandheld(
  theme: "light" | "dark",
  shownBill: PartyBill,
  billBalance: BillBalance | null,
) {
  const mounted = await mountWidget<TillTableOrderScreen>(
    "till-table-order-screen",
    {
      products: [],
      lines,
      orderId: "wo-4",
      party,
      bills: [shownBill],
      billBalance,
      fullInvoices: true,
      handheld: true,
    },
    theme,
  );
  mounted.el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
  await mounted.el.updateComplete;
  if (mounted.el.shadowRoot!.querySelector("[data-pay-sheet]") === null)
    throw new Error("the scan must include the handheld's Cobrar");
  return mounted;
}

describe.each(["light", "dark"] as const)(
  "till-table-order-screen handheld Cobrar a11y (%s theme)",
  (theme) => {
    it.each([
      ["an untouched bill", { ...bill, hasPayments: false }, null],
      ["a partly paid bill", bill, balance],
    ] as const)("has no violations for %s", async (_case, shownBill, billBalance) => {
      const { host } = await mountHandheld(theme, shownBill, billBalance);
      await expectNoA11yViolations(host);
    });
  },
);

describe("till-table-order-screen handheld Cobrar look", () => {
  it("is captured in both themes at 390 and 1280, and the themes paint differently", async () => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const backgrounds: Record<string, string> = {};
    try {
      for (const theme of ["light", "dark"] as const)
        for (const width of [390, 1280]) {
          await page.viewport(width, 900);
          expect(window.innerWidth).toBe(width);
          const { el } = await mountHandheld(theme, bill, balance);
          await resized(el);
          const review = el.shadowRoot!.querySelector<HTMLElement>("[data-review-open]");
          if (review?.checkVisibility()) {
            await userEvent.click(review);
            await el.updateComplete;
          }
          const drawer = el.shadowRoot!.querySelector<HTMLElement>("[data-drawer]")!;
          const pay = el.shadowRoot!.querySelector<HTMLElement>("section.pay")!;
          expect(pay.getBoundingClientRect().width).toBeGreaterThan(0);
          expect(pay.scrollWidth).toBeLessThanOrEqual(pay.clientWidth);
          backgrounds[theme] = getComputedStyle(drawer).backgroundColor;
          // The pay section sits below the fold at phone width; the viewport capture shows it.
          pay.scrollIntoView({ block: "end" });
          await page.screenshot({
            path: `__screenshots__/look/a796-handheld-cobrar-${theme}-${width}.png`,
          });
          console.info(
            `look ${theme} ${width}: pay section ${pay.getBoundingClientRect().width}px, Cobrar ${el.shadowRoot!.querySelector("[data-pay-sheet]")!.getBoundingClientRect().width}px`,
          );
          cleanupWidgets();
        }
      expect(backgrounds.light).not.toBe(backgrounds.dark);
    } finally {
      await page.viewport(viewport.width, viewport.height);
    }
  });
});

describe.each(["light", "dark"] as const)(
  "till-table-order-screen bill payments a11y (%s theme)",
  (theme) => {
    it.each([
      ["an untouched bill offering the three ways", { ...bill, hasPayments: false }, null],
      ["a partly paid bill with its paid items marked", bill, balance],
    ] as const)("has no violations for %s", async (_case, shownBill, billBalance) => {
      const { el, host } = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        {
          products: [],
          lines: [
            line({ lineNo: 1, name: "Paella", unitPriceGross: "30.00" }),
            line({ lineNo: 2, name: "Caña", quantity: "3.000", unitPriceGross: "3.00" }),
            line({
              lineNo: 3,
              name: "Tiramisú",
              unitPriceGross: "6.00",
              servedAt: "2026-09-30T20:00:00.000Z",
            }),
          ],
          orderId: "wo-4",
          party,
          bills: [shownBill],
          billBalance,
        },
        theme,
      );
      el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
      await el.updateComplete;
      if (el.shadowRoot!.querySelector("[data-open-bill-pay]") === null)
        throw new Error("the scan must include the ways to pay");
      await expectNoA11yViolations(host);
    });
  },
);
