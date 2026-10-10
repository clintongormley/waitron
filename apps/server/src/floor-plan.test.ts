import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  diningTables,
  floorPlanJoins,
  floorPlanJoinTables,
  floorPlans,
  floorPlanTables,
  floorZones,
} from "@waitron/db";
import type { TableRemoval } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { zoneSalePolicies, zoneServicePolicies } from "@waitron/venue-service";
import { checkZonePlanSave, readZonePlan, type ZonePlanSave } from "./floor-plan.js";
import { inTx, seat, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
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
});
