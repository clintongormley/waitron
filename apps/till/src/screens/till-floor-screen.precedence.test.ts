import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./till-floor-screen.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import type { TableParty, TableState, TableToday } from "../api/client.js";
import type { TableSignal } from "@waitron/shared";

const now = Date.parse("2026-09-30T20:00:00.000Z");
const past = new Date(now - 60_000).toISOString();
const ahead = new Date(now + 10 * 60_000).toISOString();

function party(over: Partial<TableParty> = {}): TableParty {
  return {
    kitchenNote: {
      scope: { partyId: over.id ?? "v2" },
      note: null,
      revision: 0,
      ownerRevision: over.revision ?? 3,
    },
    id: "v2",
    revision: 3,
    guestCount: 2,
    state: "open",
    name: null,
    displayName: "Table 2",
    mainBillId: "wo-2",
    outstanding: "20.00",
    billCount: 1,
    tableIds: ["t2"],
    unsentDrafts: [],
    reminder: null,
    ...over,
  };
}

function today(over: Partial<TableToday> = {}): TableToday {
  return {
    placement: { x: 2, y: 3, width: 2, height: 2, shape: "round", rotation: 0 },
    seats: 4,
    fixed: false,
    takenOff: false,
    joinId: null,
    joinSeats: null,
    inJoinedTable: null,
    joined: null,
    splitOffFrom: null,
    zoneRevision: 0,
    ...over,
  };
}

function table(over: Partial<TableState> = {}): TableState {
  return {
    id: "t2",
    label: "Table 2",
    zoneId: "z1",
    state: "open-tab",
    condition: "held",
    hasOpenTab: true,
    tabLineCount: 2,
    tabTotal: "20.00",
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: null,
    party: party(),
    signals: [],
    ...over,
  };
}

const longWait = (band: "warm" | "overdue" | "forgotten"): TableSignal => ({
  kind: "long_wait",
  band,
});
const due = party({ reminder: { groupId: "g2", dueAt: past } });

async function mountFloor(
  tables: TableState[],
  over: Partial<TillFloorScreen> = {},
): Promise<{ el: TillFloorScreen; host: HTMLElement }> {
  return mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: [
      {
        id: "z1",
        name: "Dining room",
        displayOrder: 0,
        active: true,
        closesAt: null,
        closed: false,
        hasPlan: false,
        layoutSetName: null,
        layoutDue: null,
        serviceMode: "table_tab",
      },
    ],
    tables,
    now,
    ...over,
  });
}

