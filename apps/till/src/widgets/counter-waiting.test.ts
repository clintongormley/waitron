import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { formatMoney } from "@waitron/shared";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillCounterWaiting } from "./counter-waiting.js";
import type { CounterWaitingOrder } from "../api/client.js";

const paid: CounterWaitingOrder = {
  items: [],
  id: "wo-paid",
  orderNumber: 11,
  label: "Ana",
  status: "settled",
  openedAt: "2026-10-01T10:00:00.000Z",
  settledAt: "2026-10-01T10:01:00.000Z",
  collectedAt: null,
  total: "18.00",
  canHandOver: true,
  serviceMode: null,
  movableDishes: [],
};

const sent: CounterWaitingOrder = {
  items: [],
  id: "wo-sent",
  orderNumber: 12,
  label: null,
  status: "placed",
  openedAt: "2026-10-01T10:02:00.000Z",
  settledAt: null,
  collectedAt: null,
  total: "7.50",
  canHandOver: true,
  serviceMode: "ticket_then_pay",
  movableDishes: [],
};

const handedOver: CounterWaitingOrder = {
  ...sent,
  id: "wo-handed",
  orderNumber: 13,
  collectedAt: "2026-10-01T10:05:00.000Z",
  canHandOver: false,
};

afterEach(cleanupWidgets);

