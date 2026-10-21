import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { userEvent } from "vitest/browser";
import { openSentDish, openSentMore } from "./till-table-order-screen.sent.test-helpers.js";
import { DraftStore } from "../state/draft-sync.js";
import { setLocale } from "../i18n/t.js";
import type { Station, TabLine } from "../api/client.js";
import {
  beer,
  mount,
  openDraftLine,
  resized,
  store,
} from "./till-table-order-screen.test-helpers.js";
import { current, row } from "./till-table-order-screen.current-orders.test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

it("A738 omits the obsolete draft station selector from the line window", async () => {
  const el = await draft([bar, kitchen], "bar");
  expect(el.shadowRoot!.querySelector("[data-make-at]")).toBeNull();
  expect(store(el).lines[0]!.makeAt).toBe("bar");
});

const bar: Station = {
  id: "bar",
  name: "Upstairs bar",
  isDefault: false,
  active: true,
  open: false,
  byHand: null,
  sendsTo: null,
  why: "closed_by_hand" as const,
};
const kitchen: Station = {
  id: "kitchen",
  name: "Kitchen",
  isDefault: true,
  active: true,
  open: true,
  byHand: null,
  sendsTo: null,
  why: "default" as const,
};

async function draft(stations: Station[], makeAt?: string) {
  const { el } = await mount({ stations });
  el.parentElement!.style.width = "1280px";
  await resized(el);
  store(el).loadFrom(store(el).id, [
    { product: beer, quantity: "1", ...(makeAt === undefined ? {} : { makeAt }) },
  ]);
  await el.updateComplete;
  if (stations.length > 1) await openDraftLine(el, 0);
  return el;
}

it("A738 keeps recorded draft routing when the station list changes", async () => {
  const el = await draft([bar, kitchen], "kitchen");
  expect(el.shadowRoot!.querySelector("[data-make-at]")).toBeNull();
  expect(store(el).lines[0]!.makeAt).toBe("kitchen");
  el.stations = [bar];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-make-at]")).toBeNull();
  expect(store(el).lines[0]!.makeAt).toBe("kitchen");
});

it("A738 keeps an absent station's recorded id without drawing a fallback selector", async () => {
  const el = await draft([bar, kitchen], "removed");
  expect(el.shadowRoot!.querySelector("[data-make-at]")).toBeNull();
  expect(store(el).lines[0]!.makeAt).toBe("removed");
});

const sent: TabLine = {
  id: "line-1",
  stationId: "bar",
  movable: true,
  name: "Beer",
  groupId: null,
  lineNo: 1,
  productId: "beer",
  quantity: "1.000",
  unitPriceGross: "3.00",
  servedAt: null,
  courseId: null,
  sentAt: "2026-09-28T19:50:00.000Z",
  firedAt: "2026-09-28T19:50:00.000Z",
  state: "queued",
  note: null,
  listId: null,
  menuItemId: null,
  parentProductId: null,
};

it("offers a movable Sent dish once and dispatches its bill, line and station", async () => {
  const { el } = await mount({
    lines: [sent],
    currentOrders: current({
      groups: [],
      ungrouped: [
        row("line-1", "Beer", "1.000", {
          kitchen: {
            stationId: "bar",
            movable: true,
            state: "queued",
            firedAt: sent.firedAt,
          },
        }),
      ],
    }),
  });
  const events: unknown[] = [];
  el.addEventListener("move-station", (event) => events.push((event as CustomEvent).detail));
  await openSentDish(el, "line-1");
  await openSentMore(el);
  expect(el.shadowRoot!.querySelectorAll("[data-sent-line-station]")).toHaveLength(1);
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-sent-line-station]")!);
  expect(events).toEqual([
    { workingOrderId: "wo-4", lineId: "line-1", name: "Beer", stationId: "bar" },
  ]);
  el.lines = [{ ...sent, movable: false, state: "preparing" }];
  await el.updateComplete;
  await openSentDish(el, "line-1");
  expect(el.shadowRoot!.querySelector("[data-sent-line-station]")).toBeNull();
});

it("offers the sent-read dish with empty editable bill lines", async () => {
  const onBill = row("line-paid", "Beer", "1.000", {
    kitchen: {
      stationId: "bar",
      movable: true,
      state: "queued",
      firedAt: sent.firedAt,
    },
  });
  const { el } = await mount({
    lines: [],
    currentOrders: current({ groups: [], ungrouped: [onBill] }),
  });
  const events: unknown[] = [];
  el.addEventListener("move-station", (event) => events.push((event as CustomEvent).detail));
  await openSentDish(el, "line-paid");
  const button = el.shadowRoot!.querySelector<HTMLElement>("[data-sent-line-station]")!;
  expect(button).not.toBeNull();
  await openSentMore(el);
  await userEvent.click(button);
  expect(events).toEqual([
    { workingOrderId: "wo-4", lineId: "line-paid", name: "Beer", stationId: "bar" },
  ]);
});

