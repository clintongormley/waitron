import { afterEach, describe, expect, it } from "vitest";
import type { TableSignal } from "@waitron/shared";
import type { FloorMapTable, WtFloorMap } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { en, es } from "../i18n/strings.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import "./till-floor-screen.js";
import type { FloorZone, TableParty, TableState, TableToday } from "../api/client.js";

const now = Date.parse("2026-10-20T20:00:00.000Z");
const inMinutes = (m: number) => new Date(now + m * 60_000).toISOString();

const zone: FloorZone = {
  id: "z1",
  name: "Comedor",
  displayOrder: 0,
  active: true,
  closesAt: null,
  closed: false,
  hasPlan: true,
  layoutSetName: null,
  layoutDue: null,
  serviceMode: "table_tab",
};

function party(id: string, over: Partial<TableParty> = {}): TableParty {
  return {
    id,
    kitchenNote: { scope: { partyId: id }, note: null, revision: 0, ownerRevision: 1 },
    revision: 1,
    guestCount: 2,
    state: "open",
    name: null,
    displayName: id,
    mainBillId: null,
    outstanding: "0.00",
    billCount: 1,
    tableIds: [],
    unsentDrafts: [],
    reminder: null,
    ...over,
  };
}

function today(x: number, over: Partial<TableToday> = {}): TableToday {
  return {
    placement: { x, y: 3, width: 2, height: 2, shape: "round", rotation: 0 },
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

function free(id: string, x: number, over: Partial<TableState> = {}): TableState {
  return {
    id,
    label: id.slice(1),
    zoneId: "z1",
    state: "free",
    condition: "free",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: today(x),
    signals: [],
    party: null,
    ...over,
  };
}

const seated = (id: string, x: number, over: Partial<TableState> = {}): TableState =>
  free(id, x, {
    state: "open-tab",
    condition: "held",
    hasOpenTab: true,
    party: party(`p-${id}`),
    ...over,
  });

const bill: TableSignal = { kind: "bill_requested", requestedAt: inMinutes(-3) };
const waiting: TableSignal = { kind: "long_wait", band: "warm" };
const unavailable: TableSignal = { kind: "held_unavailable", groupId: "g1", lineNames: ["Steak"] };

const mount = (tables: TableState[]) =>
  mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: [zone],
    tables,
    now,
    reducedMotion: true,
  }).then(({ el }) => el);

const drawn = (el: TillFloorScreen, id: string): FloorMapTable =>
  el.shadowRoot!.querySelector<WtFloorMap>("wt-floor-map")!.tables.find((each) => each.id === id)!;

const lookOf = ({ fill, outline, pulse, cue, description }: FloorMapTable) => ({
  fill,
  outline,
  pulse,
  cue,
  description,
});

afterEach(cleanupWidgets);

describe("till-floor-screen: the map's look", () => {
  it("hands the map each table's look", async () => {
    const el = await mount([
      seated("t1", 0, { timingBand: "forgotten" }),
      seated("t2", 4, { signals: [bill, waiting] }),
      seated("t3", 8),
    ]);
    const seatedWord = en["floor.status_seated"];
    expect(lookOf(drawn(el, "t1"))).toEqual({
      fill: "danger",
      outline: null,
      pulse: "forgotten",
      cue: { icon: "floor-timer", text: en["floor.forgotten"] },
      description: `${seatedWord}, ${en["floor.forgotten"]}`,
    });
    expect(lookOf(drawn(el, "t2"))).toEqual({
      fill: "bill",
      outline: "waiting",
      pulse: null,
      cue: { icon: "floor-bill", text: en["floor.cue_bill"] },
      description: `${seatedWord}, ${en["signal.bill_requested"]}, ${en["signal.wait_warm"]}`,
    });
    expect(lookOf(drawn(el, "t3"))).toEqual({
      fill: "calm",
      outline: null,
      pulse: null,
      cue: { icon: "floor-check", text: "" },
      description: `${seatedWord}, ${en["floor.nothing_needed"]}`,
    });
    for (const id of ["t1", "t2", "t3"]) expect(drawn(el, id)).not.toHaveProperty("dot");
  });

  it("says the cues in Spanish", async () => {
    const previous = currentLocale();
    try {
      setLocale("es");
      const el = await mount([
        seated("t1", 0, { signals: [unavailable] }),
        seated("t2", 4, {
          party: party("p-t2", { reminder: { groupId: "g2", dueAt: inMinutes(-1) } }),
        }),
        seated("t3", 8, { signals: [bill] }),
        free("t4", 12, { condition: "needs_clearing" }),
        free("t5", 16, { today: today(16, { needsMoving: true }) }),
      ]);
      expect(["t1", "t2", "t3", "t4", "t5"].map((id) => drawn(el, id).cue?.text)).toEqual([
        es["floor.cue_out"],
        es["floor.cue_fire"],
        es["floor.cue_bill"],
        es["floor.cue_clear"],
        es["floor.cue_move"],
      ]);
    } finally {
      setLocale(previous);
    }
  });
});