const rowOf = (el: TillCounterWaiting, id: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-waiting-order="${id}"]`)!;
const buttons = (row: HTMLElement) =>
  [...row.querySelectorAll<HTMLElement>("wt-button")].map((b) => b.textContent!.trim());

describe("till-counter-waiting", () => {
  describe("the numbers an order's dishes were sent to the kitchen under", () => {
    const number = (el: TillCounterWaiting) =>
      el.shadowRoot!.querySelector(".summary .number")!.textContent!.replace(/\s+/g, " ").trim();

    it.each([
      ["en-GB", "#41 (was 40)"],
      ["es-ES", "#41 (antes 40)"],
    ])("follow the order's number (%s)", async (locale, text) => {
      const previousLocale = currentLocale();
      setLocale(locale);
      try {
        const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
          orders: [{ ...sent, orderNumber: 41, formerNumbers: [40] }],
        });
        expect(number(el)).toBe(text);
      } finally {
        setLocale(previousLocale);
      }
    });

    it("leave a plain number on an order that never moved", async () => {
      const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
        orders: [{ ...sent, orderNumber: 41 }],
      });
      expect(number(el)).toBe("#41");
    });
  });

  it("registers as a custom element", () => {
    expect(customElements.get("till-counter-waiting")).toBe(TillCounterWaiting);
  });

  it("renders nothing at all when no order is waiting", async () => {
    const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", { orders: [] });
    expect(el.shadowRoot!.textContent!.trim()).toBe("");
    expect(el.shadowRoot!.querySelector("h2")).toBeNull();
  });

  it("titles the list and shows each order's number, label and total", async () => {
    const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
      orders: [paid, sent],
    });
    expect(el.shadowRoot!.querySelector("h2")!.textContent).toBe(t("waiting.title"));
    const row = rowOf(el, "wo-paid");
    expect(row.textContent).toContain("#11");
    expect(row.textContent).toContain("Ana");
    expect(row.textContent).toContain(formatMoney("18.00", currentLocale()));
  });

  it("a paid order not yet handed over says so and offers Hand over only", async () => {
    const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
      orders: [paid],
    });
    const row = rowOf(el, "wo-paid");
    expect(row.querySelector("[data-waiting-state]")!.textContent).toBe(
      t("waiting.paid_not_handed_over"),
    );
    expect(buttons(row)).toEqual([t("waiting.hand_over")]);
  });

  it("a sent, unpaid order says so and offers Pay first, then Hand over", async () => {
    const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
      orders: [sent],
    });
    const row = rowOf(el, "wo-sent");
    expect(row.querySelector("[data-waiting-state]")!.textContent).toBe(t("waiting.sent_not_paid"));
    expect(buttons(row)).toEqual([t("action.pay"), t("waiting.hand_over")]);
    expect(row.querySelector("wt-button[data-waiting-pay]")!.getAttribute("variant")).toBe(
      "primary",
    );
    expect(row.querySelector("wt-button[data-waiting-hand-over]")!.getAttribute("variant")).toBe(
      "secondary",
    );
  });

  it("a sent order that cannot be handed over yet offers Pay alone", async () => {
    const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
      orders: [{ ...sent, canHandOver: false }],
    });
    expect(buttons(rowOf(el, "wo-sent"))).toEqual([t("action.pay")]);
  });

  it("an order handed over and not paid says so and offers Pay only", async () => {
    const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
      orders: [handedOver],
    });
    const row = rowOf(el, "wo-handed");
    expect(row.querySelector("[data-waiting-state]")!.textContent).toBe(
      t("waiting.handed_over_not_paid"),
    );
    expect(buttons(row)).toEqual([t("action.pay")]);
  });

  it("names each button with the order it acts on", async () => {
    const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
      orders: [paid, sent],
    });
    expect(rowOf(el, "wo-paid").querySelector("wt-button[data-waiting-hand-over]")!.ariaLabel).toBe(
      `${t("waiting.hand_over")} #11 Ana`,
    );
    expect(rowOf(el, "wo-sent").querySelector("wt-button[data-waiting-pay]")!.ariaLabel).toBe(
      `${t("action.pay")} #12`,
    );
  });

  it("Hand over and Pay ask the app, naming the order and, for Pay, its mode, past the widget's shadow root", async () => {
    const { el, host } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
      orders: [sent],
    });
    const seen: [string, unknown][] = [];
    for (const type of ["hand-over-order", "pay-waiting-order"])
      host.addEventListener(type, (event) => seen.push([type, (event as CustomEvent).detail]));
    const row = rowOf(el, "wo-sent");
    row.querySelector<HTMLElement>("wt-button[data-waiting-hand-over]")!.click();
    row.querySelector<HTMLElement>("wt-button[data-waiting-pay]")!.click();
    expect(seen).toEqual([
      ["hand-over-order", { id: "wo-sent" }],
      ["pay-waiting-order", { id: "wo-sent", serviceMode: "ticket_then_pay" }],
    ]);
  });

  describe("Move to station", () => {
    const movable: CounterWaitingOrder = {
      ...paid,
      movableDishes: [{ lineId: "line-1", stationId: "grill" }],
    };
    const moveButton = (el: TillCounterWaiting, id: string) =>
      rowOf(el, id).querySelector<HTMLElement>("wt-button[data-waiting-move-station]");

    it("a paid order with a dish that can move offers it after Hand over, as a secondary action naming the order", async () => {
      const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
        orders: [movable],
        canMoveStation: true,
      });
      const row = rowOf(el, "wo-paid");

      expect(buttons(row)).toEqual([t("waiting.hand_over"), t("table.move_station")]);
      const action = moveButton(el, "wo-paid")!;
      expect(action.getAttribute("variant")).toBe("secondary");
      expect(action.ariaLabel).toBe(`${t("table.move_station")} #11 Ana`);
    });

    it("is not offered on a paid order with nothing left to move", async () => {
      const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
        orders: [paid],
        canMoveStation: true,
      });

      expect(moveButton(el, "wo-paid")).toBeNull();
    });

    it("is not offered on an order sent and not paid, even one listing dishes", async () => {
      const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
        orders: [{ ...sent, movableDishes: movable.movableDishes }],
        canMoveStation: true,
      });

      expect(moveButton(el, "wo-sent")).toBeNull();
    });

    it("is not offered when the device may not take orders", async () => {
      const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
        orders: [movable],
      });

      expect(moveButton(el, "wo-paid")).toBeNull();
      expect(buttons(rowOf(el, "wo-paid"))).toEqual([t("waiting.hand_over")]);
    });

    it("asks the app, naming the order, in an event that bubbles and crosses shadow roots", async () => {
      const { el, host } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
        orders: [movable],
        canMoveStation: true,
      });
      const seen: unknown[] = [];
      host.addEventListener("move-waiting-order", (event) =>
        seen.push({
          detail: (event as CustomEvent).detail,
          bubbles: event.bubbles,
          composed: event.composed,
        }),
      );

      moveButton(el, "wo-paid")!.click();

      expect(seen).toEqual([{ detail: { id: "wo-paid" }, bubbles: true, composed: true }]);
    });
  });

  describe("Cancel and credit", () => {
    const invoiced: CounterWaitingOrder = { ...sent, invoiceNumber: "A/12" };

    it("an order sent with its invoice issued and not paid offers it last, as a secondary action naming the order", async () => {
      const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
        orders: [invoiced],
      });
      const row = rowOf(el, "wo-sent");

      expect(buttons(row)).toEqual([
        t("action.pay"),
        t("waiting.hand_over"),
        t("cancel_credit.action"),
      ]);
      const action = row.querySelector<HTMLElement>("wt-button[data-waiting-cancel-credit]")!;
      expect(action.getAttribute("variant")).toBe("secondary");
      expect(action.ariaLabel).toBe(`${t("cancel_credit.action")} #12`);
    });

    it("is offered on an invoiced order already handed over", async () => {
      const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
        orders: [{ ...handedOver, invoiceNumber: "A/13" }],
      });

      expect(buttons(rowOf(el, "wo-handed"))).toEqual([t("action.pay"), t("cancel_credit.action")]);
    });

    it("is not offered on an order whose invoice is not issued yet, nor on a paid one", async () => {
      const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
        orders: [sent, { ...paid, invoiceNumber: "A/11" }],
      });

      for (const id of ["wo-sent", "wo-paid"])
        expect(rowOf(el, id).querySelector("[data-waiting-cancel-credit]")).toBeNull();
    });

    it("asks the app, naming the order, past the widget's shadow root", async () => {
      const { el, host } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
        orders: [invoiced],
      });
      const seen: unknown[] = [];
      host.addEventListener("cancel-credit-waiting-order", (event) =>
        seen.push((event as CustomEvent).detail),
      );

      rowOf(el, "wo-sent")
        .querySelector<HTMLElement>("wt-button[data-waiting-cancel-credit]")!
        .click();

      expect(seen).toEqual([{ id: "wo-sent" }]);
    });
  });
});

