import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  diningTables,
  floorPlanJoins,
  floorPlanJoinTables,
  floorPlans,
  floorPlanTables,
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
        .values({
          planId: plan!.id,
          label: table.label,
          seats: 4,
          ...(table.place === true ? PLACE : {}),
        })
        .returning({ id: floorPlanTables.id });
      ids.push(row!.id);
      if (table.live !== undefined) {
        await tx
          .update(diningTables)
          .set({ planTableId: row!.id, planned: true, label: table.label })
          .where(eq(diningTables.id, table.live));
      }
    }
    return ids;
  });
}

async function liveTable(zoneId: string, label: string, capacity: number | null = null) {
  const id = await v.table(label, zoneId);
  if (capacity !== null) {
    await inTx(v, (tx) => tx.update(diningTables).set({ capacity }).where(eq(diningTables.id, id)));
  }
  return id;
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

describe("readZonePlan", () => {
  it("offers a zone's live tables as the first draft", async () => {
    const z = await zone();
    const t1 = await liveTable(z, fresh("T1"), 4);
    const off = await liveTable(z, fresh("Off"));
    const waiting = await liveTable(z, fresh("Waiting"));
    await inTx(v, async (tx) => {
      await tx.update(diningTables).set({ active: false }).where(eq(diningTables.id, off));
      await tx.update(diningTables).set({ planned: true }).where(eq(diningTables.id, waiting));
    });
    const [label] = await inTx(v, (tx) =>
      tx.select({ label: diningTables.label }).from(diningTables).where(eq(diningTables.id, t1)),
    );

    const plan = await inTx(v, (tx) => readZonePlan(tx, v.cfg, z));

    expect(plan).toEqual({
      zoneId: z,
      revision: 0,
      savedAt: null,
      tables: [
        { id: null, liveTableId: t1, label: label!.label, seats: 4, fixed: false, placement: null },
      ],
      joins: [],
    });
  });

  it("offers a table the old screen added to a planned zone for adoption", async () => {
    const z = await zone();
    const live = await liveTable(z, fresh("x"));
    const t1 = fresh("T1");
    const t2 = fresh("T2");
    const [m1, m2] = await masterOf(z, [{ label: t1, live, place: true }, { label: t2 }], 3);
    const [join] = await inTx(v, async (tx) => {
      const [plan] = await tx
        .select({ id: floorPlans.id })
        .from(floorPlans)
        .where(eq(floorPlans.zoneId, z));
      const rows = await tx
        .insert(floorPlanJoins)
        .values({ planId: plan!.id, seats: 8 })
        .returning({ id: floorPlanJoins.id });
      await tx.insert(floorPlanJoinTables).values({ joinId: rows[0]!.id, planTableId: m1! });
      await tx.insert(floorPlanJoinTables).values({ joinId: rows[0]!.id, planTableId: m2! });
      return rows;
    });
    const added = await liveTable(z, fresh("Added"), 2);

    const plan = await inTx(v, (tx) => readZonePlan(tx, v.cfg, z));

    expect(plan.revision).toBe(3);
    expect(plan.savedAt).toBe(NOW.toISOString());
    expect(plan.tables).toEqual(
      expect.arrayContaining([
        { id: m1, liveTableId: live, label: t1, seats: 4, fixed: false, placement: PLACE },
        { id: m2, liveTableId: null, label: t2, seats: 4, fixed: false, placement: null },
        expect.objectContaining({ id: null, liveTableId: added, seats: 2, placement: null }),
      ]),
    );
    expect(plan.tables).toHaveLength(3);
    expect(plan.joins).toEqual([
      { id: join!.id, seats: 8, tableIds: expect.arrayContaining([m1, m2]) as string[] },
    ]);
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
    const spare = await liveTable(z, fresh("Spare"));
    const input: ZonePlanSave = {
      revision: 1,
      tables: [{ id: master!, key: "a", label, seats: 4, fixed: false, placement: PLACE }],
      joins: [],
    };
    return { z, live, master: master!, spare, input };
  }

  it("accepts a valid save that adopts a live table and joins two tables", async () => {
    const { z, spare, input } = await planned();
    const save: ZonePlanSave = {
      ...input,
      tables: [
        ...input.tables,
        {
          liveTableId: spare,
          key: "b",
          label: fresh("B"),
          seats: null,
          fixed: true,
          placement: null,
        },
      ],
      joins: [{ seats: 6, tableKeys: ["a", "b"] }],
    };
    await expect(check(z, save)).resolves.toBeUndefined();
  });

  it("refuses a zone that does not exist", async () => {
    const zoneId = randomUUID();
    const error = await refusal(check(zoneId, { revision: 0, tables: [], joins: [] }));
    expect(error.code).toBe("zone.not_found");
  });

  it("refuses a save from an older copy", async () => {
    const { z, input } = await planned();
    const error = await refusal(check(z, { ...input, revision: 0 }));
    expect(error.code).toBe("floor_plan.changed");
    expect(error.params).toEqual({ zoneId: z });
  });

  it("accepts a first save that adopts the zone's live tables", async () => {
    const z = await zone();
    const label = fresh("T1");
    const live = await liveTable(z, label);
    const save: ZonePlanSave = {
      revision: 0,
      tables: [{ liveTableId: live, key: "a", label, seats: 2, fixed: false, placement: PLACE }],
      joins: [],
    };
    await expect(check(z, save)).resolves.toBeUndefined();
  });

  it("refuses a first save that is not at revision 0", async () => {
    const z = await zone();
    const error = await refusal(check(z, { revision: 1, tables: [], joins: [] }));
    expect(error.code).toBe("floor_plan.changed");
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
        { key: "n", label: `  ${taken} `, seats: null, fixed: false, placement: null },
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
        { key: "n", label: taken, seats: null, fixed: false, placement: null },
      ],
    };
    const error = await refusal(check(z, save));
    expect(error.code).toBe("table.label_taken");
    expect(error.params).toEqual({ label: taken });
  });

  it("refuses a name a live table with no zone uses", async () => {
    const taken = fresh("Zoneless");
    await inTx(v, (tx) =>
      tx.insert(diningTables).values({ locationId: v.cfg.locationId, label: taken, zoneId: null }),
    );
    const { z, input } = await planned();
    const save: ZonePlanSave = {
      ...input,
      tables: [
        ...input.tables,
        { key: "n", label: taken, seats: null, fixed: false, placement: null },
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
        { key: "n", label: taken.toUpperCase(), seats: null, fixed: false, placement: null },
      ],
    };
    await expect(check(z, save)).resolves.toBeUndefined();
  });

  it("lets an adopted live table and a renamed master table keep their own names", async () => {
    const { z, master, spare, input } = await planned();
    const [spareRow] = await inTx(v, (tx) =>
      tx.select({ label: diningTables.label }).from(diningTables).where(eq(diningTables.id, spare)),
    );
    const save: ZonePlanSave = {
      ...input,
      tables: [
        {
          id: master,
          key: "a",
          label: input.tables[0]!.label,
          seats: 4,
          fixed: false,
          placement: null,
        },
        {
          liveTableId: spare,
          key: "b",
          label: spareRow!.label,
          seats: null,
          fixed: false,
          placement: null,
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
    ["tables.0.id", { id: "<a master id>", liveTableId: "<a live id>" }],
    ["tables.1.key", { key: "a" }],
  ])("refuses %s", async (field, patch) => {
    const { z, master, spare, input } = await planned();
    const resolved: Record<string, unknown> = { ...patch };
    if (resolved.id === "<a master id>") resolved.id = master;
    if (resolved.liveTableId === "<a live id>") resolved.liveTableId = spare;
    const entry = { ...input.tables[0]!, ...resolved } as ZonePlanSave["tables"][number];
    const tables =
      field === "tables.1.key"
        ? [input.tables[0]!, { ...entry, id: undefined, label: fresh("other") }]
        : [entry];
    const error = await refusal(check(z, { ...input, tables }));
    expect(error.code).toBe("floor_plan.invalid");
    expect(error.params).toEqual({ field });
  });

  it.each(["id", "liveTableId"] as const)("refuses one %s named twice", async (name) => {
    const { z, master, spare, input } = await planned();
    const ref = name === "id" ? master : spare;
    const entry = { key: "b", label: fresh("B"), seats: null, fixed: false, placement: null };
    const save: ZonePlanSave = {
      ...input,
      tables: [
        { ...input.tables[0]!, id: undefined, [name]: ref },
        { ...entry, [name]: ref },
      ],
    };
    const error = await refusal(check(z, save));
    expect(error.code).toBe("floor_plan.invalid");
    expect(error.params).toEqual({ field: `tables.1.${name}` });
  });

  it.each([
    ["joins.0.tableKeys", { seats: 4, tableKeys: ["a"] }],
    ["joins.0.tableKeys", { seats: 4, tableKeys: ["a", "a"] }],
    ["joins.0.tableKeys", { seats: 4, tableKeys: ["a", "nope"] }],
    ["joins.0.seats", { seats: 0, tableKeys: ["a", "b"] }],
    ["joins.0.seats", { seats: 1.5, tableKeys: ["a", "b"] }],
  ])("refuses %s of %j", async (field, join) => {
    const { z, input } = await planned();
    const save: ZonePlanSave = {
      ...input,
      tables: [
        ...input.tables,
        { key: "b", label: fresh("B"), seats: null, fixed: false, placement: null },
      ],
      joins: [join],
    };
    const error = await refusal(check(z, save));
    expect(error.code).toBe("floor_plan.invalid");
    expect(error.params).toEqual({ field });
  });

  it("refuses a join of one table", async () => {
    const { z, input } = await planned();
    const error = await refusal(check(z, { ...input, joins: [{ seats: 4, tableKeys: ["a"] }] }));
    expect(error.code).toBe("floor_plan.invalid");
    expect(error.params).toEqual({ field: "joins.0.tableKeys" });
  });

  it("refuses an id that is not a master table of this zone", async () => {
    const other = await zone();
    const [foreign] = await masterOf(other, [{ label: fresh("F") }]);
    const { z, input } = await planned();
    const save: ZonePlanSave = {
      ...input,
      tables: [
        ...input.tables,
        { id: foreign!, key: "f", label: fresh("F"), seats: null, fixed: false, placement: null },
      ],
    };
    const error = await refusal(check(z, save));
    expect(error.code).toBe("table.not_found");
    expect(error.params).toEqual({ tableId: foreign });
  });

  it.each(["followed", "inactive", "elsewhere"])(
    "refuses adopting a live table that is %s",
    async (kind) => {
      const { z, live, input } = await planned();
      let target = live;
      if (kind === "inactive") {
        target = await liveTable(z, fresh("Off"));
        await inTx(v, (tx) =>
          tx.update(diningTables).set({ active: false }).where(eq(diningTables.id, target)),
        );
      } else if (kind === "elsewhere") {
        target = await liveTable(await zone(), fresh("Away"));
      }
      const save: ZonePlanSave = {
        ...input,
        tables: [
          ...input.tables,
          {
            liveTableId: target,
            key: "b",
            label: fresh("B"),
            seats: null,
            fixed: false,
            placement: null,
          },
        ],
      };
      const error = await refusal(check(z, save));
      expect(error.code).toBe("table.not_found");
      expect(error.params).toEqual({ tableId: target });
    },
  );

  it("refuses deleting a table a module still needs", async () => {
    const { z, live, input } = await planned();
    const refuse = vi.fn<TableRemoval["refuse"]>(() => {
      throw new AppError("table.booked", { tableId: live });
    });
    const removals: TableRemoval[] = [{ refuse, release: vi.fn() }];
    const error = await refusal(check(z, { ...input, tables: [] }, removals));
    expect(error.code).toBe("table.booked");
    expect(refuse).toHaveBeenCalledWith(
      expect.anything(),
      { locationId: v.cfg.locationId },
      live,
      NOW,
    );
  });

  it("asks nothing when a deleted master table has no live table", async () => {
    const z = await zone();
    await masterOf(z, [{ label: fresh("Lone") }]);
    const refuse = vi.fn<TableRemoval["refuse"]>();
    await expect(
      check(z, { revision: 1, tables: [], joins: [] }, [{ refuse, release: vi.fn() }]),
    ).resolves.toBeUndefined();
    expect(refuse).not.toHaveBeenCalled();
  });

  it("accepts deleting a table a party sits at", async () => {
    const { z, live, input } = await planned();
    await seat(v, live);
    await expect(check(z, { ...input, tables: [] })).resolves.toBeUndefined();
  });

  it("refuses the name of this zone's never-planned table the save does not adopt", async () => {
    const { z, spare, input } = await planned();
    const [row] = await inTx(v, (tx) =>
      tx.select({ label: diningTables.label }).from(diningTables).where(eq(diningTables.id, spare)),
    );
    const save: ZonePlanSave = {
      ...input,
      tables: [
        ...input.tables,
        { key: "n", label: row!.label, seats: null, fixed: false, placement: null },
      ],
    };
    const error = await refusal(check(z, save));
    expect(error.code).toBe("table.label_taken");
    expect(error.params).toEqual({ label: row!.label });
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
        .values({ planId: plan!.id, label, seats: 4 })
        .returning({ id: floorPlanTables.id });
      return row!.id;
    });
    const save: ZonePlanSave = {
      revision: 2,
      tables: [{ id: added, key: "a", label, seats: 4, fixed: false, placement: null }],
      joins: [],
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
    const entry = { fixed: false, seats: null, placement: null, key: "k" };
    // First save: zone A's P is renamed X; its live table keeps P until the next reset.
    await expect(
      check(a, { revision: 1, tables: [{ ...entry, id: ma!, label: x }], joins: [] }),
    ).resolves.toBeUndefined();
    await inTx(v, async (tx) => {
      await tx.update(floorPlanTables).set({ label: x }).where(eq(floorPlanTables.id, ma!));
      await tx.update(floorPlans).set({ revision: 2 }).where(eq(floorPlans.zoneId, a));
    });

    const error = await refusal(
      check(b, { revision: 1, tables: [{ ...entry, id: mb!, label: p }], joins: [] }),
    );
    expect(error.code).toBe("table.label_taken");
    expect(error.params).toEqual({ label: p });
  });
});

describe("saveZonePlan", () => {
  type Entry = ZonePlanSave["tables"][number];

  function save(zoneId: string, input: ZonePlanSave) {
    return inTx(v, (tx) => saveZonePlan(tx, v.cfg, NONE, zoneId, input, NOW));
  }

  function entry(key: string, label: string, extra: Partial<Entry> = {}): Entry {
    return { key, label, seats: 4, fixed: false, placement: PLACE, ...extra };
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
    const live = await liveTable(z, t1);
    const result = await save(z, {
      revision: 0,
      tables: [
        entry("t1", t1, { liveTableId: live }),
        entry("bar", bar, {
          seats: null,
          fixed: true,
          placement: { ...PLACE, x: 20 },
        }),
      ],
      joins: [],
    });
    return { z, t1, bar, live, result };
  }

  it("saves a first plan, links the live tables and builds today's plan", async () => {
    const { z, t1, bar, live, result } = await firstSaved();

    expect(result.revision).toBe(1);
    expect(Object.keys(result.ids).sort()).toEqual(["bar", "t1"]);
    const t1Row = await tableRow(v, live);
    expect(t1Row).toMatchObject({ planTableId: result.ids.t1, planned: true, label: t1 });
    const barRow = await liveOf(result.ids.bar!);
    expect(barRow).toMatchObject({ zoneId: z, label: bar, planned: true, active: true });
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
      joins: [],
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

    await inTx(v, (tx) => resetZone(tx, v.cfg, NONE, z, NOW));

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
      joins: [],
    });

    const after = await mastersOf();
    const t1Before = before.find((row) => row.id === result.ids.t1)!;
    expect(t1Before.seats).toBe(4);
    expect(after.find((row) => row.id === result.ids.t1)).toEqual({ ...t1Before, seats: 6 });
    expect(after.find((row) => row.id === result.ids.bar)).toEqual(
      before.find((row) => row.id === result.ids.bar),
    );
  });

  it("deletes a table that is in a saved join", async () => {
    const z = await zone();
    const [l1, l2, l3] = [fresh("T1"), fresh("T2"), fresh("T3")];
    const first = await save(z, {
      revision: 0,
      tables: [entry("1", l1), entry("2", l2), entry("3", l3)],
      joins: [{ seats: 12, tableKeys: ["1", "2", "3"] }],
    });
    const { ids } = first;

    await save(z, {
      revision: 1,
      tables: [entry("1", l1, { id: ids["1"] }), entry("2", l2, { id: ids["2"] })],
      joins: [{ seats: 8, tableKeys: ["1", "2"] }],
    });

    const plan = await inTx(v, (tx) => readZonePlan(tx, v.cfg, z));
    expect(plan.tables.map((t) => t.id).sort()).toEqual([ids["1"], ids["2"]].sort());
    expect(plan.joins).toEqual([
      { id: expect.any(String) as string, seats: 8, tableIds: [ids["1"], ids["2"]].sort() },
    ]);
    const members = await inTx(v, (tx) =>
      tx.select().from(floorPlanJoinTables).where(eq(floorPlanJoinTables.planTableId, ids["3"]!)),
    );
    expect(members).toEqual([]);
  });

  it("swaps two tables' names in one save", async () => {
    const z = await zone();
    const [l1, l2] = [fresh("T1"), fresh("T2")];
    const { ids } = await save(z, {
      revision: 0,
      tables: [entry("1", l1), entry("2", l2)],
      joins: [],
    });

    await save(z, {
      revision: 1,
      tables: [entry("1", l2, { id: ids["1"] }), entry("2", l1, { id: ids["2"] })],
      joins: [],
    });

    expect(await labelsOf(z)).toEqual({ [ids["1"]!]: l2, [ids["2"]!]: l1 });
  });

  it("renames T1 to T9 and adds a new T1 in one save", async () => {
    const z = await zone();
    const [l1, l9] = [fresh("T1"), fresh("T9")];
    const { ids } = await save(z, { revision: 0, tables: [entry("1", l1)], joins: [] });

    const second = await save(z, {
      revision: 1,
      tables: [entry("1", l9, { id: ids["1"] }), entry("new", l1, { seats: 2, placement: null })],
      joins: [],
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
    const first = await save(z, { revision: 0, tables: [entry("a", a)], joins: [] });
    const aId = first.ids.a!;
    const second = await save(z, {
      revision: 1,
      tables: [entry("a", a, { id: aId }), entry("b", aId)],
      joins: [],
    });

    await save(z, {
      revision: 2,
      tables: [entry("a", renamed, { id: aId }), entry("b", aId, { id: second.ids.b })],
      joins: [],
    });

    expect(await labelsOf(z)).toEqual({ [aId]: renamed, [second.ids.b!]: aId });
  });

  it("renames a table while another table takes the renamed table's id as its new name", async () => {
    const z = await zone();
    const [a, b, renamed] = [fresh("Id B"), fresh("Id B2"), fresh("Id B3")];
    const { ids } = await save(z, {
      revision: 0,
      tables: [entry("a", a), entry("b", b)],
      joins: [],
    });

    await save(z, {
      revision: 1,
      tables: [entry("b", ids.a!, { id: ids.b }), entry("a", renamed, { id: ids.a })],
      joins: [],
    });

    expect(await labelsOf(z)).toEqual({ [ids.a!]: renamed, [ids.b!]: ids.a });
  });

  it("writes nothing when a check refuses", async () => {
    const { z, result } = await firstSaved();
    const before = await inTx(v, (tx) => readZonePlan(tx, v.cfg, z));

    const error = await refusal(
      save(z, { revision: 0, tables: [entry("t1", fresh("X"), { id: result.ids.t1 })], joins: [] }),
    );

    expect(error.code).toBe("floor_plan.changed");
    expect(await inTx(v, (tx) => readZonePlan(tx, v.cfg, z))).toEqual(before);
  });

  it("deletes a table a party sits at, and the party stays", async () => {
    const { z, t1, bar, live, result } = await firstSaved();
    const { partyId } = await seat(v, live);
    const before = await tableRow(v, live);

    const second = await save(z, {
      revision: 1,
      tables: [entry("bar", bar, { id: result.ids.bar })],
      joins: [],
    });

    expect(second.revision).toBe(2);
    expect(await tableRow(v, live)).toEqual({ ...before, planTableId: null });
    expect(before).toMatchObject({ label: t1, planned: true });
    expect(await partyAt(v, live)).toBe(partyId);
  });

  it("lets a plan that deleted a table and added one by its name be saved again", async () => {
    const { z, t1, live, result } = await firstSaved();
    const { ids } = await save(z, {
      revision: 1,
      tables: [entry("again", t1, { seats: 6 })],
      joins: [],
    });

    const third = await save(z, {
      revision: 2,
      tables: [entry("again", t1, { id: ids.again, seats: 8 })],
      joins: [],
    });

    expect(third).toEqual({ revision: 3, ids: { again: ids.again } });
    expect(await tableRow(v, live)).toMatchObject({ label: t1, planTableId: null, planned: true });
    expect(ids.again).not.toBe(result.ids.t1);
  });

  it("unlinks a pending create's reset row when its master table is deleted", async () => {
    const z = await zone();
    const name = fresh("N");
    // A planned table with no master, held by a party: the first reset must keep it, and its
    // name, so the new master table "N" can only wait as a pending create.
    const held = await liveTable(z, name);
    await inTx(v, (tx) =>
      tx.update(diningTables).set({ planned: true }).where(eq(diningTables.id, held)),
    );
    await seat(v, held);
    const { ids } = await save(z, { revision: 0, tables: [entry("n", name)], joins: [] });
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

    await expect(save(z, { revision: 1, tables: [], joins: [] })).resolves.toEqual({
      revision: 2,
      ids: {},
    });

    expect(await pending()).toEqual([
      expect.objectContaining({ planTableId: null, pending: true, label: name }),
    ]);
  });
});
