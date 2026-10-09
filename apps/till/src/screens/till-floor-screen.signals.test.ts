import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./till-floor-screen.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import type { TableParty, TableState } from "../api/client.js";
import type { TableSignal } from "@waitron/shared";

const now = Date.parse("2026-09-30T20:00:00.000Z");
const past = new Date(now - 60_000).toISOString();

function party(over: Partial<TableParty> = {}): TableParty {
  return {
    id: "v2",
    revision: 3,
    guestCount: 2,
    state: "open",
    name: null,
    displayName: "Mesa 2",
    mainBillId: "wo-2",
    outstanding: "20.00",
    billCount: 1,
    tableIds: ["t2"],
    unsentDrafts: [],
    reminder: null,
    ...over,
  };
}

function table(over: Partial<TableState> = {}): TableState {
  return {
    id: "t2",
    label: "Mesa 2",
    zoneId: "z1",
    capacity: 4,
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
    status: null,
    nextReservation: null,
    posX: null,
    posY: null,
    shape: null,
    rotation: null,
    party: party(),
    signals: [],
    ...over,
  };
}

const ready = (...byStation: [string, string, number][]): TableSignal => ({
  kind: "ready",
  byStation: byStation.map(([stationId, stationName, count]) => ({
    stationId,
    stationName,
    count,
  })),
});

/** Mesa 2: bar drinks ready, its held group due to fire, and the bill asked for. */
const mesa2 = table({
  readyToServe: 1,
  party: party({ reminder: { groupId: "g2", dueAt: past } }),
  signals: [
    ready(["bar", "Bar", 3]),
    { kind: "release_due", groupId: "g2", dueAt: past },
    { kind: "bill_requested", requestedAt: past },
  ],
});

async function mountFloor(
  tables: TableState[],
  over: Partial<TillFloorScreen> = {},
): Promise<TillFloorScreen> {
  const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: [
      { id: "z1", name: "Comedor", displayOrder: 0, active: true, closesAt: null, closed: false },
    ],
    tables,
    now,
    ...over,
  });
  return el;
}

