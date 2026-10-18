import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  diningTables,
  floorPlanPlacements,
  floorPlans,
  floorPlanTableParts,
  floorPlanTables,
  floorPlanTableSizes,
  floorResetTables,
  floorTodayTables,
  floorTodayZones,
  floorZones,
} from "@waitron/db";
import type { TableRemoval } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { zoneSalePolicies, zoneServicePolicies } from "@waitron/venue-service";
import { checkZonePlanSave, readZonePlan, saveZonePlan, type ZonePlanSave } from "./floor-plan.js";
import { resetZone } from "./floor-today-store.js";
import {
  inTx,
  partyAt,
  seat,
  setupPartyVenue,
  tableRow,
  type PartyVenue,
} from "./testing/party-venue.js";
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
const NONE: readonly TableRemoval[] = [];
const PLACE = { x: 0, y: 0, width: 8, height: 8, shape: "rect" as const, rotation: 0 };

type SaveEntry = ZonePlanSave["tables"][number];

/** Counter 3 (2 seats), 4 (6) and 5 (4), off the plan, and Long table (10) placed and made of them. */
function longTableEntries(extra: SaveEntry[] = []): SaveEntry[] {
  const part = (key: string, label: string, seats: number): SaveEntry => ({
    key,
    label: fresh(label),
    seats,
    fixed: false,
    placement: null,
    partKeys: [],
  });
  return [
    part("c3", "Counter 3", 2),
    part("c4", "Counter 4", 6),
    part("c5", "Counter 5", 4),
    {
      key: "long",
      label: fresh("Long table"),
      seats: 10,
      fixed: false,
      placement: PLACE,
      partKeys: ["c3", "c4", "c5"],
    },
    ...extra,
  ];
}

/** A fresh table-service zone, so one case's tables never meet another's. */
async function zone(): Promise<string> {
  const id = randomUUID();
  await inTx(v, async (tx) => {
    const [tables] = await tx
      .select({ departmentId: zoneServicePolicies.departmentId })
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, v.tables.zoneId));
    await tx
      .insert(floorZones)
      .values({ id, locationId: v.cfg.locationId, name: `Zone ${id.slice(0, 8)}` });
    await tx.insert(zoneServicePolicies).values({
      locationId: v.cfg.locationId,
      zoneId: id,
      departmentId: tables!.departmentId,
    });
    await tx.insert(zoneSalePolicies).values({ zoneId: id, orderStart: "table" });
  });
  return id;
}

/** A name no other case uses: labels are unique across the venue. */
function fresh(label: string): string {
  return `${label}-${randomUUID().slice(0, 6)}`;
}

/** Writes a master plan at `revision`; each table follows the live table named, if any. */
async function masterOf(
  zoneId: string,
  tables: { label: string; live?: string; place?: boolean }[],
  revision = 1,
): Promise<string[]> {
  return inTx(v, async (tx) => {
    const [plan] = await tx
      .insert(floorPlans)
      .values({ zoneId, revision, savedAt: NOW.toISOString() })
      .returning({ id: floorPlans.id });
    const ids: string[] = [];
    for (const table of tables) {
      const [row] = await tx
        .insert(floorPlanTables)
        .values({ planId: plan!.id, zoneId, label: table.label, seats: 4 })
        .returning({ id: floorPlanTables.id });
      ids.push(row!.id);
      if (table.place === true) {
        await tx
          .insert(floorPlanPlacements)
          .values({ planId: plan!.id, planTableId: row!.id, ...PLACE });
      }
      if (table.live !== undefined) {
        await tx
          .update(diningTables)
          .set({ planTableId: row!.id, label: table.label })
          .where(eq(diningTables.id, table.live));
      }
    }
    return ids;
  });
}

async function liveTable(zoneId: string, label: string) {
  return v.table(label, zoneId);
}

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

function check(zoneId: string, input: ZonePlanSave, removals: readonly TableRemoval[] = NONE) {
  return inTx(v, (tx) => checkZonePlanSave(tx, v.cfg, removals, zoneId, input, NOW));
}

/** The statements `readZonePlan` takes for a zone whose master holds `tables` tables. */
async function readCost(tables: number): Promise<number> {
  const z = await zone();
  await masterOf(
    z,
    Array.from({ length: tables }, (_, i) => ({ label: fresh(`r${i}`) })),
  );
  return inTx(v, async (tx) => {
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
    try {
      await readZonePlan(tx, v.cfg, z);
      return prepare.mock.calls.length;
    } finally {
      prepare.mockRestore();
    }
  });
}

describe("readZonePlan", () => {
  it("reads a plan in the same statements however many tables it holds", async () => {
    const two = await readCost(2);
    expect(two).toBe(4);
    expect(await readCost(7)).toBe(two);
  });

  it("reads a joined table's parts, and none for a plain table", async () => {
    const z = await zone();
    const { ids } = await inTx(v, (tx) =>
      saveZonePlan(tx, v.cfg, NONE, z, { revision: 0, tables: longTableEntries() }, NOW),
    );
    const plan = await inTx(v, (tx) => readZonePlan(tx, v.cfg, z));
    const byId = new Map(plan.tables.map((t) => [t.id, t]));
    expect(byId.get(ids.long!)!.partIds).toEqual([ids.c3, ids.c4, ids.c5]);
    for (const key of ["c3", "c4", "c5"]) expect(byId.get(ids[key]!)!.partIds).toEqual([]);
  });

  it("refuses a zone that does not exist", async () => {
    const zoneId = randomUUID();
    const error = await refusal(inTx(v, (tx) => readZonePlan(tx, v.cfg, zoneId)));
    expect(error.code).toBe("zone.not_found");
    expect(error.params).toEqual({ zoneId });
  });
});

