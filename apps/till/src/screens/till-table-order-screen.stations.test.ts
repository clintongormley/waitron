import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { Station, TabLine } from "../api/client.js";
import { beer, mount, resized, store } from "./till-table-order-screen.test-helpers.js";
import { current, row } from "./till-table-order-screen.current-orders.test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

const bar: Station = {
  id: "bar",
  name: "Upstairs bar",
  displayOrder: 0,
  isDefault: false,
  active: true,
  open: false,
  byHand: null,
  sendsTo: null,
  why: "out_of_hours" as const,
};
const kitchen: Station = {
  id: "kitchen",
  name: "Kitchen",
  displayOrder: 1,
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
  return el;
}

it("offers each draft a station choice only when there is a choice, including closed stations", async () => {
  const el = await draft([bar, kitchen]);
  const field = el.shadowRoot!.querySelector<
    HTMLElement & { options: { value: string; label: string }[]; value: string }
  >("[data-make-at='0']")!;
  expect(field.tagName).toBe("WT-COMBOBOX");
  expect(field.getAttribute("name")).toBe("make-at");
  expect(field.getAttribute("label")).toBe("Make at · Beer");
  expect(field.options).toEqual([
    { value: "__make_at_rules__", label: "Where the rules send it" },
    { value: "bar", label: "Upstairs bar (closed)" },
    { value: "kitchen", label: "Kitchen" },
  ]);
  el.stations = [kitchen];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-make-at]")).toBeNull();
});

it("saves a chosen draft station and clears it for rules", async () => {
  const el = await draft([bar, kitchen], "kitchen");
  const field = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
    "[data-make-at='0']",
  )!;
  expect(field.value).toBe("kitchen");
  field.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "bar" } }));
  expect(store(el).lines[0]!.makeAt).toBe("bar");
  field.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "__make_at_rules__" } }));
  expect(store(el).lines[0]!.makeAt).toBeUndefined();
});

it("shows rules when the draft's saved station is no longer listed", async () => {
  const el = await draft([bar, kitchen], "removed");
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { value: string }>("[data-make-at='0']")!.value,
  ).toBe("__make_at_rules__");
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

it("offers a movable Pending dish once and dispatches its bill, line and station", async () => {
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
            awayAt: null,
          },
        }),
      ],
    }),
  });
  const events: unknown[] = [];
  el.addEventListener("move-station", (event) => events.push((event as CustomEvent).detail));
  el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelectorAll("[data-move-station='1']")).toHaveLength(1);
  el.shadowRoot!.querySelector<HTMLElement>("[data-move-station='1']")!.click();
  expect(events).toEqual([
    { workingOrderId: "wo-4", lineId: "line-1", name: "Beer", stationId: "bar" },
  ]);
  el.lines = [{ ...sent, movable: false, state: "preparing" }];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-move-station]")).toBeNull();
});

it("offers Current orders on a presented bill shown with empty lines", async () => {
  const onBill = row("line-paid", "Beer", "1.000", {
    kitchen: {
      stationId: "bar",
      movable: true,
      state: "queued",
      firedAt: sent.firedAt,
      awayAt: null,
    },
  });
  const { el } = await mount({
    lines: [],
    currentOrders: current({ groups: [], ungrouped: [onBill] }),
  });
  const events: unknown[] = [];
  el.addEventListener("move-station", (event) => events.push((event as CustomEvent).detail));
  el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
  await el.updateComplete;
  const button = el.shadowRoot!.querySelector<HTMLElement>("[data-move-station='1']")!;
  expect(button).not.toBeNull();
  button.click();
  expect(events).toEqual([
    { workingOrderId: "wo-4", lineId: "line-paid", name: "Beer", stationId: "bar" },
  ]);
});

it("does not offer a station move for a Current orders row without a kitchen record", async () => {
  const { el } = await mount({
    lines: [],
    currentOrders: current({
      groups: [],
      ungrouped: [row("made-here", "Beer", "1.000", { kitchen: null })],
    }),
  });
  el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-move-station]")).toBeNull();
});

it.each(["light", "dark"] as const)(
  "keeps the Make at field accessible in %s theme",
  async (theme) => {
    const el = await draft([bar, kitchen]);
    el.parentElement!.setAttribute("data-theme", theme);
    await expectNoA11yViolations(el.parentElement!);
  },
);
