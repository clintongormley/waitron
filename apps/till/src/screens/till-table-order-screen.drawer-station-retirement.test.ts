import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import {
  current,
  currentGroup,
  orderGroup,
  row,
} from "./till-table-order-screen.current-orders.test-helpers.js";
import { storedDish } from "./till-table-order-screen.sent-fallback.test-helpers.js";
import { openSentDish, openSentMore } from "./till-table-order-screen.sent.test-helpers.js";
import { mount } from "./till-table-order-screen.test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

it.each(["editable", "service-only"] as const)(
  "%s station moves use Sent More without a duplicate drawer button",
  async (read) => {
    const firedAt = "2026-10-18T19:00:00.000Z";
    const line = {
      ...storedDish,
      groupId: "fired",
      stationId: "bar",
      movable: true,
      sentAt: firedAt,
      firedAt,
    };
    const { el } = await mount({
      orderId: "wo-4",
      lines: read === "editable" ? [line] : [],
      groups: [{ ...orderGroup("fired", 1, "fired"), lineIds: [line.id] }],
      currentOrders: current({
        groups: [
          currentGroup("fired", 1, "fired", [
            row(line.id, "Recorded dish", "2.000", {
              lineNo: 1,
              netAmount: "6.50",
              firedAt,
              kitchen: { stationId: "bar", movable: true, state: "queued", firedAt, awayAt: null },
            }),
          ]),
        ],
        ungrouped: [],
        reminder: null,
      }),
    });
    const moves: CustomEvent[] = [];
    el.addEventListener("move-station", (event) => moves.push(event as CustomEvent));
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-drawer] [data-move-station]")).toBeNull();
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!);
    await el.updateComplete;
    await openSentDish(el, line.id);
    await openSentMore(el);
    const action = el.shadowRoot!.querySelector<HTMLElement>("[data-sent-line-station]")!;
    expect(action.checkVisibility()).toBe(true);
    expect(moves).toEqual([]);
    await userEvent.click(action);
    expect(moves.map((event) => event.detail)).toEqual([
      { workingOrderId: "wo-4", lineId: line.id, name: "Recorded dish", stationId: "bar" },
    ]);
    expect(moves[0]!.bubbles && moves[0]!.composed).toBe(true);
  },
);