describe("checkZonePlanSave", () => {
  /** A zone whose master holds one table followed by a live table, plus an adoptable live table. */
  async function planned() {
    const z = await zone();
    const live = await liveTable(z, fresh("x"));
    const label = fresh("T1");
    const [master] = await masterOf(z, [{ label, live }]);
    const input: ZonePlanSave = {
      revision: 1,
      tables: [
        { id: master!, key: "a", label, seats: 4, fixed: false, placement: PLACE, partKeys: [] },
      ],
    };
    return { z, live, master: master!, input };
  }

  it("refuses a zone that does not exist", async () => {
    const zoneId = randomUUID();
    const error = await refusal(check(zoneId, { revision: 0, tables: [] }));
    expect(error.code).toBe("zone.not_found");
  });

  it("refuses a save from an older copy", async () => {
    const { z, input } = await planned();
    const error = await refusal(check(z, { ...input, revision: 0 }));
    expect(error.code).toBe("floor_plan.out_of_date");
    expect(error.params).toEqual({ zoneId: z, revision: 1 });
  });

  it("refuses a first save that is not at revision 0", async () => {
    const z = await zone();
    const error = await refusal(check(z, { revision: 1, tables: [] }));
    expect(error.code).toBe("floor_plan.out_of_date");
    expect(error.params).toEqual({ zoneId: z, revision: 0 });
  });

  it("refuses a name a master table of another zone uses, naming it", async () => {
    const other = await zone();
    const taken = fresh("Taken");
    await masterOf(other, [{ label: taken }]);
    const { z, input } = await planned();
    const save: ZonePlanSave = {
      ...input,
      tables: [
        ...input.tables,
        {
          key: "n",
          label: `  ${taken} `,
          seats: null,
          fixed: false,
          placement: null,
          partKeys: [],
        },
      ],
    };
    const error = await refusal(check(z, save));
    expect(error.code).toBe("table.label_taken");
    expect(error.params).toEqual({ label: taken });
  });

  it("refuses a name a live table outside the plan uses", async () => {
    const other = await zone();
    const taken = fresh("Loose");
    await liveTable(other, taken);
    const { z, input } = await planned();
    const save: ZonePlanSave = {
      ...input,
      tables: [
        ...input.tables,
        { key: "n", label: taken, seats: null, fixed: false, placement: null, partKeys: [] },
      ],
    };
    const error = await refusal(check(z, save));
    expect(error.code).toBe("table.label_taken");
    expect(error.params).toEqual({ label: taken });
  });

  it("compares names as the database does, by exact characters", async () => {
    const other = await zone();
    const taken = fresh("Loose");
    await liveTable(other, taken);
    const { z, input } = await planned();
    const save: ZonePlanSave = {
      ...input,
      tables: [
        ...input.tables,
        {
          key: "n",
          label: taken.toUpperCase(),
          seats: null,
          fixed: false,
          placement: null,
          partKeys: [],
        },
      ],
    };
    await expect(check(z, save)).resolves.toBeUndefined();
  });

  it("refuses a name used twice in the save", async () => {
    const { z, input } = await planned();
    const save: ZonePlanSave = {
      ...input,
      tables: [...input.tables, { ...input.tables[0]!, id: undefined, key: "b" }],
    };
    const error = await refusal(check(z, save));
    expect(error.code).toBe("table.label_taken");
    expect(error.params).toEqual({ label: input.tables[0]!.label });
  });

  it.each([
    ["tables.0.label", { label: "  " }],
    ["tables.0.placement.rotation", { placement: { ...PLACE, rotation: 10 } }],
    ["tables.0.placement.rotation", { placement: { ...PLACE, rotation: 360 } }],
    ["tables.0.placement.x", { placement: { ...PLACE, x: 1000 } }],
    ["tables.0.placement.y", { placement: { ...PLACE, y: -1 } }],
    ["tables.0.placement.width", { placement: { ...PLACE, width: 0 } }],
    ["tables.0.placement.height", { placement: { ...PLACE, height: 100 } }],
    ["tables.0.placement.x", { placement: { ...PLACE, x: 1.5 } }],
    ["tables.0.placement.shape", { placement: { ...PLACE, shape: "oval" } }],
    ["tables.0.seats", { seats: -1 }],
    ["tables.0.seats", { seats: 1000 }],
    ["tables.0.seats", { seats: 2.5 }],
    ["tables.1.key", { key: "a" }],
  ])("refuses %s", async (field, patch) => {
    const { z, master, input } = await planned();
    const resolved: Record<string, unknown> = { ...patch };
    if (resolved.id === "<a master id>") resolved.id = master;
    const entry = { ...input.tables[0]!, ...resolved } as ZonePlanSave["tables"][number];
    const tables =
      field === "tables.1.key"
        ? [input.tables[0]!, { ...entry, id: undefined, label: fresh("other") }]
        : [entry];
    const error = await refusal(check(z, { ...input, tables }));
    expect(error.code).toBe("floor_plan.invalid");
    expect(error.params).toEqual({ field });
  });

  it.each(["id"] as const)("refuses one %s named twice", async (name) => {
    const { z, master, input } = await planned();
    const ref = master;
    const entry = {
      key: "b",
      label: fresh("B"),
      seats: null,
      fixed: false,
      placement: null,
      partKeys: [],
    };
    const save: ZonePlanSave = {
      ...input,
      tables: [
        { ...input.tables[0]!, [name]: ref },
        { ...entry, [name]: ref },
      ],
    };
    const error = await refusal(check(z, save));
    expect(error.code).toBe("floor_plan.invalid");
    expect(error.params).toEqual({ field: `tables.1.${name}` });
  });

  it("refuses an id that is not a master table of this zone", async () => {
    const other = await zone();
    const [foreign] = await masterOf(other, [{ label: fresh("F") }]);
    const { z, input } = await planned();
    const save: ZonePlanSave = {
      ...input,
      tables: [
        ...input.tables,
        {
          id: foreign!,
          key: "f",
          label: fresh("F"),
          seats: null,
          fixed: false,
          placement: null,
          partKeys: [],
        },
      ],
    };
    const error = await refusal(check(z, save));
    expect(error.code).toBe("table.not_found");
    expect(error.params).toEqual({ tableId: foreign });
  });

  it("refuses deleting a table a module still needs", async () => {
    const { z, live, input } = await planned();
    const refuse = vi.fn<TableRemoval["refuse"]>(() =>
      Promise.resolve(new Map([[live, new AppError("table.booked", { tableId: live })]])),
    );
    const removals: TableRemoval[] = [{ refuse, release: vi.fn() }];
    const error = await refusal(check(z, { ...input, tables: [] }, removals));
    expect(error.code).toBe("table.booked");
    expect(refuse).toHaveBeenCalledWith(
      expect.anything(),
      { locationId: v.cfg.locationId },
      [live],
      NOW,
    );
  });

  it("asks nothing when a deleted master table has no live table", async () => {
    const z = await zone();
    await masterOf(z, [{ label: fresh("Lone") }]);
    const refuse = vi.fn<TableRemoval["refuse"]>();
    await expect(
      check(z, { revision: 1, tables: [] }, [{ refuse, release: vi.fn() }]),
    ).resolves.toBeUndefined();
    expect(refuse).not.toHaveBeenCalled();
  });

  it("accepts deleting a table a party sits at", async () => {
    const { z, live, input } = await planned();
    await seat(v, live);
    await expect(check(z, { ...input, tables: [] })).resolves.toBeUndefined();
  });

  it("lets a re-saved plan keep a name its zone's deleted table still holds", async () => {
    const { z, live, master, input } = await planned();
    const label = input.tables[0]!.label;
    // The first save deleted T1 and added a new T1, written as saveZonePlan writes it.
    const added = await inTx(v, async (tx) => {
      await tx.update(diningTables).set({ planTableId: null }).where(eq(diningTables.id, live));
      await tx.delete(floorPlanTables).where(eq(floorPlanTables.id, master));
      const [plan] = await tx
        .update(floorPlans)
        .set({ revision: 2 })
        .where(eq(floorPlans.zoneId, z))
        .returning({ id: floorPlans.id });
      const [row] = await tx
        .insert(floorPlanTables)
        .values({ planId: plan!.id, zoneId: z, label, seats: 4 })
        .returning({ id: floorPlanTables.id });
      return row!.id;
    });
    const save: ZonePlanSave = {
      revision: 2,
      tables: [
        { id: added, key: "a", label, seats: 4, fixed: false, placement: null, partKeys: [] },
      ],
    };
    await expect(check(z, save)).resolves.toBeUndefined();
  });

  it("refuses a name another zone's live table still holds, so a swap across zones cannot stall", async () => {
    const a = await zone();
    const b = await zone();
    const p = fresh("P");
    const q = fresh("Q");
    const x = fresh("X");
    const [ma] = await masterOf(a, [{ label: p, live: await liveTable(a, fresh("a")) }]);
    const [mb] = await masterOf(b, [{ label: q, live: await liveTable(b, fresh("b")) }]);
    const entry = { fixed: false, seats: null, placement: null, key: "k", partKeys: [] };
    // First save: zone A's P is renamed X; its live table keeps P until the next reset.
    await expect(
      check(a, { revision: 1, tables: [{ ...entry, id: ma!, label: x }] }),
    ).resolves.toBeUndefined();
    await inTx(v, async (tx) => {
      await tx.update(floorPlanTables).set({ label: x }).where(eq(floorPlanTables.id, ma!));
      await tx.update(floorPlans).set({ revision: 2 }).where(eq(floorPlans.zoneId, a));
    });

    const error = await refusal(
      check(b, { revision: 1, tables: [{ ...entry, id: mb!, label: p }] }),
    );
    expect(error.code).toBe("table.label_taken");
    expect(error.params).toEqual({ label: p });
  });

  it.each<[string, (entries: SaveEntry[]) => SaveEntry[], string]>([
    ["made of one table", (e) => patched(e, "long", { partKeys: ["c3"] }), "tables.3.partKeys"],
    [
      "naming a part twice",
      (e) => patched(e, "long", { partKeys: ["c3", "c3", "c4"] }),
      "tables.3.partKeys",
    ],
    [
      "naming a key not in the save",
      (e) => patched(e, "long", { partKeys: ["c3", "c4", "zz"] }),
      "tables.3.partKeys",
    ],
    [
      "naming itself",
      (e) => patched(e, "long", { partKeys: ["long", "c3", "c4"] }),
      "tables.3.partKeys",
    ],
    ["with a part on the plan", (e) => patched(e, "c4", { placement: PLACE }), "tables.3.partKeys"],
    [
      "with a joined table as a part",
      (e) => [
        ...patched(e, "long", { partKeys: ["c3", "bar"] }),
        { ...unplaced("bar", "Bar"), partKeys: ["c4", "c5"] },
      ],
      "tables.3.partKeys",
    ],
    [
      "sharing a part with another",
      (e) => [
        ...e,
        { ...unplaced("bar", "Bar"), placement: PLACE, partKeys: ["c5", "c6"] },
        unplaced("c6", "Counter 6"),
      ],
      "tables.4.partKeys",
    ],
    ["with no seats", (e) => patched(e, "long", { seats: null }), "tables.3.seats"],
    ["with 0 seats", (e) => patched(e, "long", { seats: 0 }), "tables.3.seats"],
  ])("refuses a joined table %s, naming its field", async (_, vary, field) => {
    const z = await zone();
    const error = await refusal(check(z, { revision: 0, tables: vary(longTableEntries()) }));
    expect({ code: error.code, params: error.params }).toEqual({
      code: "floor_plan.invalid",
      params: { field },
    });
  });
});

