import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { decimal, formatMoney } from "@waitron/shared";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { mount } from "./till-table-order-screen.test-helpers.js";
import {
  current,
  currentGroup,
  orderGroup,
} from "./till-table-order-screen.current-orders.test-helpers.js";
import { dish, extra, recorded } from "./till-table-order-screen.sent-prices.test-helpers.js";
import { openSentDish } from "./till-table-order-screen.sent.test-helpers.js";

const money = (value: string) => formatMoney(decimal(value), currentLocale());
const text = (element: Element) => element.textContent!.replace(/\s+/g, " ").trim();
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

it.each(["fired", "held", "served"] as const)(
  "keeps a %s dish's original prices beside its given-away dish and extra amounts",
  async (kind) => {
    const service = {
      ...recorded,
      released: kind !== "held",
      ...(kind === "served" ? { servedAt: "2026-09-28T20:05:00Z", servedQuantity: "2.000" } : {}),
    };
    const { el } = await mount({
      lines: [dish, extra],
      groups: [orderGroup("group", 1, kind === "held" ? "held" : "fired")],
      currentOrders: current({
        groups: [currentGroup("group", 1, kind === "held" ? "held" : "fired", [service])],
        ungrouped: [],
        reminder: null,
      }),
    });
    const dialog = await openSentDish(el, "dish", kind);
    const amount = dialog.querySelector("[data-sent-line-amount]")!;
    expect(text(amount)).toBe(`${t("table.price_was")} ${money("18.00")} ${money("0.00")}`);
    expect(amount.querySelector("s")!.textContent).toBe(money("18.00"));
    expect(text(dialog.querySelector('[data-sent-extra="extra"] .amount')!)).toBe(
      `${t("table.price_was")} ${money("3.00")} ${money("0.00")}`,
    );
    expect(
      amount.querySelector<HTMLElement>("[data-price-was]")!.getBoundingClientRect().width,
    ).toBeLessThanOrEqual(1);
  },
);

it("keeps current service amounts when the bill read has older adjusted prices", async () => {
  const { el } = await mount({
    lines: [{ ...dish, unitPriceGross: "1.00" }, extra],
    currentOrders: current({
      groups: [],
      reminder: null,
      ungrouped: [
        {
          ...recorded,
          netAmount: "14.00",
          extras: [{ ...recorded.extras[0]!, netAmount: "2.00" }],
        },
      ],
    }),
  });
  const dialog = await openSentDish(el, "dish");
  expect(text(dialog.querySelector("[data-sent-line-amount]")!)).toBe(
    `${t("table.price_was")} ${money("18.00")} ${money("12.00")}`,
  );
  expect(text(dialog.querySelector('[data-sent-extra="extra"] .amount')!)).toBe(
    `${t("table.price_was")} ${money("3.00")} ${money("2.00")}`,
  );
});

it.each(["absent", "different-id", "different-parent", "unadjusted"] as const)(
  "does not invent an original price from a %s bill row",
  async (mismatch) => {
    const lines =
      mismatch === "absent"
        ? []
        : mismatch === "different-id"
          ? [
              { ...dish, id: "other-dish" },
              { ...extra, id: "other-extra" },
            ]
          : mismatch === "different-parent"
            ? [
                { ...dish, lineNo: 4 },
                { ...extra, parentLineNo: 4 },
              ]
            : [
                { ...dish, listUnitPriceGross: undefined },
                { ...extra, listUnitPriceGross: undefined },
              ];
    const { el } = await mount({
      lines,
      currentOrders: current({ groups: [], ungrouped: [recorded], reminder: null }),
    });
    const dialog = await openSentDish(el, "dish");
    expect(text(dialog.querySelector("[data-sent-line-amount]")!)).toBe(money("0.00"));
    expect(text(dialog.querySelector('[data-sent-extra="extra"] .amount')!)).toBe(money("0.00"));
    expect(dialog.querySelector("s")).toBeNull();
  },
);

it("keeps served dishes in Sent without a duplicate Served list in the drawer", async () => {
  const { el } = await mount({
    lines: [{ ...dish, servedAt: "2026-09-28T20:05:00Z" }],
    currentOrders: current({
      groups: [],
      reminder: null,
      ungrouped: [
        { ...recorded, servedAt: "2026-09-28T20:05:00Z", servedQuantity: "2.000", extras: [] },
      ],
    }),
  });
  const dialog = await openSentDish(el, "dish", "served");
  expect(dialog.textContent).toContain("Recorded pizza");
  const closed = new Promise<void>((resolve) =>
    dialog.addEventListener("wt-close", () => resolve(), { once: true }),
  );
  dialog.closeAfter("saved");
  await closed;
  await el.updateComplete;
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!);
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector("[data-drawer] .served, [data-drawer] .served-line"),
  ).toBeNull();
});