describe("whole-order kitchen note from Waiting", () => {
  it.each([paid, sent])(
    "lets staff edit the note of a $status order before handover",
    async (order) => {
      const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
        orders: [order],
        canEditKitchenNote: true,
      });
      const action = rowOf(el, order.id).querySelector<HTMLElement>("[data-waiting-kitchen-note]");
      expect(action).not.toBeNull();
      const details: unknown[] = [];
      el.addEventListener("edit-waiting-kitchen-note", (event) =>
        details.push((event as CustomEvent).detail),
      );
      action!.click();
      expect(details).toEqual([{ id: order.id }]);
    },
  );

  it("offers no note action without ordering access or after handover", async () => {
    const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
      orders: [paid, handedOver],
    });
    expect(el.shadowRoot!.querySelector("[data-waiting-kitchen-note]")).toBeNull();
    el.canEditKitchenNote = true;
    await el.updateComplete;
    expect(rowOf(el, paid.id).querySelector("[data-waiting-kitchen-note]")).not.toBeNull();
    expect(rowOf(el, handedOver.id).querySelector("[data-waiting-kitchen-note]")).toBeNull();
  });
});

describe("A738 order item previews", () => {
  const items = [
    {
      lineId: "dish-1",
      name: "Staff soup (Large)",
      quantity: "0.375",
      note: "No salt <please>",
      extras: [{ lineId: "extra-1", name: "Staff cheese", quantity: "0.75" }],
    },
    { lineId: "dish-2", name: "Staff water", quantity: "2", note: null, extras: [] },
  ];
  it("A738 toggles an order preview without retrieving it", async () => {
    const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
      orders: [{ ...sent, items }],
    });
    const events: unknown[] = [];
    el.addEventListener("retrieve-order", (event) => events.push(event));
    const summary = () => el.shadowRoot!.querySelector<HTMLButtonElement>("button.summary")!;
    expect(summary()).not.toBeNull();
    expect(summary().getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(summary());
    await el.updateComplete;
    expect(summary().getAttribute("aria-expanded")).toBe("true");
    const preview = el.shadowRoot!.querySelector<HTMLElement>(".order-preview")!;
    expect(preview.hidden).toBe(false);
    expect(preview.querySelectorAll("[data-preview-dish]")).toHaveLength(2);
    expect(preview.textContent).toContain("Staff soup (Large)");
    expect(preview.textContent).toContain("0.375");
    expect(preview.querySelector("[data-preview-extra]")!.textContent).toContain("0.75");
    expect(preview.querySelector("[data-preview-extra]")!.textContent).toContain("Staff cheese");
    expect(preview.textContent).toContain("No salt <please>");
    expect(preview.querySelector("please")).toBeNull();
    expect(preview.id).toBe(summary().getAttribute("aria-controls"));
    await userEvent.click(summary());
    await el.updateComplete;
    expect(summary().getAttribute("aria-expanded")).toBe("false");
    summary().focus();
    await userEvent.keyboard("{Enter}");
    await el.updateComplete;
    expect(summary().getAttribute("aria-expanded")).toBe("true");
    await userEvent.keyboard(" ");
    await el.updateComplete;
    expect(summary().getAttribute("aria-expanded")).toBe("false");
    expect(events).toEqual([]);
  });

  it("A738 follows order identity through reordering and refresh and prunes vanished expansions", async () => {
    const first = { ...sent, items };
    const second = { ...sent, id: "other-order", orderNumber: 99, items: [] };
    const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
      orders: [first, second],
    });
    await userEvent.click(el.shadowRoot!.querySelector<HTMLButtonElement>("button.summary")!);
    await el.updateComplete;
    el.orders = [
      second,
      { ...first, items: [{ ...items[0]!, name: "Refreshed stored name", note: "New note" }] },
    ];
    await el.updateComplete;
    const summaries = el.shadowRoot!.querySelectorAll("button.summary");
    expect([...summaries].map((button) => button.getAttribute("aria-expanded"))).toEqual([
      "false",
      "true",
    ]);
    const previews = el.shadowRoot!.querySelectorAll<HTMLElement>(".order-preview");
    expect(previews[1]!.textContent).toContain("Refreshed stored name");
    expect(previews[1]!.textContent).toContain("New note");
    expect(previews[1]!.textContent).not.toContain("Staff water");
    el.orders = [second];
    await el.updateComplete;
    el.orders = [first, second];
    await el.updateComplete;
    expect(
      [...el.shadowRoot!.querySelectorAll("button.summary")].map((button) =>
        button.getAttribute("aria-expanded"),
      ),
    ).toEqual(["false", "false"]);
  });
  it.each([false, true])(
    "A738 row action pay-waiting-order does not toggle its preview (expanded %s)",
    async (expanded) => {
      const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
        orders: [
          {
            ...sent,
            items,
            invoiceNumber: "A/12",
            movableDishes: [{ lineId: "dish-1", stationId: "grill" }],
          },
        ],
        canMoveStation: true,
        canEditKitchenNote: true,
      });
      const summary = el.shadowRoot!.querySelector<HTMLButtonElement>("button.summary")!;
      expect(summary).not.toBeNull();
      if (expanded) {
        await userEvent.click(summary);
        await el.updateComplete;
      }
      const calls: unknown[] = [];
      el.addEventListener("pay-waiting-order", (event) =>
        calls.push((event as CustomEvent).detail),
      );
      await userEvent.click(
        el.shadowRoot!.querySelector("[data-waiting-pay]")!.shadowRoot!.querySelector("button")!,
      );
      await el.updateComplete;
      expect(calls).toEqual([{ id: sent.id, serviceMode: sent.serviceMode }]);
      expect(summary.getAttribute("aria-expanded")).toBe(String(expanded));
    },
  );
  it.each([false, true])(
    "A738 row action hand-over-order does not toggle its preview (expanded %s)",
    async (expanded) => {
      const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
        orders: [
          {
            ...sent,
            items,
            invoiceNumber: "A/12",
            movableDishes: [{ lineId: "dish-1", stationId: "grill" }],
          },
        ],
        canMoveStation: true,
        canEditKitchenNote: true,
      });
      const summary = el.shadowRoot!.querySelector<HTMLButtonElement>("button.summary")!;
      expect(summary).not.toBeNull();
      if (expanded) {
        await userEvent.click(summary);
        await el.updateComplete;
      }
      const calls: unknown[] = [];
      el.addEventListener("hand-over-order", (event) => calls.push((event as CustomEvent).detail));
      await userEvent.click(
        el
          .shadowRoot!.querySelector("[data-waiting-hand-over]")!
          .shadowRoot!.querySelector("button")!,
      );
      await el.updateComplete;
      expect(calls).toEqual([{ id: sent.id }]);
      expect(summary.getAttribute("aria-expanded")).toBe(String(expanded));
    },
  );
  it.each([false, true])(
    "A738 row action edit-waiting-kitchen-note does not toggle its preview (expanded %s)",
    async (expanded) => {
      const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
        orders: [
          {
            ...sent,
            items,
            invoiceNumber: "A/12",
            movableDishes: [{ lineId: "dish-1", stationId: "grill" }],
          },
        ],
        canMoveStation: true,
        canEditKitchenNote: true,
      });
      const summary = el.shadowRoot!.querySelector<HTMLButtonElement>("button.summary")!;
      expect(summary).not.toBeNull();
      if (expanded) {
        await userEvent.click(summary);
        await el.updateComplete;
      }
      const calls: unknown[] = [];
      el.addEventListener("edit-waiting-kitchen-note", (event) =>
        calls.push((event as CustomEvent).detail),
      );
      await userEvent.click(
        el
          .shadowRoot!.querySelector("[data-waiting-kitchen-note]")!
          .shadowRoot!.querySelector("button")!,
      );
      await el.updateComplete;
      expect(calls).toEqual([{ id: sent.id }]);
      expect(summary.getAttribute("aria-expanded")).toBe(String(expanded));
    },
  );
  it.each([false, true])(
    "A738 row action cancel-credit-waiting-order does not toggle its preview (expanded %s)",
    async (expanded) => {
      const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
        orders: [
          {
            ...sent,
            items,
            invoiceNumber: "A/12",
            movableDishes: [{ lineId: "dish-1", stationId: "grill" }],
          },
        ],
        canMoveStation: true,
        canEditKitchenNote: true,
      });
      const summary = el.shadowRoot!.querySelector<HTMLButtonElement>("button.summary")!;
      expect(summary).not.toBeNull();
      if (expanded) {
        await userEvent.click(summary);
        await el.updateComplete;
      }
      const calls: unknown[] = [];
      el.addEventListener("cancel-credit-waiting-order", (event) =>
        calls.push((event as CustomEvent).detail),
      );
      await userEvent.click(
        el
          .shadowRoot!.querySelector("[data-waiting-cancel-credit]")!
          .shadowRoot!.querySelector("button")!,
      );
      await el.updateComplete;
      expect(calls).toEqual([{ id: sent.id }]);
      expect(summary.getAttribute("aria-expanded")).toBe(String(expanded));
    },
  );
  it.each([false, true])(
    "A738 row action move-waiting-order does not toggle its preview (expanded %s)",
    async (expanded) => {
      const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
        orders: [
          {
            ...paid,
            items,
            invoiceNumber: "A/12",
            movableDishes: [{ lineId: "dish-1", stationId: "grill" }],
          },
        ],
        canMoveStation: true,
        canEditKitchenNote: true,
      });
      const summary = el.shadowRoot!.querySelector<HTMLButtonElement>("button.summary")!;
      expect(summary).not.toBeNull();
      if (expanded) {
        await userEvent.click(summary);
        await el.updateComplete;
      }
      const calls: unknown[] = [];
      el.addEventListener("move-waiting-order", (event) =>
        calls.push((event as CustomEvent).detail),
      );
      await userEvent.click(
        el
          .shadowRoot!.querySelector("[data-waiting-move-station]")!
          .shadowRoot!.querySelector("button")!,
      );
      await el.updateComplete;
      expect(calls).toEqual([{ id: paid.id }]);
      expect(summary.getAttribute("aria-expanded")).toBe(String(expanded));
    },
  );
});
