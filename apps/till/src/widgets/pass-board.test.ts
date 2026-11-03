import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget, resetPage } from "./test-helpers.js";
import { CARD_COLUMN_TEXT_WIDTHS, OVERVIEW_COLUMN_REMS } from "../state/kitchen-board-fit.js";
import { type ColumnKey, PASS_COLUMNS } from "../state/kitchen-columns.js";
import { overviewRows, rowsToMake } from "../state/kitchen-overview.js";
import { passOverviewDishes } from "../state/pass-view.js";
import type { OverviewFact, PassBoard } from "../api/client.js";
import {
  PASS_NOW,
  minutesAgo,
  passBoard,
  passCard,
  passItem,
} from "../../test/pass-board-fixtures.js";
import type { TillPassBoard } from "./pass-board.js";
import "./pass-board.js";

beforeEach(async () => {
  await page.viewport(1280, 900);
});
afterEach(resetPage);
afterEach(cleanupWidgets);

async function mountBoard(props: Partial<TillPassBoard> & { board: PassBoard }) {
  const { el } = await mountWidget<TillPassBoard>("till-pass-board", {
    mode: "pass",
    runsPass: true,
    columns: PASS_COLUMNS,
    now: PASS_NOW,
    sending: new Set<string>(),
    reducedMotion: false,
    ...props,
  });
  return el;
}

const root = (el: TillPassBoard) => el.shadowRoot!;
const cardOf = (el: TillPassBoard, key: string) =>
  root(el).querySelector<HTMLElement>(`[data-card="${key}"]`)!;
const itemOf = (el: TillPassBoard, id: string) =>
  root(el).querySelector<HTMLElement>(`[data-item="${id}"]`)!;
const fireOf = (el: TillPassBoard, key: string) =>
  cardOf(el, key).querySelector<HTMLButtonElement>("[data-pass-fire]");

function eventsOf(el: TillPassBoard, name: string): unknown[] {
  const seen: unknown[] = [];
  el.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
  return seen;
}

const toFireCard = passCard({
  key: "group:p1:g1",
  target: { kind: "group", partyId: "p1", groupId: "g1" },
  kind: "new_order",
  requestedAt: minutesAgo(7),
  orders: [{ orderId: "order-1", orderNumber: 12, tableLabel: "T4", kitchenNote: null }],
  group: { displayNumber: 2, position: 1 },
  items: [passItem({ id: "req-1", phase: "requested", firedAt: null, requestedAt: minutesAgo(7) })],
  releaseTicketItemIds: ["req-1"],
  releaseContext: "ctx-1",
});

const blockedCard = passCard({
  key: "bill:order-2",
  target: { kind: "bill", workingOrderId: "order-2" },
  kind: "next_course",
  orders: [{ orderId: "order-2", orderNumber: 13, tableLabel: "T5", kitchenNote: null }],
  items: [
    passItem({
      id: "blocked-1",
      orderId: "order-2",
      phase: "requested",
      stationName: "Fryer",
      stationClosed: true,
    }),
  ],
  releaseTicketItemIds: [],
  releaseContext: "ctx-2",
});

const extraCard = passCard({
  key: "bill:order-3",
  target: { kind: "bill", workingOrderId: "order-3" },
  kind: "added",
  orders: [{ orderId: "order-3", orderNumber: 14, tableLabel: "T6", kitchenNote: null }],
  items: [
    passItem({
      id: "extra-1",
      orderId: "order-3",
      phase: "requested",
      stationName: "Bar",
      stationClosed: true,
      extra: true,
    }),
  ],
  releaseTicketItemIds: ["extra-1"],
  releaseContext: "ctx-3",
});

const groupInProgress = passCard({
  key: "group:p2:g2",
  target: { kind: "group", partyId: "p2", groupId: "g2" },
  party: { id: "p2", revision: 4 },
  group: { displayNumber: 3, position: 1 },
  orders: [{ orderId: "order-4", orderNumber: 15, tableLabel: "T7", kitchenNote: null }],
  items: [passItem({ id: "g-1", orderId: "order-4" })],
});

const billInProgress = passCard({
  key: "bill:order-5",
  target: { kind: "bill", workingOrderId: "order-5" },
  orders: [{ orderId: "order-5", orderNumber: 16, tableLabel: "T8", kitchenNote: null }],
  items: [passItem({ id: "b-1", orderId: "order-5" })],
});

const heldCard = passCard({
  key: "bill:order-6",
  target: { kind: "bill", workingOrderId: "order-6" },
  kind: "held",
  requestedAt: null,
  orders: [{ orderId: "order-6", orderNumber: 17, tableLabel: "T9", kitchenNote: null }],
  items: [passItem({ id: "held-1", orderId: "order-6", phase: "held", firedAt: null })],
});

