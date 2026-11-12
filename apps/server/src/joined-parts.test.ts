import { floorLabelSuffix } from "./testing/floor-label.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { workingOrders } from "@waitron/db";
import type { TableRemoval } from "@waitron/module";
import { readLayout, saveLayout, type ZonePlanSave } from "./floor-plan.js";
import { defaultLayout } from "./testing/floor-sets.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { writeMerge } from "./floor-today-merges.js";
import { resetZone } from "./floor-today-store.js";
import { moveBill } from "./testing/move-bill-fixture.js";
import { listTables } from "./tables.js";
import { moveGuests } from "./testing/table-action-fixture.js";
import { createOpenOrder, listTablesWithState } from "./working-order.js";
import {
  activeTablesOf,
  billRow,
  commandFor,
  counterOrder,
  inTx,
  join,
  OPERATOR,
  partyAt,
  seat,
  seatWithNoAllergies,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { mergeOf, plannedZone, setsDepartment } from "./testing/floor-today-venue.js";
import "./errors.js";

let v: PartyVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

const NOW = new Date("2026-10-10T12:00:00Z");
const REMOVALS: readonly TableRemoval[] = enabledTableRemovals(ALL_MODULES);

/** Counter 3 (2 seats), 4 (6) and 5 (4) off the plan, Long table (10) placed and made of them, and Bar placed. */
const LONG_AND_BAR = () =>
  plannedZone(
    v,
    [
      { key: "c3", label: "Counter 3", seats: 2, place: null },
      { key: "c4", label: "Counter 4", seats: 6, place: null },
      { key: "c5", label: "Counter 5", seats: 4, place: null },
      {
        key: "long",
        label: "Long table",
        seats: 10,
        place: { x: 0, y: 0 },
        partKeys: ["c3", "c4", "c5"],
      },
      { key: "bar", label: "Bar", seats: 4, place: { x: 40, y: 0 } },
    ],
    NOW,
  );

describe("a saved joined table's real members", () => {
  it("seats a party at Counter 4 across the whole group", async () => {
    const { table } = await LONG_AND_BAR();
    const { partyId } = await seat(v, table.c4!);
    expect((await activeTablesOf(v, partyId)).sort()).toEqual(
      [table.c3!, table.c4!, table.c5!].sort(),
    );
  });

  it("joins Counter 5 to a party at Bar", async () => {
    const { table } = await LONG_AND_BAR();
    const { partyId } = await seat(v, table.bar!);
    await join(v, partyId, table.c5!);
    expect((await activeTablesOf(v, partyId)).sort()).toEqual([table.bar!, table.c5!].sort());
  });

  it("moves guests to Counter 3", async () => {
    const { table } = await LONG_AND_BAR();
    const { partyId } = await seat(v, table.bar!);
    const sent = await commandFor(v, partyId);
    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, partyId, table.c3!, { ...sent, otherPartyId: null }),
    );
    expect((await activeTablesOf(v, partyId)).sort()).toEqual([table.c3!].sort());
    expect(await partyAt(v, table.bar!)).toBeNull();
  });

  it("moves a bill to a party at Counter 3", async () => {
    const { table } = await LONG_AND_BAR();
    const { partyId } = await seatWithNoAllergies(v, table.c3!);
    const orderId = await counterOrder(v, "Flan");
    const command = await commandFor(v, partyId);
    await inTx(v, (tx) =>
      moveBill(
        tx,
        v.cfg,
        orderId,
        { tableId: table.c3! },
        {
          operatorId: OPERATOR,
          otherPartyId: partyId,
          expectedOtherPartyRevision: command.expectedPartyRevision,
        },
      ),
    );
    expect((await billRow(v, orderId)).partyId).toBe(partyId);
    expect((await activeTablesOf(v, partyId)).sort()).toEqual(
      [table.c3!, table.c4!, table.c5!].sort(),
    );
  });

  it("merges Bar with Counter 5's ordinary group", async () => {
    const { table } = await LONG_AND_BAR();
    await inTx(v, (tx) =>
      writeMerge(tx, v.cfg, {
        movingId: table.bar!,
        targetId: table.c5!,
        side: "right",
        seats: 8,
        free: true,
      }),
    );
    expect((await mergeOf(v, table.bar!))!.members.map((m) => m.tableId).sort()).toEqual(
      [table.bar!, table.c3!, table.c4!, table.c5!].sort(),
    );
  });

  it("delivers a counter order to Counter 3", async () => {
    const { table } = await LONG_AND_BAR();
    const id = randomUUID();
    await inTx(v, (tx) =>
      createOpenOrder(tx, v.cfg, id, [{ menuItemId: v.counterItem("Flan"), quantity: "1" }], null, {
        deliveryTableId: table.c3!,
        zoneId: v.counter.zoneId,
      }),
    );
    const [written] = await inTx(v, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, id)),
    );
    expect(written).toMatchObject({ deliveryTableId: table.c3! });
  });

  it("Long table waits, not yet made, while two of its parts still hold parties from before the reset", async () => {
    const { zoneId, table, master, revision } = await plannedZone(
      v,
      [
        { key: "c3", label: "Counter 3", seats: 2, place: { x: 0, y: 0 } },
        { key: "c4", label: "Counter 4", seats: 6, place: { x: 20, y: 0 } },
        { key: "c5", label: "Counter 5", seats: 4, place: { x: 40, y: 0 } },
      ],
      NOW,
    );
    await seat(v, table.c3!);
    await seat(v, table.c4!);
    const plan = await inTx(v, async (tx) =>
      readLayout(tx, await defaultLayout(tx, v.cfg, zoneId)),
    );
    const tables: ZonePlanSave["tables"] = plan.tables.map((entry) => ({
      id: entry.id,
      key: entry.id,
      label: entry.label,
      seats: entry.seats,
      fixed: entry.fixed,
      placement: null,
      partKeys: [],
    }));
    tables.push({
      key: "long",
      label: `Long table ${floorLabelSuffix()}`,
      seats: 10,
      fixed: false,
      placement: { x: 0, y: 20, width: 6, height: 2, shape: "rect", rotation: 0 },
      partKeys: [master.c3!, master.c4!, master.c5!],
    });
    const { ids } = await inTx(v, async (tx) =>
      saveLayout(tx, REMOVALS, await defaultLayout(tx, v.cfg, zoneId), { revision, tables }, NOW),
    );
    await inTx(v, (tx) => resetZone(tx, REMOVALS, zoneId, NOW, "due"));
    const after = await inTx(v, async (tx) =>
      readLayout(tx, await defaultLayout(tx, v.cfg, zoneId)),
    );
    expect(after.tables.find((entry) => entry.id === ids.long)!.liveTableId).toBeNull();
    const { partyId } = await seat(v, table.c5!);
    expect(await partyAt(v, table.c5!)).toBe(partyId);
  });
});