const card = (el: TillFloorScreen, id = "t2") =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-table="${id}"]`)!;
const ringOf = (root: ParentNode) => root.querySelector<HTMLElement>("[data-ring]");
const pulses = (ring: Element) => [...ring.classList].filter((c) => c.startsWith("wt-pulse-"));

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

describe("till-floor-screen: the card's ring", () => {
  it("rings an overdue card in red, pulsing slowly at the slow token", async () => {
    const { el, host } = await mountFloor([table({ timingBand: "overdue" })], {
      reducedMotion: false,
    });
    host.style.setProperty("--wt-duration-pulse-slow", "5000ms");
    const ring = card(el).querySelector<HTMLElement>('[data-ring="overdue"]')!;
    expect(pulses(ring)).toEqual(["wt-pulse-slow"]);
    expect(getComputedStyle(ring).animationDuration).toBe("5s");
    expect(card(el).dataset.top).toBe("overdue");
    const box = card(el).getBoundingClientRect();
    const outline = ring.getBoundingClientRect();
    expect(outline.width).toBeGreaterThan(0);
    expect(outline.left).toBeGreaterThanOrEqual(box.left);
    expect(outline.top).toBeGreaterThanOrEqual(box.top);
    expect(outline.right).toBeLessThanOrEqual(box.right);
    expect(outline.bottom).toBeLessThanOrEqual(box.bottom);
  });

  it("rings a forgotten card fast, keeps its badge, and dims the ring to the token half-way", async () => {
    const { el, host } = await mountFloor([table({ timingBand: "forgotten" })], {
      reducedMotion: false,
    });
    host.style.setProperty("--wt-opacity-pulse-dim", "0.4");
    host.style.setProperty("--wt-duration-pulse-fast", "2000ms");
    const ring = card(el).querySelector<HTMLElement>('[data-ring="forgotten"]')!;
    expect(pulses(ring)).toEqual(["wt-pulse-fast"]);
    expect(card(el).querySelector("[data-forgotten]")).not.toBeNull();
    const [animation] = ring.getAnimations();
    animation!.pause();
    animation!.currentTime = 1000;
    expect(getComputedStyle(ring).opacity).toBe("0.4");
  });

  it("rings a card whose reminder is due in amber, pulsing slowly", async () => {
    const { el, host } = await mountFloor([table({ party: due })], { reducedMotion: false });
    host.style.setProperty("--wt-color-warning", "rgb(4, 5, 6)");
    const ring = card(el).querySelector<HTMLElement>('[data-ring="fire"]')!;
    expect(pulses(ring)).toEqual(["wt-pulse-slow"]);
    expect(getComputedStyle(ring).boxShadow).toContain("rgb(4, 5, 6)");
  });

  it("rings a waiting card in steady amber, not blue", async () => {
    const { el, host } = await mountFloor([table({ signals: [longWait("warm")] })], {
      reducedMotion: false,
    });
    host.style.setProperty("--wt-color-warning", "rgb(4, 5, 6)");
    host.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
    const ring = card(el).querySelector<HTMLElement>('[data-ring="waiting"]')!;
    expect(pulses(ring)).toEqual([]);
    const shadow = getComputedStyle(ring).boxShadow;
    expect(shadow).toContain("rgb(4, 5, 6)");
    expect(shadow).not.toContain("rgb(1, 2, 3)");
  });

  it("draws only the most urgent state's ring", async () => {
    const { el } = await mountFloor(
      [
        table({ timingBand: "forgotten", party: due }),
        table({
          id: "t3",
          label: "Table 3",
          party: party({ id: "v3", tableIds: ["t3"] }),
          signals: [{ kind: "bill_requested", requestedAt: past }, longWait("warm")],
        }),
      ],
      { reducedMotion: false },
    );
    const rings = card(el).querySelectorAll<HTMLElement>("[data-ring]");
    expect(rings).toHaveLength(1);
    expect(rings[0]!.dataset.ring).toBe("forgotten");
    expect(pulses(rings[0]!)).toEqual(["wt-pulse-fast"]);
    expect(ringOf(card(el, "t3"))).toBeNull();
    expect(card(el, "t3").dataset.top).toBe("bill");
  });

  it("outlines a card from its wait chip when the floored band has not caught up", async () => {
    const { el } = await mountFloor(
      [
        table({ timingBand: "fresh", signals: [longWait("overdue")] }),
        table({
          id: "t3",
          label: "Table 3",
          party: party({ id: "v3", tableIds: ["t3"] }),
          timingBand: "fresh",
          signals: [longWait("forgotten")],
        }),
      ],
      { reducedMotion: false },
    );
    expect(card(el).querySelector('[data-ring="overdue"]')).not.toBeNull();
    expect(card(el, "t3").querySelector("[data-forgotten]")).not.toBeNull();
    expect(card(el, "t3").querySelector('[data-chip="long-wait"]')).toBeNull();
  });

  it("moves nothing under reduced motion: a forgotten card's left edge turns wide and red", async () => {
    const { el, host } = await mountFloor(
      [
        table({ timingBand: "forgotten" }),
        table({
          id: "t3",
          label: "Table 3",
          party: party({ id: "v3", tableIds: ["t3"] }),
          timingBand: "overdue",
        }),
        table({
          id: "t4",
          label: "Table 4",
          party: party({ id: "v4", tableIds: ["t4"], reminder: { groupId: "g4", dueAt: past } }),
        }),
      ],
      { reducedMotion: true },
    );
    host.style.setProperty("--wt-color-danger", "rgb(1, 2, 3)");
    host.style.setProperty("--wt-space-3", "9px");
    const forgotten = card(el).querySelector<HTMLElement>('[data-ring="forgotten"]')!;
    expect(pulses(forgotten)).toEqual([]);
    expect(card(el).classList.contains("edge-forgotten")).toBe(true);
    const style = getComputedStyle(card(el));
    expect(style.borderLeftColor).toBe("rgb(1, 2, 3)");
    expect(style.borderLeftWidth).toBe("9px");
    expect(card(el).querySelector("[data-forgotten]")).not.toBeNull();
    const overdue = card(el, "t3").querySelector<HTMLElement>('[data-ring="overdue"]')!;
    const fire = card(el, "t4").querySelector<HTMLElement>('[data-ring="fire"]')!;
    expect(pulses(overdue)).toEqual([]);
    expect(pulses(fire)).toEqual([]);
    expect(card(el, "t3").classList.contains("edge-forgotten")).toBe(false);
  });

  it("hands its reduced motion to the unplaced token", async () => {
    const tables = [
      table({ id: "t1", label: "Table 1", party: null, state: "free", today: today() }),
      table({ timingBand: "forgotten", today: today({ placement: null }) }),
    ];
    const tokenRing = (el: TillFloorScreen) => {
      const token = el.shadowRoot!.querySelector<HTMLElement>(
        "[data-tray-table=t2] wt-table-token",
      )!;
      return token.shadowRoot!.querySelector<HTMLElement>('[data-ring="forgotten"]')!;
    };
    const still = await mountFloor(tables, { reducedMotion: true });
    await (
      still.el.shadowRoot!.querySelector("wt-table-token") as HTMLElement & {
        updateComplete: Promise<unknown>;
      }
    ).updateComplete;
    expect(pulses(tokenRing(still.el))).toEqual([]);
    cleanupWidgets();
    const moving = await mountFloor(tables, { reducedMotion: false });
    await (
      moving.el.shadowRoot!.querySelector("wt-table-token") as HTMLElement & {
        updateComplete: Promise<unknown>;
      }
    ).updateComplete;
    expect(pulses(tokenRing(moving.el))).toEqual(["wt-pulse-fast"]);
  });

  it("outlines an unplaced token from its wait chip when the floored band has not caught up", async () => {
    const tables = [
      table({ id: "t1", label: "Table 1", party: null, state: "free", today: today() }),
      table({
        timingBand: "fresh",
        signals: [longWait("overdue")],
        today: today({ placement: null }),
      }),
    ];
    const { el } = await mountFloor(tables, { reducedMotion: false });
    const token = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "[data-tray-table=t2] wt-table-token",
    )!;
    await token.updateComplete;
    const ring = token.shadowRoot!.querySelector<HTMLElement>('[data-ring="overdue"]')!;
    expect(ring).not.toBeNull();
    expect(pulses(ring)).toEqual(["wt-pulse-slow"]);
  });
});

describe("till-floor-screen: the card's marks in the order of precedence", () => {
  const marks = (el: TillFloorScreen, id = "t2") =>
    [...card(el, id).querySelector(".badges")!.children].map((mark) => {
      const chip = mark.getAttribute("data-chip");
      if (chip !== null) return `[data-chip="${chip}"]`;
      return `[${mark.getAttributeNames().find((name) => name.startsWith("data-"))}]`;
    });
  const draft = { billId: "bill-1", billNumber: 1, ownerName: "Alex", lineCount: 2 };

  it("lists every mark, most urgent first, and draws nothing after Reserved", async () => {
    const { el } = await mountFloor([
      table({
        timingBand: "forgotten",
        readyToServe: 2,
        pendingToServe: 3,
        nextReservation: { time: "21:30" },
        party: party({ reminder: { groupId: "g2", dueAt: past }, unsentDrafts: [draft] }),
        signals: [
          { kind: "take_order" },
          { kind: "ready", byStation: [{ stationId: "bar", stationName: "Bar", count: 2 }] },
          { kind: "bill_requested", requestedAt: past },
          { kind: "release_due", groupId: "g2", dueAt: past },
          { kind: "held_unavailable", groupId: "g3", lineNames: ["Steak"] },
          longWait("forgotten"),
        ],
      }),
    ]);
    expect(marks(el)).toEqual([
      "[data-forgotten]",
      '[data-chip="held-unavailable"]',
      "[data-fire-due]",
      '[data-chip="bill-requested"]',
      '[data-chip="ready"]',
      '[data-chip="take-order"]',
      "[data-unsent]",
      "[data-reserved]",
    ]);
  });

  it("puts N to serve after the held chip", async () => {
    const { el } = await mountFloor([
      table({
        pendingToServe: 2,
        party: party({ reminder: { groupId: "g2", dueAt: ahead } }),
        signals: [{ kind: "held", count: 2 }],
      }),
    ]);
    expect(marks(el)).toEqual(['[data-chip="held"]', "[data-to-serve]"]);
  });

  it("puts the overdue chip before the bill and the waiting chip after the unsent order", async () => {
    const { el } = await mountFloor([
      table({
        signals: [{ kind: "bill_requested", requestedAt: past }, longWait("overdue")],
      }),
      table({
        id: "t3",
        label: "Table 3",
        party: party({ id: "v3", tableIds: ["t3"], unsentDrafts: [draft] }),
        signals: [longWait("warm")],
      }),
    ]);
    expect(marks(el)).toEqual(['[data-chip="long-wait"]', '[data-chip="bill-requested"]']);
    expect(marks(el, "t3")).toEqual(["[data-unsent]", '[data-chip="long-wait"]']);
  });

  it("keeps two unsent orders in their own order, inside the card at 390 px", async () => {
    await page.viewport(390, 900);
    try {
      const { el } = await mountFloor([
        table({
          signals: [{ kind: "bill_requested", requestedAt: past }],
          party: party({
            unsentDrafts: [
              { ...draft, ownerName: "AlexandradelRosariodelasMercedesFernandezFernandez" },
              { billId: "bill-2", billNumber: 2, ownerName: "Alex", lineCount: 1 },
            ],
          }),
        }),
      ]);
      expect(marks(el)).toEqual(['[data-chip="bill-requested"]', "[data-unsent]", "[data-unsent]"]);
      const unsent = [...card(el).querySelectorAll<HTMLElement>("[data-unsent]")];
      expect(unsent.map((mark) => mark.textContent!.replace(/\s+/g, " ").trim())).toEqual([
        "Bill 1 · AlexandradelRosariodelasMercedesFernandezFernandez has an unsent order: 2 items",
        "Bill 2 · Alex has an unsent order: 1 item",
      ]);
      const box = card(el).getBoundingClientRect();
      for (const mark of unsent) {
        const range = document.createRange();
        range.selectNodeContents(mark);
        const bounds = range.getBoundingClientRect();
        expect(bounds.left).toBeGreaterThanOrEqual(box.left);
        expect(bounds.right).toBeLessThanOrEqual(box.right);
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    } finally {
      await page.viewport(1280, 900);
    }
  });
});