const twoBillCard = passCard({
  key: "group:p3:g3",
  target: { kind: "group", partyId: "p3", groupId: "g3" },
  party: { id: "p3", revision: 2 },
  group: { displayNumber: 4, position: 1 },
  orders: [
    { orderId: "order-21", orderNumber: 21, tableLabel: "T11", kitchenNote: null },
    { orderId: "order-22", orderNumber: 22, tableLabel: "T11", kitchenNote: null },
  ],
  items: [
    passItem({ id: "two-1", orderId: "order-21" }),
    passItem({ id: "two-2", orderId: "order-22" }),
  ],
});

const readyCard = passCard({
  key: "bill:order-7",
  target: { kind: "bill", workingOrderId: "order-7" },
  readyAt: minutesAgo(3),
  allReady: true,
  orders: [{ orderId: "order-7", orderNumber: 18, tableLabel: "T10", kitchenNote: null }],
  items: [passItem({ id: "ready-1", orderId: "order-7", phase: "ready", state: "ready" })],
});

/** Columns drawn side by side share a top edge and run left to right; the narrow list stacks them. */
function expectSideBySide(sections: readonly HTMLElement[]): void {
  expect(sections.length).toBeGreaterThan(1);
  const rects = sections.map((section) => section.getBoundingClientRect());
  for (let i = 1; i < rects.length; i++) {
    expect(rects[i]!.top).toBe(rects[0]!.top);
    expect(rects[i]!.left).toBeGreaterThanOrEqual(rects[i - 1]!.right);
  }
}