const card = (el: TillFloorScreen, id: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-table="${id}"]`)!;
const words = (nodes: Iterable<Element>) =>
  [...nodes].map((node) => node.textContent!.replace(/\s+/g, " ").trim());
const chips = (root: ParentNode) => words(root.querySelectorAll("[data-chip]"));

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

describe("till-floor-screen: the signals at a table", () => {
  it("shows ready drinks, time to fire and the bill request side by side on the card", async () => {
    const el = await mountFloor([mesa2]);
    const badges = card(el, "t2").querySelector(".badges")!;
    expect(chips(badges)).toEqual(["Bar: 3 ready", "Bill requested"]);
    expect(badges.querySelector("[data-fire-due]")!.textContent!.trim()).toBe("Time to fire");
  });

  it("shows the same chips on the table's token on the map", async () => {
    const onMap = { ...mesa2, posX: 300, posY: 300, shape: "round" as const, rotation: 0 };
    const el = await mountFloor([onMap]);
    const canvas = el.shadowRoot!.querySelector("wt-floor-canvas")!;
    await canvas.updateComplete;
    const token = canvas.shadowRoot!.querySelector<
      HTMLElement & { updateComplete: Promise<unknown> }
    >('[data-table="t2"] wt-table-token')!;
    await token.updateComplete;
    expect(chips(token.shadowRoot!)).toEqual(["Bar: 3 ready", "Bill requested"]);
    expect(token.shadowRoot!.querySelector("[data-fire-due]")!.textContent!.trim()).toBe(
      "Time to fire",
    );
  });

  it("shows the same chips on an unplaced table's token in the map's tray", async () => {
    const placed = table({ id: "t9", label: "9", party: null, posX: 300, posY: 300 });
    const el = await mountFloor([placed, mesa2]);
    const token = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      '[data-tray-table="t2"] wt-table-token',
    )!;
    await token.updateComplete;
    expect(chips(token.shadowRoot!)).toEqual(["Bar: 3 ready", "Bill requested"]);
  });

  it("names every station with dishes ready, each with its own count", async () => {
    const el = await mountFloor([
      table({ signals: [ready(["bar", "Bar", 1], ["kitchen", "Kitchen", 2])] }),
    ]);
    expect(chips(card(el, "t2"))).toEqual(["Bar: 1 ready", "Kitchen: 2 ready"]);
  });

  it("says take the order for a party with nothing ordered or drafted", async () => {
    const el = await mountFloor([table({ signals: [{ kind: "take_order" }] })]);
    expect(chips(card(el, "t2"))).toEqual(["Take order"]);
  });

  it("names the dishes of a held group that can no longer be sold, one chip per group", async () => {
    const el = await mountFloor([
      table({
        signals: [
          { kind: "held_unavailable", groupId: "g2", lineNames: ["Steak", "Chips"] },
          { kind: "held_unavailable", groupId: "g3", lineNames: ["Flan"] },
        ],
      }),
    ]);
    expect(chips(card(el, "t2"))).toEqual(["Unavailable: Steak, Chips", "Unavailable: Flan"]);
  });

  it.each([
    ["warm", "Waiting"],
    ["overdue", "Overdue"],
  ] as const)("says a %s wait in words", async (band, text) => {
    const el = await mountFloor([table({ signals: [{ kind: "long_wait", band }] })]);
    expect(chips(card(el, "t2"))).toEqual([text]);
  });

  it("says a forgotten wait once, with the card's own Forgotten badge", async () => {
    const el = await mountFloor([
      table({ timingBand: "forgotten", signals: [{ kind: "long_wait", band: "forgotten" }] }),
    ]);
    expect(chips(card(el, "t2"))).toEqual([]);
    expect(words(card(el, "t2").querySelectorAll("[data-forgotten]"))).toEqual(["Forgotten"]);
  });

  it("lets the stations' ready chips stand for the ready count, while en route still shows", async () => {
    const readyOnly = table({ readyToServe: 2, signals: [ready(["bar", "Bar", 2])] });
    const enRoute = table({
      id: "t3",
      label: "Mesa 3",
      party: party({ id: "v3" }),
      enRoute: 1,
      readyToServe: 1,
      signals: [ready(["bar", "Bar", 1])],
    });
    const el = await mountFloor([readyOnly, enRoute]);
    expect(card(el, "t2").querySelector("[data-ready]")).toBeNull();
    expect(chips(card(el, "t2"))).toEqual(["Bar: 2 ready"]);
    expect(card(el, "t3").querySelector("[data-en-route]")).not.toBeNull();
    expect(chips(card(el, "t3"))).toEqual(["Bar: 1 ready"]);
  });

  it("says the signals in Spanish", async () => {
    setLocale("es");
    const el = await mountFloor([
      table({
        signals: [
          { kind: "take_order" },
          ready(["bar", "Barra", 3], ["kitchen", "Cocina", 1]),
          { kind: "long_wait", band: "overdue" },
          { kind: "held_unavailable", groupId: "g2", lineNames: ["Chuletón"] },
          { kind: "bill_requested", requestedAt: past },
        ],
      }),
    ]);
    expect(chips(card(el, "t2"))).toEqual([
      "Tomar nota",
      "Barra: 3 listos",
      "Cocina: 1 listo",
      "Con retraso",
      "No disponible: Chuletón",
      "Cuenta pedida",
    ]);
  });
});

describe("till-floor-screen: what each station has ready", () => {
  const mesa8 = table({
    id: "t8",
    label: "Mesa 8",
    party: party({ id: "v8", displayName: "Mesa 8", tableIds: ["t8"] }),
    signals: [ready(["bar", "Bar", 1], ["kitchen", "Kitchen", 2])],
  });
  /** One party at two joined tables: both carry its signals. */
  const joined = (id: string, label: string) =>
    table({
      id,
      label,
      party: party({ id: "v5", displayName: "Ana", tableIds: ["t5", "t6"] }),
      signals: [ready(["bar", "Bar", 2])],
    });
  const floor = [
    table({ signals: [ready(["bar", "Bar", 3])] }),
    mesa8,
    joined("t5", "Mesa 5"),
    joined("t6", "Mesa 6"),
    table({ id: "t9", label: "Mesa 9", party: null, state: "free", signals: [] }),
  ];
  const summary = (el: TillFloorScreen) =>
    [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-station-ready]")].map((row) => ({
      station: row.dataset.stationReady,
      text: row.querySelector("[data-station-tables]")!.textContent!.replace(/\s+/g, " ").trim(),
    }));

  it("lists each station's tables with their counts, a party at joined tables once", async () => {
    const el = await mountFloor(floor);
    expect(summary(el)).toEqual([
      { station: "bar", text: "Bar: Mesa 2 ×3, Mesa 8 ×1, Ana ×2" },
      { station: "kitchen", text: "Kitchen: Mesa 8 ×2" },
    ]);
  });

  it("covers tables in every zone, not only the zone on screen", async () => {
    const elsewhere = { ...mesa8, zoneId: "z2" };
    const el = await mountFloor([table({ signals: [ready(["bar", "Bar", 3])] }), elsewhere], {
      zones: [
        { id: "z1", name: "Comedor", displayOrder: 0, active: true, closesAt: null, closed: false },
        { id: "z2", name: "Terraza", displayOrder: 1, active: true, closesAt: null, closed: false },
      ],
    });
    expect(summary(el).map((row) => row.text)).toEqual([
      "Bar: Mesa 2 ×3, Mesa 8 ×1",
      "Kitchen: Mesa 8 ×2",
    ]);
  });

  it("is not shown while nothing is ready", async () => {
    const el = await mountFloor([table({ signals: [{ kind: "take_order" }] })]);
    expect(el.shadowRoot!.querySelector("[data-station-summary]")).toBeNull();
  });

  it("opens the station's own view from its row where the device has one", async () => {
    const el = await mountFloor(floor, { canOpenStation: true });
    const opened: unknown[] = [];
    el.addEventListener("show-station", (event) => opened.push((event as CustomEvent).detail));
    const open = el.shadowRoot!.querySelector<HTMLElement>('[data-open-station="bar"]')!;
    expect(open.textContent!.trim()).toBe("Open Bar");
    open.click();
    expect(opened).toEqual([{ stationId: "bar" }]);
  });

  it("offers no way into a station on a device without the station view", async () => {
    const el = await mountFloor(floor);
    expect(summary(el)).toHaveLength(2);
    expect(el.shadowRoot!.querySelector("[data-open-station]")).toBeNull();
  });

  it("says it in Spanish", async () => {
    setLocale("es");
    const el = await mountFloor([table({ signals: [ready(["bar", "Barra", 3])] })], {
      canOpenStation: true,
    });
    expect(el.shadowRoot!.querySelector("[data-station-summary] h2")!.textContent!.trim()).toBe(
      "Listo para servir",
    );
    expect(el.shadowRoot!.querySelector('[data-open-station="bar"]')!.textContent!.trim()).toBe(
      "Abrir Barra",
    );
  });
});