function patched(entries: SaveEntry[], key: string, patch: Partial<SaveEntry>): SaveEntry[] {
  return entries.map((e) => (e.key === key ? { ...e, ...patch } : e));
}

function unplaced(key: string, label: string): SaveEntry {
  return { key, label: fresh(label), seats: 4, fixed: false, placement: null, partKeys: [] };
}

describe("saveZonePlan", () => {
  type Entry = ZonePlanSave["tables"][number];

  function save(zoneId: string, input: ZonePlanSave) {
    return inTx(v, (tx) => saveZonePlan(tx, v.cfg, NONE, zoneId, input, NOW));
  }

  function entry(key: string, label: string, extra: Partial<Entry> = {}): Entry {
    return { key, label, seats: 4, fixed: false, placement: PLACE, partKeys: [], ...extra };
  }

  async function todayOf(tableId: string) {
    const [row] = await inTx(v, (tx) =>
      tx.select().from(floorTodayTables).where(eq(floorTodayTables.tableId, tableId)),
    );
    return row;
  }

  async function liveOf(masterId: string) {
    const [row] = await inTx(v, (tx) =>
      tx.select().from(diningTables).where(eq(diningTables.planTableId, masterId)),
    );
    return row;
  }

  async function labelsOf(zoneId: string): Promise<Record<string, string>> {
    const plan = await inTx(v, (tx) => readZonePlan(tx, v.cfg, zoneId));
    return Object.fromEntries(plan.tables.map((t) => [t.id!, t.label]));
  }

  /** Everything live about the zone: its tables, their today's rows, its reset rows and day. */
  async function liveStateOf(zoneId: string) {
    return inTx(v, async (tx) => {
      const tables = await tx
        .select()
        .from(diningTables)
        .where(eq(diningTables.zoneId, zoneId))
        .orderBy(asc(diningTables.id));
      const today = await tx
        .select()
        .from(floorTodayTables)
        .where(
          inArray(
            floorTodayTables.tableId,
            tables.map((t) => t.id),
          ),
        )
        .orderBy(asc(floorTodayTables.id));
      const reset = await tx
        .select()
        .from(floorResetTables)
        .where(eq(floorResetTables.zoneId, zoneId))
        .orderBy(asc(floorResetTables.id));
      const day = await tx.select().from(floorTodayZones).where(eq(floorTodayZones.zoneId, zoneId));
      return { tables, today, reset, day };
    });
  }

  /** A zone with live T1 saved as its first plan, plus a new fixed "Bar 1". */
  async function firstSaved() {
    const z = await zone();
    const t1 = fresh("T1");
    const bar = fresh("Bar 1");
    const result = await save(z, {
      revision: 0,
      tables: [
        entry("t1", t1),
        entry("bar", bar, {
          seats: null,
          fixed: true,
          placement: { ...PLACE, x: 20 },
        }),
      ],
    });
    const live = (await liveOf(result.ids.t1!))!.id;
    return { z, t1, bar, live, result };
  }

  async function partsOf(zoneId: string): Promise<Record<string, string[]>> {
    const plan = await inTx(v, (tx) => readZonePlan(tx, v.cfg, zoneId));
    return Object.fromEntries(plan.tables.map((t) => [t.id, t.partIds]));
  }

  /** Each entry sent back with its saved id, as the editor sends a plan it read. */
  function asSaved(entries: Entry[], ids: Record<string, string>): Entry[] {
    return entries.map((e) => (ids[e.key] === undefined ? e : { ...e, id: ids[e.key]! }));
  }

  describe("a joined table's parts", () => {
    it("saves Long table made of three tables added in the same save", async () => {
      const z = await zone();
      const { ids } = await save(z, { revision: 0, tables: longTableEntries() });
      expect((await partsOf(z))[ids.long!]).toEqual([ids.c3, ids.c4, ids.c5]);
    });

    it("takes a deleted part out of its joined table", async () => {
      const z = await zone();
      const entries = longTableEntries();
      const { ids } = await save(z, { revision: 0, tables: entries });
      const next = asSaved(entries, ids)
        .filter((e) => e.key !== "c5")
        .map((e) => (e.key === "long" ? { ...e, partKeys: ["c3", "c4"] } : e));
      await save(z, { revision: 1, tables: next });
      const parts = await partsOf(z);
      expect(parts[ids.long!]).toEqual([ids.c3, ids.c4]);
      expect(parts[ids.c5!]).toBeUndefined();
    });

    it("frees the parts of a deleted joined table", async () => {
      const z = await zone();
      const entries = longTableEntries();
      const { ids } = await save(z, { revision: 0, tables: entries });
      await save(z, {
        revision: 1,
        tables: asSaved(entries, ids).filter((e) => e.key !== "long"),
      });
      const partIds = [ids.c3!, ids.c4!, ids.c5!];
      expect(await partsOf(z)).toEqual(Object.fromEntries(partIds.map((id) => [id, []])));
      const rows = await inTx(v, (tx) =>
        tx
          .select()
          .from(floorPlanTableParts)
          .where(inArray(floorPlanTableParts.partTableId, partIds)),
      );
      expect(rows).toEqual([]);
    });

    it("moves a part between joined tables in one save", async () => {
      const z = await zone();
      const entries = longTableEntries();
      const { ids } = await save(z, { revision: 0, tables: entries });
      const next = [
        ...asSaved(entries, ids).map((e) =>
          e.key === "long" ? { ...e, partKeys: ["c3", "c4"] } : e,
        ),
        entry("c6", fresh("Counter 6"), { placement: null }),
        entry("bar", fresh("Bar"), { placement: { ...PLACE, x: 20 }, partKeys: ["c5", "c6"] }),
      ];
      const second = await save(z, { revision: 1, tables: next });
      const parts = await partsOf(z);
      expect(parts[ids.long!]).toEqual([ids.c3, ids.c4]);
      expect(parts[second.ids.bar!]).toEqual([ids.c5, second.ids.c6]);
      for (const key of ["c3", "c4", "c5", "c6"]) expect(parts[second.ids[key]!]).toEqual([]);
    });

    it("saves the parts in the same statements, however many there are", async () => {
      async function statementsFor(parts: number): Promise<number> {
        const z = await zone();
        await save(z, { revision: 0, tables: [] });
        const keys = Array.from({ length: parts }, (_, i) => `p${i}`);
        const input: ZonePlanSave = {
          revision: 1,
          tables: [
            ...keys.map((key) => entry(key, fresh(key), { placement: null })),
            entry("long", fresh("Long table"), { seats: 10, partKeys: keys }),
          ],
        };
        const counted = await inTx(v, async (tx) => {
          const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
          try {
            const saved = await saveZonePlan(tx, v.cfg, NONE, z, input, NOW);
            return { saved, statements: prepare.mock.calls.length };
          } finally {
            prepare.mockRestore();
          }
        });
        expect((await partsOf(z))[counted.saved.ids.long!]).toHaveLength(parts);
        return counted.statements;
      }

      expect(await statementsFor(4)).toBe(await statementsFor(2));
    });
  });

  it("inserts the new tables in the same statements, however many there are", async () => {
    async function statementsFor(tables: number): Promise<number> {
      const z = await zone();
      await save(z, { revision: 0, tables: [] });
      const keys = Array.from({ length: tables }, (_, i) => `k${i}`);
      const input: ZonePlanSave = {
        revision: 1,
        tables: keys.map((key) => entry(key, fresh(key))),
      };
      const counted = await inTx(v, async (tx) => {
        const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
        try {
          const saved = await saveZonePlan(tx, v.cfg, NONE, z, input, NOW);
          return { saved, statements: prepare.mock.calls.length };
        } finally {
          prepare.mockRestore();
        }
      });
      const plan = await inTx(v, (tx) => readZonePlan(tx, v.cfg, z));
      expect(plan.tables.map((t) => t.id).sort()).toEqual(Object.values(counted.saved.ids).sort());
      return counted.statements;
    }

    expect(await statementsFor(5)).toBe(await statementsFor(2));
  });

  it("accepts the plan it read sent back unchanged, each table with its own live table", async () => {
    const z = await zone();
    const first = await save(z, {
      revision: 0,
      tables: [entry("a", fresh("Trip a")), entry("b", fresh("Trip b"), { placement: null })],
    });
    const read = await inTx(v, (tx) => readZonePlan(tx, v.cfg, z));
    expect(read.tables.every((t) => t.id !== null && t.liveTableId !== null)).toBe(true);
    const live = await liveStateOf(z);
    const keyOf = new Map(read.tables.map((t, i) => [t.id!, `k${i}`]));

    const second = await save(z, {
      revision: read.revision,
      tables: read.tables.map((t) => ({
        id: t.id!,
        liveTableId: t.liveTableId!,
        key: keyOf.get(t.id!)!,
        label: t.label,
        seats: t.seats,
        fixed: t.fixed,
        placement: t.placement,
        partKeys: [],
      })),
    });

    expect(second.revision).toBe(first.revision + 1);
    const after = await inTx(v, (tx) => readZonePlan(tx, v.cfg, z));
    expect(after.tables).toEqual(read.tables);
    expect(await liveStateOf(z)).toEqual(live);
  });

  it("saves a first plan, links the live tables and builds today's plan", async () => {
    const { z, t1, bar, live, result } = await firstSaved();

    expect(result.revision).toBe(1);
    expect(Object.keys(result.ids).sort()).toEqual(["bar", "t1"]);
    const t1Row = await tableRow(v, live);
    expect(t1Row).toMatchObject({ planTableId: result.ids.t1, label: t1 });
    const barRow = await liveOf(result.ids.bar!);
    expect(barRow).toMatchObject({ zoneId: z, label: bar });
    expect(await todayOf(live)).toMatchObject({ x: 0, seats: 4, fixed: false });
    expect(await todayOf(barRow!.id)).toMatchObject({ x: 20, seats: null, fixed: true });
    const [today] = await inTx(v, (tx) =>
      tx.select().from(floorTodayZones).where(eq(floorTodayZones.zoneId, z)),
    );
    expect(today).toBeDefined();
    const plan = await inTx(v, (tx) => readZonePlan(tx, v.cfg, z));
    expect(plan.revision).toBe(1);
    expect(plan.savedAt).toBe(NOW.toISOString());
  });

  it("changes nothing live when a later save moves, renames or deletes a table", async () => {
    const { z, t1, live, result } = await firstSaved();
    const barLive = (await liveOf(result.ids.bar!))!.id;
    const patio = fresh("Patio 1");
    const before = await liveStateOf(z);

    const second = await save(z, {
      revision: 1,
      tables: [entry("t1", patio, { id: result.ids.t1!, placement: { ...PLACE, x: 30 } })],
    });

    expect(second).toEqual({ revision: 2, ids: { t1: result.ids.t1 } });
    // The one expected difference: the deleted Bar 1's live row and reset row lose their master.
    const unlinked = <T extends { id: string; planTableId: string | null }>(
      rows: T[],
      id: string,
    ) => rows.map((row) => (row.id === id ? { ...row, planTableId: null } : row));
    const barReset = before.reset.find((row) => row.tableId === barLive)!;
    expect(barReset.planTableId).toBe(result.ids.bar);
    expect(await liveStateOf(z)).toEqual({
      ...before,
      tables: unlinked(before.tables, barLive),
      reset: unlinked(before.reset, barReset.id),
    });
    expect(before.tables.find((row) => row.id === live)).toMatchObject({
      label: t1,
      planTableId: result.ids.t1,
    });
    expect(before.today.find((row) => row.tableId === live)).toMatchObject({ x: 0 });
    expect(before.today.find((row) => row.tableId === barLive)).toBeDefined();

    await inTx(v, (tx) => resetZone(tx, v.cfg, NONE, z, NOW, "due"));

    expect(await tableRow(v, live)).toMatchObject({ label: patio });
    expect(await todayOf(live)).toMatchObject({ x: 30 });
    const gone = await inTx(v, (tx) =>
      tx.select().from(diningTables).where(eq(diningTables.id, barLive)),
    );
    expect(gone).toEqual([]);
  });

  it("saves a change to one column of a kept table and leaves the other tables as they were", async () => {
    const { z, t1, bar, result } = await firstSaved();
    const mastersOf = () =>
      inTx(v, (tx) =>
        tx
          .select()
          .from(floorPlanTables)
          .where(inArray(floorPlanTables.id, [result.ids.t1!, result.ids.bar!]))
          .orderBy(asc(floorPlanTables.label)),
      );
    const before = await mastersOf();

    await save(z, {
      revision: 1,
      tables: [
        entry("t1", t1, { id: result.ids.t1!, seats: 6 }),
        entry("bar", bar, {
          id: result.ids.bar!,
          seats: null,
          fixed: true,
          placement: { ...PLACE, x: 20 },
        }),
      ],
    });

    const after = await mastersOf();
    const t1Before = before.find((row) => row.id === result.ids.t1)!;
    expect(t1Before.seats).toBe(4);
    expect(after.find((row) => row.id === result.ids.t1)).toEqual({ ...t1Before, seats: 6 });
    expect(after.find((row) => row.id === result.ids.bar)).toEqual(
      before.find((row) => row.id === result.ids.bar),
    );
  });

  it("swaps two tables' names in one save", async () => {
    const z = await zone();
    const [l1, l2] = [fresh("T1"), fresh("T2")];
    const { ids } = await save(z, {
      revision: 0,
      tables: [entry("1", l1), entry("2", l2)],
    });

    await save(z, {
      revision: 1,
      tables: [entry("1", l2, { id: ids["1"] }), entry("2", l1, { id: ids["2"] })],
    });

    expect(await labelsOf(z)).toEqual({ [ids["1"]!]: l2, [ids["2"]!]: l1 });
  });

  it("renames T1 to T9 and adds a new T1 in one save", async () => {
    const z = await zone();
    const [l1, l9] = [fresh("T1"), fresh("T9")];
    const { ids } = await save(z, { revision: 0, tables: [entry("1", l1)] });

    const second = await save(z, {
      revision: 1,
      tables: [entry("1", l9, { id: ids["1"] }), entry("new", l1, { seats: 2, placement: null })],
    });

    expect(second.ids["1"]).toBe(ids["1"]);
    expect(await labelsOf(z)).toEqual({ [ids["1"]!]: l9, [second.ids.new!]: l1 });
    const plan = await inTx(v, (tx) => readZonePlan(tx, v.cfg, z));
    expect(plan.tables.find((t) => t.id === second.ids.new)).toMatchObject({
      seats: 2,
      placement: null,
    });
  });

  it("renames a table while another table is named exactly the renamed table's id", async () => {
    const z = await zone();
    const [a, renamed] = [fresh("Id A"), fresh("Id A2")];
    const first = await save(z, { revision: 0, tables: [entry("a", a)] });
    const aId = first.ids.a!;
    const second = await save(z, {
      revision: 1,
      tables: [entry("a", a, { id: aId }), entry("b", aId)],
    });

    await save(z, {
      revision: 2,
      tables: [entry("a", renamed, { id: aId }), entry("b", aId, { id: second.ids.b })],
    });

    expect(await labelsOf(z)).toEqual({ [aId]: renamed, [second.ids.b!]: aId });
  });

  it("renames a table while another table takes the renamed table's id as its new name", async () => {
    const z = await zone();
    const [a, b, renamed] = [fresh("Id B"), fresh("Id B2"), fresh("Id B3")];
    const { ids } = await save(z, {
      revision: 0,
      tables: [entry("a", a), entry("b", b)],
    });

    await save(z, {
      revision: 1,
      tables: [entry("b", ids.a!, { id: ids.b }), entry("a", renamed, { id: ids.a })],
    });

    expect(await labelsOf(z)).toEqual({ [ids.a!]: renamed, [ids.b!]: ids.a });
  });

  it("returns the id of a table whose draft key is __proto__", async () => {
    const z = await zone();
    const result = await save(z, {
      revision: 0,
      tables: [entry("__proto__", fresh("Proto 1")), entry("b", fresh("Proto 2"))],
    });

    expect(Object.hasOwn(result.ids, "__proto__")).toBe(true);
    const plan = await inTx(v, (tx) => readZonePlan(tx, v.cfg, z));
    expect(plan.tables.map((t) => t.id)).toContain(result.ids["__proto__"]);
  });

  it("writes nothing when a check refuses", async () => {
    const { z, result } = await firstSaved();
    const before = await inTx(v, (tx) => readZonePlan(tx, v.cfg, z));

    const error = await refusal(
      save(z, { revision: 0, tables: [entry("t1", fresh("X"), { id: result.ids.t1 })] }),
    );

    expect(error.code).toBe("floor_plan.out_of_date");
    expect(await inTx(v, (tx) => readZonePlan(tx, v.cfg, z))).toEqual(before);
  });

  it("writes nothing when a joined table is refused", async () => {
    const z = await zone();
    const entries = longTableEntries();
    const { ids } = await save(z, { revision: 0, tables: entries });
    const before = await inTx(v, (tx) => readZonePlan(tx, v.cfg, z));

    const error = await refusal(
      save(z, {
        revision: 1,
        tables: patched(asSaved(entries, ids), "long", { partKeys: ["c3"] }),
      }),
    );

    expect({ code: error.code, params: error.params }).toEqual({
      code: "floor_plan.invalid",
      params: { field: "tables.3.partKeys" },
    });
    expect(await inTx(v, (tx) => readZonePlan(tx, v.cfg, z))).toEqual(before);
  });

  it("deletes a table a party sits at, and the party stays", async () => {
    const { z, t1, bar, live, result } = await firstSaved();
    const { partyId } = await seat(v, live);
    const before = await tableRow(v, live);

    const second = await save(z, {
      revision: 1,
      tables: [entry("bar", bar, { id: result.ids.bar })],
    });

    expect(second.revision).toBe(2);
    expect(await tableRow(v, live)).toEqual({ ...before, planTableId: null });
    expect(before).toMatchObject({ label: t1 });
    expect(await partyAt(v, live)).toBe(partyId);
  });

  it("lets a plan that deleted a table and added one by its name be saved again", async () => {
    const { z, t1, live, result } = await firstSaved();
    const { ids } = await save(z, {
      revision: 1,
      tables: [entry("again", t1, { seats: 6 })],
    });

    const third = await save(z, {
      revision: 2,
      tables: [entry("again", t1, { id: ids.again, seats: 8 })],
    });

    expect(third).toEqual({ revision: 3, ids: { again: ids.again } });
    expect(await tableRow(v, live)).toMatchObject({ label: t1, planTableId: null });
    expect(ids.again).not.toBe(result.ids.t1);
  });

  it("unlinks a pending create's reset row when its master table is deleted", async () => {
    const z = await zone();
    const name = fresh("N");
    const held = await liveTable(z, name);
    await seat(v, held);
    const { ids } = await save(z, { revision: 0, tables: [entry("n", name)] });
    const pending = async () =>
      inTx(v, (tx) =>
        tx
          .select()
          .from(floorResetTables)
          .where(and(eq(floorResetTables.zoneId, z), isNull(floorResetTables.tableId))),
      );
    expect(await pending()).toEqual([
      expect.objectContaining({ planTableId: ids.n, pending: true, label: name }),
    ]);

    await expect(save(z, { revision: 1, tables: [] })).resolves.toEqual({
      revision: 2,
      ids: {},
    });

    expect(await pending()).toEqual([
      expect.objectContaining({ planTableId: null, pending: true, label: name }),
    ]);
  });

  it("stores a placed table's place in floor_plan_placements and none on the table", async () => {
    const z = await zone();
    const placement = { x: 12, y: 34, width: 5, height: 6, shape: "round" as const, rotation: 45 };
    const { ids } = await save(z, {
      revision: 0,
      tables: [entry("p", fresh("Placed"), { placement }), unplaced("s", "Spare")],
    });
    const [plan] = await inTx(v, (tx) =>
      tx.select({ id: floorPlans.id }).from(floorPlans).where(eq(floorPlans.zoneId, z)),
    );
    const placements = await inTx(v, (tx) =>
      tx
        .select()
        .from(floorPlanPlacements)
        .where(inArray(floorPlanPlacements.planTableId, [ids.p!, ids.s!])),
    );
    expect(placements).toEqual([
      { id: expect.any(String), planId: plan!.id, planTableId: ids.p!, ...placement },
    ]);
    const tables = await inTx(v, (tx) =>
      tx
        .select()
        .from(floorPlanTables)
        .where(inArray(floorPlanTables.id, [ids.p!, ids.s!])),
    );
    expect(tables).toHaveLength(2);
    for (const table of tables) {
      expect(table).toMatchObject({
        zoneId: z,
        x: null,
        y: null,
        width: null,
        height: null,
        shape: null,
        rotation: null,
      });
    }
  });

  describe("a table's kept size", () => {
    const SIZED = { ...PLACE, width: 2, height: 3 };

    async function tableOf(z: string, id: string) {
      const plan = await inTx(v, (tx) => readZonePlan(tx, v.cfg, z));
      return plan.tables.find((t) => t.id === id)!;
    }

    /** Counter 3 saved on the plan at 2 × 3, then saved off it. */
    async function takenOff() {
      const z = await zone();
      const label = fresh("Counter 3");
      const { ids } = await save(z, {
        revision: 0,
        tables: [entry("c3", label, { placement: SIZED })],
      });
      const c3 = ids.c3!;
      await save(z, {
        revision: 1,
        tables: [entry("c3", label, { id: c3, placement: null })],
      });
      return { z, label, c3 };
    }

    it("keeps the width and height of a table taken off the plan", async () => {
      const { z, c3 } = await takenOff();
      const table = await tableOf(z, c3);
      expect(table.keptSize).toEqual({ width: 2, height: 3 });
      expect(table.placement).toBeNull();
    });

    it("keeps the size through later saves while the table stays off the plan", async () => {
      const { z, label, c3 } = await takenOff();
      await save(z, {
        revision: 2,
        tables: [entry("c3", label, { id: c3, placement: null, seats: 6 })],
      });
      const table = await tableOf(z, c3);
      expect(table.seats).toBe(6);
      expect(table.keptSize).toEqual({ width: 2, height: 3 });
    });

    it("drops the kept size once the table is placed again", async () => {
      const { z, label, c3 } = await takenOff();
      await save(z, { revision: 2, tables: [entry("c3", label, { id: c3 })] });
      const table = await tableOf(z, c3);
      expect(table.keptSize).toBeNull();
      expect(table.placement).toEqual(PLACE);
    });

    it("gives a table that was never placed no kept size", async () => {
      const z = await zone();
      const { ids } = await save(z, { revision: 0, tables: [unplaced("n", "Never placed")] });
      expect((await tableOf(z, ids.n!)).keptSize).toBeNull();
    });

    it("deletes a kept size with its table", async () => {
      const { z, c3 } = await takenOff();
      await expect(save(z, { revision: 2, tables: [] })).resolves.toEqual({
        revision: 3,
        ids: {},
      });
      const sizes = await inTx(v, (tx) =>
        tx.select().from(floorPlanTableSizes).where(eq(floorPlanTableSizes.planTableId, c3)),
      );
      expect(sizes).toEqual([]);
    });

    it("keeps a table's off-plan size in its layout", async () => {
      const { z, c3 } = await takenOff();
      const [plan] = await inTx(v, (tx) =>
        tx.select({ id: floorPlans.id }).from(floorPlans).where(eq(floorPlans.zoneId, z)),
      );
      const sizes = await inTx(v, (tx) =>
        tx.select().from(floorPlanTableSizes).where(eq(floorPlanTableSizes.planTableId, c3)),
      );
      expect(sizes).toMatchObject([{ planId: plan!.id, width: 2, height: 3 }]);
    });

    it("keeps sizes in the same statements, however many tables leave the plan", async () => {
      async function statementsFor(tables: number): Promise<number> {
        const z = await zone();
        const keys = Array.from({ length: tables }, (_, i) => `k${i}`);
        const labels = keys.map((key) => fresh(key));
        const { ids } = await save(z, {
          revision: 0,
          tables: keys.map((key, i) => entry(key, labels[i]!, { placement: SIZED })),
        });
        const input: ZonePlanSave = {
          revision: 1,
          tables: keys.map((key, i) => entry(key, labels[i]!, { id: ids[key]!, placement: null })),
        };
        const statements = await inTx(v, async (tx) => {
          const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
          try {
            await saveZonePlan(tx, v.cfg, NONE, z, input, NOW);
            return prepare.mock.calls.filter(([sql]) => sql.includes("floor_plan_table_sizes"))
              .length;
          } finally {
            prepare.mockRestore();
          }
        });
        const plan = await inTx(v, (tx) => readZonePlan(tx, v.cfg, z));
        expect(plan.tables.map((t) => t.keptSize)).toEqual(
          keys.map(() => ({ width: 2, height: 3 })),
        );
        return statements;
      }

      expect(await statementsFor(5)).toBe(await statementsFor(2));
    });
  });
});

