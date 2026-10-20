import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { TillApi } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { TillHeldOrders } from "./held-orders.js";
import { TillCounterWaiting } from "./counter-waiting.js";
import { TillDepartmentTransfers } from "./department-transfers.js";

afterEach(cleanupWidgets);
const tableLabel = "Garden terrace — North 1 + North 2";
const base = {
  id: "bill",
  orderNumber: 12,
  label: "Birthday bill",
  tableLabel,
  items: [],
  total: "18.50",
  openedAt: "2026-10-19T10:00:00.000Z",
};
const transfer = {
  id: "transfer",
  tabId: "bill",
  sourceDepartmentId: "counter",
  destinationDepartmentId: "dining",
  senderId: "sender",
  resolvedBy: null,
  destinationZoneId: null,
  status: "pending" as const,
  reason: null,
  createdAt: base.openedAt,
  resolvedAt: null,
  revision: 0,
  summary: {
    orderNumber: 12,
    tabLabel: base.label,
    tableLabel,
    sourceDepartmentName: "Counter",
    destinationDepartmentName: "Dining room",
  },
};

describe("A765 visible order table names", () => {
  it("identifies a party's held bill in the row and action names, keeping its own label", async () => {
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", {
      orders: [
        {
          ...base,
          itemCount: 2,
          outstanding: "18.50",
          hasPayments: false,
          partyId: "party",
          signals: [],
        },
      ],
    });
    expect(el.shadowRoot!.querySelector(".summary")!.textContent).toContain(tableLabel);
    expect(el.shadowRoot!.querySelector(".summary")!.textContent).toContain(base.label);
    expect(el.shadowRoot!.querySelector(".retrieve")!.getAttribute("aria-label")).toContain(
      tableLabel,
    );
  });

  it("names the delivery table in Waiting and its action names", async () => {
    const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
      orders: [
        {
          ...base,
          status: "placed",
          settledAt: null,
          collectedAt: null,
          canHandOver: true,
          serviceMode: "ticket_then_pay",
          movableDishes: [],
        },
      ],
    });
    expect(el.shadowRoot!.querySelector(".summary")!.textContent).toContain(tableLabel);
    expect(el.shadowRoot!.querySelector(".summary")!.textContent).toContain(base.label);
    expect(
      el.shadowRoot!.querySelector("[data-waiting-pay]")!.getAttribute("aria-label"),
    ).toContain(tableLabel);
  });

  it("names the current table in transfer notices, lists and detail without replacing the tab label", async () => {
    const detail = {
      request: transfer,
      tab: {
        id: "bill",
        revision: 0,
        status: "placed",
        label: base.label,
        orderNumber: 12,
        deliveryTableId: "table",
      },
      lines: [],
      outstandingWork: [],
    };
    const api = new TillApi(
      "",
      async () =>
        new Response(JSON.stringify(detail), { headers: { "content-type": "application/json" } }),
    );
    const { el } = await mountWidget<TillDepartmentTransfers>("till-department-transfers", {
      api,
      open: true,
      snapshot: {
        incoming: [transfer],
        sent: [],
        receivingAllowed: true,
        notifications: [transfer],
        error: undefined,
      },
    });
    expect(el.shadowRoot!.querySelector("[data-notification=transfer]")!.textContent).toContain(
      tableLabel,
    );
    expect(el.shadowRoot!.querySelector("[data-incoming=transfer]")!.textContent).toContain(
      tableLabel,
    );
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-view]")!);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-current-tab]")?.textContent).toContain(tableLabel),
    );
    expect(el.shadowRoot!.querySelector("[data-current-tab]")!.textContent).toContain(base.label);
  });

  it.each([null, "Alex"])(
    "keeps a table-free order label %s without repeating it",
    async (label) => {
      const { el } = await mountWidget<TillHeldOrders>("till-held-orders", {
        orders: [
          {
            ...base,
            label,
            tableLabel: label ?? undefined,
            itemCount: 0,
            outstanding: "18.50",
            hasPayments: false,
            partyId: null,
            signals: [],
          },
        ],
      });
      expect(el.shadowRoot!.querySelector(".label")?.textContent.trim() ?? null).toBe(label);
    },
  );
});

describe.each(["en-GB", "es-ES"])("A765 native table names %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    it.each([390, 1280])("fits and names joined tables at %i", async (width) => {
      const before = { locale: currentLocale(), width: innerWidth, height: innerHeight };
      await page.viewport(width, 900);
      setLocale(locale);
      try {
        const held = await mountWidget<TillHeldOrders>(
          "till-held-orders",
          {
            orders: [
              {
                ...base,
                itemCount: 2,
                outstanding: "18.50",
                hasPayments: false,
                partyId: "party",
                signals: [],
              },
            ],
          },
          theme,
        );
        const waiting = await mountWidget<TillCounterWaiting>(
          "till-counter-waiting",
          {
            orders: [
              {
                ...base,
                status: "placed",
                settledAt: null,
                collectedAt: null,
                canHandOver: true,
                serviceMode: "ticket_then_pay",
                movableDishes: [],
              },
            ],
          },
          theme,
        );
        for (const { el, host } of [held, waiting]) {
          const label = el.shadowRoot!.querySelector<HTMLElement>(".label")!;
          expect(label.textContent).toContain(tableLabel);
          expect(label.checkVisibility()).toBe(true);
          expect(label.getBoundingClientRect().right).toBeLessThanOrEqual(width);
          await expectNoA11yViolations(host);
        }
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        await page.screenshot({
          path: `__screenshots__/a765-table-names/${locale}-${theme}-${width}.png`,
        });
        const detail = {
          request: transfer,
          tab: {
            id: "bill",
            revision: 0,
            status: "placed",
            label: base.label,
            orderNumber: 12,
            deliveryTableId: "table",
          },
          lines: [],
          outstandingWork: [],
        };
        const api = new TillApi(
          "",
          async () =>
            new Response(JSON.stringify(detail), {
              headers: { "content-type": "application/json" },
            }),
        );
        const moved = await mountWidget<TillDepartmentTransfers>(
          "till-department-transfers",
          {
            api,
            open: true,
            snapshot: {
              incoming: [transfer],
              sent: [{ ...transfer, id: "sent", status: "accepted" }],
              receivingAllowed: true,
              notifications: [],
              error: undefined,
            },
          },
          theme,
        );
        await userEvent.click(moved.el.shadowRoot!.querySelector<HTMLElement>("[data-view]")!);
        await vi.waitFor(() =>
          expect(moved.el.shadowRoot!.querySelector("[data-current-tab]")?.textContent).toContain(
            tableLabel,
          ),
        );
        for (const selector of [
          "[data-current-tab]",
          "[data-incoming=transfer]",
          "[data-sent=sent]",
        ]) {
          const row = moved.el.shadowRoot!.querySelector<HTMLElement>(selector)!;
          expect(row.textContent).toContain(tableLabel);
          expect(row.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        }
        await expectNoA11yViolations(moved.host);
        await page.screenshot({
          path: `__screenshots__/a765-table-names/${locale}-${theme}-${width}-transfer.png`,
        });
      } finally {
        setLocale(before.locale);
        await page.viewport(before.width, before.height);
      }
    });
  });
});