describe("A773 pass board widget", () => {
  it("draws one column per shown key in the chosen order, headed by its word and card count", async () => {
    expect(window.innerWidth).toBe(1280);
    const el = await mountBoard({
      board: passBoard({
        held: [heldCard],
        toFire: [toFireCard],
        inProgress: [groupInProgress, billInProgress],
        ready: [readyCard],
      }),
    });
    const columns = [...root(el).querySelectorAll<HTMLElement>("[data-column]")];
    expect(columns.map((column) => column.dataset.column)).toEqual([
      "held",
      "toFire",
      "inProgress",
      "ready",
    ]);
    expectSideBySide(columns);
    const words = {
      held: "pass.column.held",
      toFire: "pass.column.to_fire",
      inProgress: "pass.column.in_progress",
      ready: "pass.column.ready",
    } as const;
    const counts = { held: 1, toFire: 1, inProgress: 2, ready: 1 };
    for (const column of columns) {
      const key = column.dataset.column as keyof typeof words;
      expect(column.querySelector(".column-heading")!.textContent).toContain(t(words[key]));
      expect(column.querySelector("[data-column-count]")!.textContent!.trim()).toBe(
        String(counts[key]),
      );
      expect(column.querySelectorAll("[data-card]")).toHaveLength(counts[key]);
    }
    expect(root(el).querySelector('[data-column="overview"]')).toBeNull();
  });

  it("draws a To fire card's kind, table, group, minutes and captions, and Fire emits its key once", async () => {
    const el = await mountBoard({ board: passBoard({ toFire: [toFireCard] }) });
    const card = cardOf(el, toFireCard.key);
    const text = card.textContent!.replace(/\s+/g, " ");
    expect(text).toContain(t("pass.kind.new_order"));
    expect(text).toContain("T4");
    expect(text).toContain(t("table.group_n").replace("{n}", "2"));
    expect(text).toContain(`7 ${t("station.min")}`);
    expect(itemOf(el, "req-1").textContent).toContain(t("pass.waiting_for_pass"));
    expect(itemOf(el, "req-1").textContent).toContain("Grill");

    const fire = fireOf(el, toFireCard.key)!;
    expect(fire.tagName).toBe("BUTTON");
    expect(fire.disabled).toBe(false);
    expect(fire.textContent!.trim()).toBe(t("pass.fire"));
    expect(fire.classList.contains("lever")).toBe(false);
    expect(fire.hasAttribute("data-fire")).toBe(false);
    expect(fire.hasAttribute("data-group-fire")).toBe(false);

    const fired = eventsOf(el, "pass-fire");
    await userEvent.click(fire);
    expect(fired).toEqual([{ key: toFireCard.key }]);
  });

  it("turns Fire off beside a blocked dish's closed sentence, and leaves it on for an extra", async () => {
    const el = await mountBoard({ board: passBoard({ toFire: [blockedCard, extraCard] }) });
    expect(fireOf(el, blockedCard.key)!.disabled).toBe(true);
    expect(itemOf(el, "blocked-1").textContent).toContain(
      t("pass.station_closed_dish").replaceAll("{station}", "Fryer"),
    );
    expect(fireOf(el, extraCard.key)!.disabled).toBe(false);
    expect(itemOf(el, "extra-1").textContent).toContain(
      t("pass.station_closed_extra").replaceAll("{station}", "Bar"),
    );
  });

  it("turns a card's Fire off while its Fire is out", async () => {
    const el = await mountBoard({
      board: passBoard({ toFire: [toFireCard, extraCard] }),
      sending: new Set([toFireCard.key]),
    });
    expect(fireOf(el, toFireCard.key)!.disabled).toBe(true);
    expect(fireOf(el, extraCard.key)!.disabled).toBe(false);
  });

  it("marks a dimmed dish and still says why in words", async () => {
    const card = passCard({
      items: [
        passItem({ id: "dim-1", informational: true, stationName: "Bar" }),
        passItem({
          id: "dim-2",
          informational: true,
          phase: "requested",
          stationName: "Oven",
        }),
        passItem({ id: "own-1" }),
      ],
    });
    const el = await mountBoard({ board: passBoard({ inProgress: [card] }) });
    const dim = itemOf(el, "dim-1");
    expect(dim.hasAttribute("data-dimmed")).toBe(true);
    expect(dim.textContent).toContain(t("station.state.queued"));
    expect(dim.textContent).toContain(t("pass.already_at").replace("{station}", "Bar"));
    const other = itemOf(el, "dim-2");
    expect(other.hasAttribute("data-dimmed")).toBe(true);
    expect(other.textContent).toContain(t("pass.other_pass").replace("{station}", "Oven"));
    expect(itemOf(el, "own-1").hasAttribute("data-dimmed")).toBe(false);
  });

  it("draws no Fire, Ready or Reprint on a monitor", async () => {
    const board = passBoard({
      toFire: [toFireCard],
      inProgress: [groupInProgress, billInProgress],
    });
    const levers = "[data-pass-fire], [data-group-ready], [data-ready], [data-reprint]";
    const pass = await mountBoard({ board, showReprint: true });
    expect(root(pass).querySelectorAll(levers).length).toBeGreaterThan(0);
    cleanupWidgets();
    const monitor = await mountBoard({ board, mode: "monitor", showReprint: true });
    expect(root(monitor).querySelectorAll(levers)).toHaveLength(0);
  });

  it("emits a group's Ready and a bill's course Ready from In progress cards", async () => {
    const el = await mountBoard({
      board: passBoard({ inProgress: [groupInProgress, billInProgress] }),
    });
    const groupReady = eventsOf(el, "pass-group-ready");
    const courseReady = eventsOf(el, "pass-course-ready");
    const group = cardOf(el, groupInProgress.key).querySelector<HTMLElement>(
      '[data-group-ready="g2"]',
    )!;
    expect(group.textContent!.trim()).toBe(t("expo.group_ready"));
    await userEvent.click(group);
    expect(groupReady).toEqual([{ key: groupInProgress.key }]);
    await userEvent.click(
      cardOf(el, billInProgress.key).querySelector<HTMLElement>('[data-ready="course-mains"]')!,
    );
    expect(courseReady).toEqual([
      { key: billInProgress.key, orderId: "order-5", courseId: "course-mains" },
    ]);
  });

  it("names its course on each course Ready of a bill card, in what is drawn and what is read out", async () => {
    const starters = { id: "course-starters", name: "Starters", displayOrder: 1 };
    const bill = passCard({
      ...billInProgress,
      items: [
        passItem({ id: "s-1", orderId: "order-5", course: starters }),
        passItem({ id: "m-1", orderId: "order-5" }),
      ],
    });
    const el = await mountBoard({ board: passBoard({ inProgress: [bill] }) });
    const levers = [...cardOf(el, bill.key).querySelectorAll<HTMLButtonElement>("[data-ready]")];
    expect(levers.map((lever) => lever.getAttribute("data-ready"))).toEqual([
      "course-starters",
      "course-mains",
    ]);
    expect(levers.map((lever) => lever.textContent!.trim())).toEqual([
      `${t("expo.ready")} Starters`,
      `${t("expo.ready")} Mains`,
    ]);
    for (const lever of levers) {
      const label = lever.getAttribute("aria-label");
      expect(label === null || label === lever.textContent!.trim()).toBe(true);
    }
  });

  it("draws a card Hide emptied with its heading, age and levers, and no dish line (D83)", async () => {
    const emptied = passCard({ ...groupInProgress, requestedAt: minutesAgo(9), items: [] });
    const el = await mountBoard({ board: passBoard({ inProgress: [emptied] }), showReprint: true });
    const card = cardOf(el, emptied.key);
    expect(card.querySelector(".number")!.textContent).toContain("15");
    expect(card.querySelector(".label")!.textContent).toBe("T7");
    expect(card.querySelector(".age")!.textContent).toBe(`9 ${t("station.min")}`);
    expect(card.querySelector('[data-group-ready="g2"]')).not.toBeNull();
    expect(card.querySelector('[data-reprint="order-4"]')).not.toBeNull();
    expect(card.querySelectorAll("[data-item]")).toHaveLength(0);
  });

  it("draws no line for a dish Hide hid, yet keeps its lateness, the overdue count and its course Ready (D73)", async () => {
    const hidden = passCard({
      ...billInProgress,
      requestedAt: minutesAgo(50),
      items: [],
      hiddenItems: [
        passItem({
          id: "cold-late",
          orderId: "order-5",
          stationName: "Cold",
          stationId: "st-cold",
          state: "preparing",
          phase: "preparing",
          queuedAt: minutesAgo(50),
          informational: true,
          passControlled: false,
        }),
      ],
    });
    const el = await mountBoard({ board: passBoard({ inProgress: [hidden] }) });
    const card = cardOf(el, hidden.key);
    expect(card.querySelectorAll("[data-item]")).toHaveLength(0);
    expect(card.classList.contains("age-forgotten")).toBe(true);
    expect(root(el).querySelector("[data-overdue-count]")!.textContent!.trim()).toBe(
      `1 ${t("station.overdue_count")}`,
    );
    expect(card.querySelector('[data-ready="course-mains"]')!.textContent!.trim()).toBe(
      `${t("expo.ready")} Mains`,
    );
  });

  it("draws a held card dashed, untimed and without buttons, its dishes held", async () => {
    const el = await mountBoard({ board: passBoard({ held: [heldCard] }), showReprint: true });
    const card = cardOf(el, heldCard.key);
    expect(getComputedStyle(card).borderTopStyle).toBe("dashed");
    expect(card.querySelector(".age")).toBeNull();
    expect(card.querySelectorAll("button, wt-button")).toHaveLength(0);
    expect(itemOf(el, "held-1").classList.contains("held")).toBe(true);
    expect(getComputedStyle(itemOf(el, "held-1")).borderTopStyle).toBe("dashed");
  });

  it("draws the owner's column order and leaves the columns they hid out", async () => {
    const el = await mountBoard({
      board: passBoard({
        held: [heldCard],
        toFire: [toFireCard],
        inProgress: [billInProgress],
        ready: [readyCard],
      }),
      columns: {
        order: ["ready", "toFire", "held", "inProgress", "overview"],
        hidden: ["held", "overview"],
        collapsed: [],
      },
    });
    const columns = [...root(el).querySelectorAll<HTMLElement>("[data-column]")];
    expect(columns.map((column) => column.dataset.column)).toEqual([
      "ready",
      "toFire",
      "inProgress",
    ]);
    expect(cardOf(el, heldCard.key)).toBeNull();
  });

  it("names each bill on a two-bill card's Reprint, and each emits its own bill", async () => {
    const el = await mountBoard({
      board: passBoard({ inProgress: [twoBillCard, billInProgress] }),
      showReprint: true,
    });
    const reprints = [
      ...cardOf(el, twoBillCard.key).querySelectorAll<HTMLElement>("[data-reprint]"),
    ];
    expect(reprints.map((button) => button.textContent!.trim())).toEqual([
      `${t("expo.reprint")} #21`,
      `${t("expo.reprint")} #22`,
    ]);
    const one = cardOf(el, billInProgress.key).querySelector<HTMLElement>("[data-reprint]")!;
    expect(one.textContent!.trim()).toBe(t("expo.reprint"));
    expect(one.hasAttribute("aria-label")).toBe(false);

    const captured: CustomEvent[] = [];
    el.addEventListener("pass-reprint", (event) => captured.push(event as CustomEvent));
    for (const reprint of reprints) await userEvent.click(reprint);
    expect(captured.map((event) => event.detail)).toEqual([
      { orderId: "order-21" },
      { orderId: "order-22" },
    ]);
    expect(captured.every((event) => event.bubbles && event.composed)).toBe(true);
  });

  it("draws no Reprint when the screen does not ask for it", async () => {
    const el = await mountBoard({ board: passBoard({ inProgress: [billInProgress] }) });
    expect(el.showReprint).toBe(false);
    expect(root(el).querySelector("[data-reprint]")).toBeNull();
    expect(root(el).querySelector("[data-ready]")).not.toBeNull();
  });

  it("dispatches Fire and both Readys composed and bubbling", async () => {
    const el = await mountBoard({
      board: passBoard({ toFire: [toFireCard], inProgress: [groupInProgress, billInProgress] }),
    });
    const captured: CustomEvent[] = [];
    for (const name of ["pass-fire", "pass-group-ready", "pass-course-ready"])
      el.addEventListener(name, (event) => captured.push(event as CustomEvent));
    await userEvent.click(fireOf(el, toFireCard.key)!);
    await userEvent.click(root(el).querySelector<HTMLElement>('[data-group-ready="g2"]')!);
    await userEvent.click(root(el).querySelector<HTMLElement>('[data-ready="course-mains"]')!);
    expect(captured.map((event) => [event.type, event.bubbles, event.composed])).toEqual([
      ["pass-fire", true, true],
      ["pass-group-ready", true, true],
      ["pass-course-ready", true, true],
    ]);
  });

  it("gives each Fire a name that says which bills it fires", async () => {
    const twoBillToFire = passCard({
      ...twoBillCard,
      key: "group:p3:g3-fire",
      kind: "new_order",
      items: [
        passItem({ id: "fire-21", orderId: "order-21", phase: "requested", firedAt: null }),
        passItem({ id: "fire-22", orderId: "order-22", phase: "requested", firedAt: null }),
      ],
      releaseTicketItemIds: ["fire-21", "fire-22"],
      releaseContext: "ctx-21",
    });
    const el = await mountBoard({ board: passBoard({ toFire: [toFireCard, twoBillToFire] }) });
    expect(fireOf(el, toFireCard.key)!.getAttribute("aria-label")).toBe(`${t("pass.fire")} #12`);
    expect(fireOf(el, twoBillToFire.key)!.getAttribute("aria-label")).toBe(
      `${t("pass.fire")} #21 · #22`,
    );
  });

  it("dates a Ready card by when it was ready, in whole minutes passed", async () => {
    const halfPast = passCard({ ...readyCard, key: "bill:order-8", readyAt: minutesAgo(3.5) });
    const el = await mountBoard({ board: passBoard({ ready: [halfPast] }) });
    expect(cardOf(el, halfPast.key).querySelector(".age")!.textContent!.trim()).toBe(
      t("table.row_ready_ago").replace("{n}", "3"),
    );
  });

  it("draws a dimmed dish in a dotted box and its own dish in a solid one", async () => {
    const card = passCard({
      items: [passItem({ id: "dim-1", informational: true }), passItem({ id: "own-1" })],
    });
    const el = await mountBoard({ board: passBoard({ inProgress: [card] }) });
    expect(getComputedStyle(itemOf(el, "dim-1")).borderTopStyle).toBe("dotted");
    expect(getComputedStyle(itemOf(el, "own-1")).borderTopStyle).toBe("solid");
  });

  describe("in Spanish", () => {
    let previous: string;
    beforeEach(() => {
      previous = currentLocale();
      setLocale("es-ES");
    });
    afterEach(() => setLocale(previous));

    it("reads the column headings and kind words from the Spanish catalogue", async () => {
      const el = await mountBoard({
        board: passBoard({ held: [heldCard], toFire: [toFireCard], inProgress: [billInProgress] }),
      });
      const heading = (key: string) =>
        root(el).querySelector(`[data-column="${key}"] .column-heading`)!.textContent;
      expect(heading("held")).toContain(t("pass.column.held", "es-ES"));
      expect(heading("toFire")).toContain(t("pass.column.to_fire", "es-ES"));
      expect(heading("inProgress")).toContain(t("pass.column.in_progress", "es-ES"));
      expect(cardOf(el, toFireCard.key).textContent).toContain(t("pass.kind.new_order", "es-ES"));
      expect(cardOf(el, billInProgress.key).textContent).toContain(
        t("pass.kind.new_order", "es-ES"),
      );
      expect(t("pass.column.to_fire", "es-ES")).not.toBe(t("pass.column.to_fire", "en"));
    });

    it("rewords a card's kind on the next draw after the language changes, the board unchanged", async () => {
      setLocale("en");
      const el = await mountBoard({ board: passBoard({ toFire: [toFireCard] }) });
      expect(cardOf(el, toFireCard.key).querySelector(".kind")!.textContent).toBe(
        t("pass.kind.new_order", "en"),
      );
      setLocale("es-ES");
      el.requestUpdate();
      await el.updateComplete;
      expect(cardOf(el, toFireCard.key).querySelector(".kind")!.textContent).toBe(
        t("pass.kind.new_order", "es-ES"),
      );
      expect(t("pass.kind.new_order", "es-ES")).not.toBe(t("pass.kind.new_order", "en"));
    });
  });

  it("colours a card by its dishes' age on the board's clock, flashes forgotten, and counts overdue cards", async () => {
    const aged = (key: string, minutes: number, overrides = {}) =>
      passCard({
        key,
        items: [
          passItem({
            id: `${key}-item`,
            queuedAt: minutesAgo(minutes),
            band: "fresh",
            ...overrides,
          }),
        ],
      });
    const warm = aged("warm", 7);
    const forgotten = aged("forgotten", 20);
    const dimmedLate = aged("dimmed-late", 12, { informational: true });
    const board = passBoard({ inProgress: [warm, forgotten, dimmedLate] });
    const el = await mountBoard({ board });
    expect(cardOf(el, "warm").classList.contains("age-warm")).toBe(true);
    expect(cardOf(el, "forgotten").classList.contains("age-forgotten")).toBe(true);
    expect(cardOf(el, "forgotten").classList.contains("flash")).toBe(true);
    expect(cardOf(el, "dimmed-late").classList.contains("age-overdue")).toBe(true);
    expect(root(el).querySelector("[data-overdue-count]")!.textContent!.trim()).toBe(
      `2 ${t("station.overdue_count")}`,
    );

    cleanupWidgets();
    const still = await mountBoard({ board, reducedMotion: true });
    expect(cardOf(still, "forgotten").classList.contains("age-forgotten")).toBe(true);
    expect(cardOf(still, "forgotten").classList.contains("flash")).toBe(false);
  });

  it("keeps a ready dish's lateness: its Forgotten mark, its card's colour and the overdue count", async () => {
    const ready = passCard({
      key: "ready",
      readyAt: minutesAgo(1),
      allReady: true,
      items: [
        passItem({
          id: "ready-item",
          phase: "ready",
          state: "ready",
          readyAt: minutesAgo(1),
          queuedAt: minutesAgo(20),
          band: "fresh",
        }),
      ],
    });
    const el = await mountBoard({ board: passBoard({ ready: [ready] }) });
    expect(itemOf(el, "ready-item").querySelector("[data-forgotten]")).not.toBeNull();
    expect(cardOf(el, "ready").classList.contains("age-forgotten")).toBe(true);
    expect(root(el).querySelector("[data-overdue-count]")!.textContent!.trim()).toBe(
      `1 ${t("station.overdue_count")}`,
    );
  });

  const overviewFacts: OverviewFact[] = [
    {
      lineId: "o-1",
      stationId: "st-grill",
      name: "Paella",
      qty: "2",
      phase: "waiting",
      informational: false,
    },
    {
      lineId: "o-2",
      stationId: "st-grill",
      name: "Paella",
      qty: "1",
      phase: "held",
      informational: false,
    },
    {
      lineId: "o-3",
      stationId: "st-grill",
      name: "Croquetas",
      qty: "3",
      phase: "requested",
      informational: false,
    },
    {
      lineId: "o-4",
      stationId: "st-grill",
      name: "Tortilla",
      qty: "1",
      phase: "preparing",
      informational: false,
    },
    {
      lineId: "o-5",
      stationId: "st-grill",
      name: "Agua",
      qty: "1",
      phase: "ready",
      informational: false,
    },
    {
      lineId: "o-6",
      stationId: "st-bar",
      name: "Vino",
      qty: "1",
      phase: "waiting",
      informational: true,
    },
  ];
  const allShown = { order: PASS_COLUMNS.order, hidden: [], collapsed: [] };

  it("draws Overview's rows from the pass's own dishes, the held after a +, when it is shown", async () => {
    const board = passBoard({ toFire: [toFireCard], overview: overviewFacts });
    const el = await mountBoard({ board, columns: allShown });
    const column = root(el).querySelector<HTMLElement>('[data-column="overview"]')!;
    expect(column).not.toBeNull();
    expect(column.querySelector(".column-heading")!.textContent).toContain(t("station.overview"));
    const rows = overviewRows(passOverviewDishes(board));
    expect(column.querySelector("[data-column-count]")!.textContent!.trim()).toBe(
      String(rowsToMake(rows)),
    );
    const drawn = [...column.querySelectorAll<HTMLElement>("[data-overview-row]")].map((row) => [
      row.querySelector(".overview-name")!.textContent,
      row.querySelector("[data-overview-making]")!.textContent,
      row.querySelector("[data-overview-held]")?.textContent ?? null,
    ]);
    expect(drawn).toEqual([
      ["Paella", "2", "+1"],
      ["Tortilla", "1", null],
      ["Croquetas", "0", "+3"],
    ]);
    expect(rows.map((row) => row.name)).toEqual(drawn.map(([name]) => name));
  });

  it("redraws Overview's rows from each new board", async () => {
    const el = await mountBoard({
      board: passBoard({ overview: overviewFacts }),
      columns: allShown,
    });
    el.board = passBoard({ overview: [{ ...overviewFacts[0]!, name: "Fideuà" }] });
    await el.updateComplete;
    const names = [...root(el).querySelectorAll("[data-overview-row] .overview-name")].map(
      (name) => name.textContent,
    );
    expect(names).toEqual(["Fideuà"]);
  });

  it("keeps a collapsed column's heading and count, draws none of its cards, and only asks to open it", async () => {
    const el = await mountBoard({
      board: passBoard({
        toFire: [toFireCard],
        inProgress: [billInProgress],
        overview: overviewFacts,
      }),
      columns: { order: PASS_COLUMNS.order, hidden: [], collapsed: ["toFire", "overview"] },
    });
    const column = (key: string) => root(el).querySelector<HTMLElement>(`[data-column="${key}"]`)!;
    expect(column("toFire").querySelector(".column-heading")!.textContent).toContain(
      t("pass.column.to_fire"),
    );
    expect(column("toFire").querySelector("[data-column-count]")!.textContent!.trim()).toBe("1");
    expect(column("toFire").querySelectorAll("[data-card]")).toHaveLength(0);
    expect(column("overview").querySelector("[data-overview]")).toBeNull();
    expect(column("inProgress").querySelectorAll("[data-card]")).toHaveLength(1);

    const toggle = column("toFire").querySelector<HTMLButtonElement>("[data-column-toggle]")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(
      column("inProgress").querySelector("[data-column-toggle]")!.getAttribute("aria-expanded"),
    ).toBe("true");
    const toggled = eventsOf(el, "toggle-column");
    await userEvent.click(toggle);
    await el.updateComplete;
    expect(toggled).toEqual([{ key: "toFire" }]);
    expect(column("toFire").querySelectorAll("[data-card]")).toHaveLength(0);
  });

  it("draws one list of sections on a narrow screen, in the owner's order, with the same cards", async () => {
    const board = passBoard({
      held: [heldCard],
      toFire: [toFireCard],
      inProgress: [billInProgress],
      ready: [readyCard],
      overview: overviewFacts,
    });
    const columns = {
      order: ["ready", "toFire", "overview", "inProgress", "held"] as ColumnKey[],
      hidden: ["held"] as ColumnKey[],
      collapsed: [],
    };
    const wide = await mountBoard({ board, columns });
    expectSideBySide([...root(wide).querySelectorAll<HTMLElement>("[data-column]")]);
    const wideCards = [...root(wide).querySelectorAll<HTMLElement>("[data-card]")].map(
      (card) => card.dataset.card,
    );
    cleanupWidgets();

    await page.viewport(390, 844);
    expect(window.innerWidth).toBe(390);
    const el = await mountBoard({ board, columns });
    const sections = [...root(el).querySelectorAll<HTMLElement>("[data-column]")];
    expect(sections.map((section) => section.dataset.column)).toEqual([
      "ready",
      "toFire",
      "overview",
      "inProgress",
    ]);
    const rects = sections.map((section) => section.getBoundingClientRect());
    for (let i = 1; i < rects.length; i++) {
      expect(rects[i]!.left).toBe(rects[0]!.left);
      expect(rects[i]!.top).toBeGreaterThanOrEqual(rects[i - 1]!.bottom);
    }
    expect(
      [...root(el).querySelectorAll<HTMLElement>("[data-card]")].map((card) => card.dataset.card),
    ).toEqual(wideCards);

    const toggled = eventsOf(el, "toggle-column");
    await userEvent.click(sections[0]!.querySelector<HTMLElement>("[data-column-toggle]")!);
    expect(toggled).toEqual([{ key: "ready" }]);
  });

  it("keeps the header row and its Columns button when every column is hidden", async () => {
    const el = await mountBoard({
      board: passBoard({ toFire: [toFireCard] }),
      columns: { order: PASS_COLUMNS.order, hidden: [...PASS_COLUMNS.order], collapsed: [] },
    });
    expect(root(el).querySelectorAll("[data-column]")).toHaveLength(0);
    const head = root(el).querySelector("[data-board-head]")!;
    expect(head).not.toBeNull();
    const columnsButton = head.querySelector<HTMLElement>("[data-columns-open]")!;
    expect(columnsButton.textContent!.trim()).toBe(t("station.columns"));
    const opened = eventsOf(el, "open-columns");
    await userEvent.click(columnsButton);
    expect(opened).toEqual([{ opener: columnsButton }]);
  });

  const sectionsOf = (el: TillPassBoard) => [
    ...root(el).querySelectorAll<HTMLElement>("[data-column]"),
  ];
  const sectionOf = (el: TillPassBoard, key: string) =>
    root(el).querySelector<HTMLElement>(`[data-column="${key}"]`)!;
  const tokenPx = (el: TillPassBoard, token: string) =>
    parseFloat(getComputedStyle(el).getPropertyValue(token));
  const everyColumnBoard = passBoard({
    held: [heldCard],
    toFire: [toFireCard],
    inProgress: [billInProgress],
    ready: [readyCard],
    overview: overviewFacts,
  });

  it("keeps Overview within the width the fit check budgets for it, however long a dish's name", async () => {
    await page.viewport(1920, 900);
    const longName = "Arroz meloso de bogavante con alcachofas, ajos tiernos y su sofrito";
    const board = passBoard({
      ...everyColumnBoard,
      overview: [{ ...overviewFacts[0]!, name: longName }],
    });
    const el = await mountBoard({ board, columns: allShown });
    const sections = sectionsOf(el);
    expectSideBySide(sections);
    const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
    expect(sectionOf(el, "overview").getBoundingClientRect().width).toBeLessThanOrEqual(
      OVERVIEW_COLUMN_REMS * remPx + 0.5,
    );
    const cardWidths = sections
      .filter((section) => section.dataset.column !== "overview")
      .map((section) => section.getBoundingClientRect().width);
    for (const width of cardWidths) expect(width).toBeCloseTo(cardWidths[0]!, 0);
  });

  it("draws a collapsed column on a wide board as a strip one tap wide", async () => {
    const el = await mountBoard({
      board: everyColumnBoard,
      columns: { ...allShown, collapsed: ["toFire"] },
    });
    expectSideBySide(sectionsOf(el));
    expect(sectionOf(el, "toFire").getBoundingClientRect().width).toBe(tokenPx(el, "--wt-tap-min"));
  });

  it("counts a collapsed column as its strip when deciding whether the columns fit", async () => {
    await page.viewport(900, 900);
    const open = await mountBoard({ board: everyColumnBoard, columns: allShown });
    expect(root(open).querySelector(".list")).not.toBeNull();
    cleanupWidgets();

    const el = await mountBoard({
      board: everyColumnBoard,
      columns: { ...allShown, collapsed: ["held", "toFire", "ready"] },
    });
    expect(root(el).querySelector(".kanban")).not.toBeNull();
    expectSideBySide(sectionsOf(el));
  });

  it("draws a collapsed section in the narrow list as a full-width heading, not a strip", async () => {
    await page.viewport(390, 844);
    const el = await mountBoard({
      board: everyColumnBoard,
      columns: { ...allShown, collapsed: ["toFire"] },
    });
    const section = sectionOf(el, "toFire");
    const toggle = section.querySelector<HTMLElement>("[data-column-toggle]")!;
    expect(getComputedStyle(toggle).writingMode).toBe("horizontal-tb");
    expect(toggle.getBoundingClientRect().width).toBe(section.getBoundingClientRect().width);
  });

  it("keeps the narrow list's Overview as narrow as a card column on a till, and full width on a phone", async () => {
    await page.viewport(900, 900);
    const till = await mountBoard({ board: everyColumnBoard, columns: allShown });
    expect(root(till).querySelector(".list")).not.toBeNull();
    const tillOverview = sectionOf(till, "overview").querySelector<HTMLElement>("[data-overview]")!;
    expect(tillOverview.getBoundingClientRect().width).toBeLessThanOrEqual(
      CARD_COLUMN_TEXT_WIDTHS * tokenPx(till, "--wt-font-size-md") + 0.5,
    );
    cleanupWidgets();

    await page.viewport(390, 844);
    const phone = await mountBoard({ board: everyColumnBoard, columns: allShown });
    const section = sectionOf(phone, "overview");
    expect(section.querySelector("[data-overview]")!.getBoundingClientRect().width).toBe(
      section.getBoundingClientRect().width,
    );
  });

  it("turns to the narrow list when the screen narrows, also after it is moved", async () => {
    const el = await mountBoard({ board: everyColumnBoard, columns: allShown });
    expect(root(el).querySelector(".kanban")).not.toBeNull();
    await page.viewport(390, 844);
    await vi.waitFor(() => expect(root(el).querySelector(".list")).not.toBeNull());

    await page.viewport(1280, 900);
    await vi.waitFor(() => expect(root(el).querySelector(".kanban")).not.toBeNull());
    const parent = el.parentElement!;
    el.remove();
    parent.appendChild(el);
    await page.viewport(390, 844);
    await vi.waitFor(() => expect(root(el).querySelector(".list")).not.toBeNull());
  });

  it("puts the screen's lead in its header row before the overdue count and Columns, and its status under that row", async () => {
    const overdue = passCard({
      key: "late",
      items: [passItem({ id: "late-item", queuedAt: minutesAgo(12), band: "fresh" })],
    });
    const el = await mountBoard({ board: passBoard({ inProgress: [overdue] }) });
    const lead = document.createElement("h1");
    lead.slot = "lead";
    lead.textContent = "Pass";
    const status = document.createElement("p");
    status.slot = "status";
    status.textContent = "Not updated since 12:00";
    el.append(lead, status);
    await el.updateComplete;

    const head = root(el).querySelector<HTMLElement>("[data-board-head]")!;
    const leadSlot = head.querySelector<HTMLSlotElement>('slot[name="lead"]');
    expect(leadSlot?.assignedElements()).toEqual([lead]);
    const statusSlot = root(el).querySelector<HTMLSlotElement>('slot[name="status"]');
    expect(statusSlot?.assignedElements()).toEqual([status]);
    expect(head.contains(statusSlot)).toBe(false);

    const [leadBox, countBox, columnsBox] = [
      lead,
      head.querySelector("[data-overdue-count]")!,
      head.querySelector("[data-columns-open]")!,
    ].map((node) => node.getBoundingClientRect());
    for (const box of [countBox!, columnsBox!]) {
      expect(box.top).toBeLessThan(leadBox!.bottom);
      expect(box.bottom).toBeGreaterThan(leadBox!.top);
    }
    expect(leadBox!.right).toBeLessThanOrEqual(countBox!.left);
    expect(countBox!.right).toBeLessThanOrEqual(columnsBox!.left);
    const statusBox = status.getBoundingClientRect();
    expect(statusBox.top).toBeGreaterThanOrEqual(head.getBoundingClientRect().bottom);
    expect(statusBox.bottom).toBeLessThanOrEqual(sectionsOf(el)[0]!.getBoundingClientRect().top);
  });
});