describe("floor plans without adoption", () => {
  it("reads a zone with live tables and no master plan as an empty draft", async () => {
    const z = await zone();
    await liveTable(z, fresh("Unplanned"));
    expect(await inTx(v, (tx) => readZonePlan(tx, v.cfg, z))).toEqual({
      zoneId: z,
      revision: 0,
      savedAt: null,
      tables: [],
    });
  });

  it("does not read a save entry's liveTableId", async () => {
    const z = await zone();
    const other = await zone();
    const live = await liveTable(other, fresh("Other"));
    const label = fresh("New");
    const input = {
      revision: 0,
      tables: [
        {
          key: "a",
          liveTableId: live,
          label,
          seats: 4,
          fixed: false,
          placement: PLACE,
          partKeys: [],
        },
      ],
    };
    const saved = await inTx(v, (tx) => saveZonePlan(tx, v.cfg, NONE, z, input, NOW));
    const plan = await inTx(v, (tx) => readZonePlan(tx, v.cfg, z));
    expect(plan.tables).toEqual([
      {
        id: saved.ids.a,
        liveTableId: expect.any(String),
        label,
        seats: 4,
        fixed: false,
        placement: PLACE,
        keptSize: null,
        partIds: [],
      },
    ]);
    expect(plan.tables[0]!.liveTableId).not.toBe(live);
    expect((await tableRow(v, live)).zoneId).toBe(other);
    expect((await tableRow(v, live)).planTableId).toBeNull();
  });

  it("allows this zone's unlinked live name but refuses another zone's live and master names", async () => {
    const z = await zone();
    const own = fresh("Own");
    await liveTable(z, own);
    const input = (label: string): ZonePlanSave => ({
      revision: 0,
      tables: [{ key: "a", label, seats: 4, fixed: false, placement: PLACE, partKeys: [] }],
    });
    await expect(check(z, input(own))).resolves.toBeUndefined();
    const other = await zone();
    const held = fresh("Held");
    const master = fresh("Master");
    await liveTable(other, held);
    await masterOf(other, [{ label: master }]);
    for (const label of [held, master]) {
      const error = await refusal(check(z, input(label)));
      expect(error.code).toBe("table.label_taken");
      expect(error.params).toEqual({ label });
    }
  });
});