describe("a layout that stands a joined table's tables", () => {
  /** Standard places 4 and 5 and leaves 4+5 off; Dinner places 4+5 and leaves 4 and 5 off; reset onto Standard. */
  async function underStandard(): Promise<Record<"t4" | "t5" | "t45", string>> {
    const d = await setsDepartment(v, new Date("2026-10-09T06:00:00Z"));
    const label = (base: string) => `${base} ${floorLabelSuffix()}`;
    const save = async (setId: string, tables: ZonePlanSave["tables"]) => {
      const plan = await inTx(v, (tx) => readLayout(tx, { setId, zoneId: d.zoneId }));
      return inTx(v, (tx) =>
        saveLayout(
          tx,
          REMOVALS,
          { setId, zoneId: d.zoneId },
          { revision: plan.revision, tables },
          NOW,
        ),
      );
    };
    const at = (x: number) => ({
      x,
      y: 0,
      width: 8,
      height: 8,
      shape: "rect" as const,
      rotation: 0,
    });
    const { ids } = await save(d.standard, [
      { key: "t4", label: label("4"), seats: 4, fixed: false, placement: at(0), partKeys: [] },
      { key: "t5", label: label("5"), seats: 4, fixed: false, placement: at(20), partKeys: [] },
      {
        key: "t45",
        label: label("4+5"),
        seats: 8,
        fixed: false,
        placement: null,
        partKeys: ["t4", "t5"],
      },
    ]);
    const standard = await inTx(v, (tx) => readLayout(tx, { setId: d.standard, zoneId: d.zoneId }));
    await save(
      d.dinner,
      standard.tables.map((t) => ({
        id: t.id,
        key: t.id,
        label: t.label,
        seats: t.seats,
        fixed: t.fixed,
        placement: t.id === ids.t45 ? at(0) : null,
        partKeys: t.partIds,
      })),
    );
    await inTx(v, (tx) =>
      resetZone(tx, REMOVALS, d.zoneId, NOW, { setId: d.standard, occurrence: null }),
    );
    const after = await inTx(v, (tx) => readLayout(tx, { setId: d.standard, zoneId: d.zoneId }));
    const live = (key: string) => after.tables.find((t) => t.id === ids[key])!.liveTableId!;
    return { t4: live("t4"), t5: live("t5"), t45: live("t45") };
  }

  it("seats a party at 4 and joins 5 to it", async () => {
    const table = await underStandard();
    const { partyId } = await seat(v, table.t4);
    expect(await partyAt(v, table.t4)).toBe(partyId);
    await join(v, partyId, table.t5);
    expect((await activeTablesOf(v, partyId)).sort()).toEqual([table.t4, table.t5].sort());
  });

  it("lists 4 and 5 among the tables, and not 4+5", async () => {
    const table = await underStandard();
    const ids = (await inTx(v, (tx) => listTables(tx, NOW))).map((t) => t.id);
    expect(ids).toContain(table.t4);
    expect(ids).toContain(table.t5);
    expect(ids).not.toContain(table.t45);
  });

  it("reads only the real tables, with ordinary group fields", async () => {
    const table = await underStandard();
    const states = await inTx(v, (tx) => listTablesWithState(tx, [], NOW));
    for (const id of [table.t4, table.t5]) {
      expect(states.find((s) => s.id === id)!.today).toMatchObject({ joinId: null });
    }
    expect(states.some((s) => s.id === table.t45)).toBe(false);
  });
});