it("does not offer a station move for a Sent row without a kitchen record", async () => {
  const { el } = await mount({
    lines: [],
    currentOrders: current({
      groups: [],
      ungrouped: [row("made-here", "Beer", "1.000", { kitchen: null })],
    }),
  });
  await openSentDish(el, "made-here");
  expect(el.shadowRoot!.querySelector("[data-sent-line-station]")).toBeNull();
});

it.each(["light", "dark"] as const)(
  "keeps the Make at field accessible in %s theme",
  async (theme) => {
    const el = await draft([bar, kitchen]);
    el.parentElement!.setAttribute("data-theme", theme);
    await expectNoA11yViolations(el.parentElement!);
  },
);

it("moves a presented bill's queued dish through Sent with no editable line copy", async () => {
  const draftStore = new DraftStore();
  draftStore.billStatus = "placed";
  const { el } = await mount({
    draftStore,
    lines: [],
    currentOrders: current({
      groups: [],
      ungrouped: [
        row("presented-dish", "Beer", "1.000", {
          billStatus: "placed",
          kitchen: {
            stationId: "bar",
            movable: true,
            state: "queued",
            firedAt: sent.firedAt,
          },
        }),
      ],
    }),
  });
  const events: unknown[] = [];
  el.addEventListener("move-station", (event) => events.push((event as CustomEvent).detail));
  await openSentDish(el, "presented-dish");
  const button = el.shadowRoot!.querySelector<HTMLElement>("[data-sent-line-station]");
  expect(button).not.toBeNull();
  await openSentMore(el);
  await userEvent.click(button!);
  expect(events).toEqual([
    { workingOrderId: "wo-4", lineId: "presented-dish", name: "Beer", stationId: "bar" },
  ]);
});

it.each([
  "owner",
  "loading",
  "sending",
  "paid-row",
  "paid-bill",
  "abandoned-row",
  "abandoned-bill",
  "preparing",
  "unmovable",
  "different-line-number",
  "extra-line-copy",
] as const)(
  "a station move without an editable copy refuses newer %s facts before rendering",
  async (change) => {
    const draftStore = new DraftStore();
    const dish = row("fallback", "Beer", "1.000", {
      kitchen: {
        stationId: "bar",
        movable: true,
        state: "queued",
        firedAt: sent.firedAt,
      },
    });
    const { el } = await mount({
      draftStore,
      lines: [],
      currentOrders: current({ groups: [], ungrouped: [dish] }),
    });
    const events: unknown[] = [];
    el.addEventListener("move-station", (event) => events.push((event as CustomEvent).detail));
    await openSentDish(el, "fallback");
    await openSentMore(el);
    const move = el.shadowRoot!.querySelector<HTMLElement>("[data-sent-line-station]")!;
    expect(move).not.toBeNull();
    if (change === "owner") draftStore.ownershipLocked = true;
    if (change === "loading") draftStore.lockEdits();
    if (change === "sending") draftStore.sending = true;
    if (change === "paid-row" || change === "abandoned-row") {
      el.currentOrders = current({
        groups: [],
        ungrouped: [{ ...dish, billStatus: change === "paid-row" ? "settled" : "abandoned" }],
      });
    }
    if (change === "paid-bill" || change === "abandoned-bill") {
      el.bills = [
        {
          workingOrderId: "wo-4",
          revision: 1,
          invoiceType: "F2",
          recipient: null,
          partyId: "v1",
          label: null,
          status: change === "paid-bill" ? "settled" : "abandoned",
          total: "2.00",
          outstanding: "0.00",
          hasPayments: change === "paid-bill",
          receiptAvailable: change === "paid-bill",
        },
      ];
    }
    if (change === "preparing" || change === "unmovable") {
      el.currentOrders = current({
        groups: [],
        ungrouped: [
          {
            ...dish,
            kitchen: {
              ...dish.kitchen!,
              ...(change === "preparing" ? { state: "preparing" } : { movable: false }),
            },
          },
        ],
      });
    }
    if (change === "different-line-number") el.lines = [{ ...sent, id: "fallback", lineNo: 2 }];
    if (change === "extra-line-copy") el.lines = [{ ...sent, id: "fallback", parentLineNo: 99 }];
    move.click();
    await el.updateComplete;
    expect(events).toEqual([]);
  },
);
