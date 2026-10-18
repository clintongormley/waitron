import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { floorPlanPlacements, floorPlans, floorPlanSets, floorPlanTables } from "@waitron/db";
import type { TableRemoval } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { createDepartment, createServiceZone, linkFloorPlanSet } from "@waitron/venue-service";
import { readLayout, saveLayout, type ZonePlan, type ZonePlanSave } from "./floor-plan.js";
import { inTx, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
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

function fresh(label: string): string {
  return `${label}-${randomUUID().slice(0, 6)}`;
}

/** A department with zone Inside and sets Standard (its default) and Dinner, plus a zone elsewhere. */
async function department() {
  return inTx(v, async (tx) => {
    const dept = await createDepartment(tx, v.cfg, { name: fresh("Dept"), orderStart: "table" });
    const other = await createDepartment(tx, v.cfg, { name: fresh("Other"), orderStart: "table" });
    const inside = await createServiceZone(tx, v.cfg, {
      name: fresh("Inside"),
      departmentId: dept.id,
    });
    const elsewhere = await createServiceZone(tx, v.cfg, {
      name: fresh("Terrace"),
      departmentId: other.id,
    });
    const sets: Record<"standard" | "dinner", string> = { standard: "", dinner: "" };
    for (const [key, name] of [
      ["standard", "Standard"],
      ["dinner", "Dinner"],
    ] as const) {
      const [row] = await tx
        .insert(floorPlanSets)
        .values({ locationId: v.cfg.locationId })
        .returning({ id: floorPlanSets.id });
      await linkFloorPlanSet(tx, v.cfg, { setId: row!.id, departmentId: dept.id, name });
      sets[key] = row!.id;
    }
    return { zoneId: inside.id, elsewhere: elsewhere.id, ...sets };
  });
}

function entry(key: string, label: string, extra: Partial<SaveEntry> = {}): SaveEntry {
  return { key, label, seats: 4, fixed: false, placement: PLACE, partKeys: [], ...extra };
}

function read(setId: string, zoneId: string): Promise<ZonePlan> {
  return inTx(v, (tx) => readLayout(tx, v.cfg, { setId, zoneId }));
}

function save(setId: string, zoneId: string, input: ZonePlanSave) {
  return inTx(v, (tx) => saveLayout(tx, v.cfg, NONE, { setId, zoneId }, input, NOW));
}

/** The saved entries again, as the editor would send them back after a read. */
function asSaved(plan: ZonePlan): SaveEntry[] {
  const keyOf = new Map(plan.tables.map((t) => [t.id, t.id]));
  return plan.tables.map((t) => ({
    id: t.id,
    key: t.id,
    label: t.label,
    seats: t.seats,
    fixed: t.fixed,
    placement: t.placement,
    partKeys: t.partIds.map((id) => keyOf.get(id)!),
  }));
}

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

async function revisionOf(setId: string, zoneId: string): Promise<number | undefined> {
  const [row] = await inTx(v, (tx) =>
    tx
      .select({ revision: floorPlans.revision })
      .from(floorPlans)
      .where(and(eq(floorPlans.setId, setId), eq(floorPlans.zoneId, zoneId))),
  );
  return row?.revision;
}

describe("a set's layout of a zone", () => {
  it("shares tables and keeps places per set", async () => {
    const d = await department();
    const labels = [fresh("1"), fresh("2"), fresh("3")];
    const { ids } = await save(d.standard, d.zoneId, {
      revision: 0,
      tables: labels.map((label, i) => entry(`t${i}`, label)),
    });

    const dinner = await read(d.dinner, d.zoneId);

    expect(dinner.tables.map((t) => t.id).sort()).toEqual(Object.values(ids).sort());
    expect(dinner.tables.map((t) => t.placement)).toEqual([null, null, null]);
    // Standard's first save added tables, which moves Dinner's layout too (decision 2).
    expect(dinner.revision).toBe(1);
    const standard = await read(d.standard, d.zoneId);
    expect(standard.tables.map((t) => t.placement)).toEqual([PLACE, PLACE, PLACE]);
  });

  it("moves only its own layout for a move", async () => {
    const d = await department();
    await save(d.standard, d.zoneId, {
      revision: 0,
      tables: [entry("a", fresh("1")), entry("b", fresh("2"))],
    });
    const dinner = await read(d.dinner, d.zoneId);
    const moved = asSaved(dinner).map((t, i) =>
      i === 0 ? { ...t, placement: { ...PLACE, x: 30 } } : t,
    );

    const saved = await save(d.dinner, d.zoneId, { revision: dinner.revision, tables: moved });

    expect(saved.revision).toBe(dinner.revision + 1);
    expect(await revisionOf(d.standard, d.zoneId)).toBe(1);
    expect((await read(d.standard, d.zoneId)).tables[0]!.placement).toEqual(PLACE);
    expect((await read(d.dinner, d.zoneId)).tables[0]!.placement).toEqual({ ...PLACE, x: 30 });
  });

  it("moves every layout of the department for a shared change", async () => {
    const d = await department();
    expect(await revisionOf(d.standard, d.zoneId)).toBeUndefined();

    await save(d.dinner, d.zoneId, { revision: 0, tables: [entry("four", fresh("4"))] });

    expect(await revisionOf(d.dinner, d.zoneId)).toBe(1);
    expect(await revisionOf(d.standard, d.zoneId)).toBe(1);
    const standard = await read(d.standard, d.zoneId);
    expect(standard.revision).toBe(1);
    expect(standard.tables.map((t) => t.placement)).toEqual([null]);

    const renamed = asSaved(standard).map((t) => ({ ...t, label: fresh("Four") }));
    await save(d.standard, d.zoneId, { revision: 1, tables: renamed });
    expect(await revisionOf(d.standard, d.zoneId)).toBe(2);
    expect(await revisionOf(d.dinner, d.zoneId)).toBe(2);
  });

  it.each<[string, (t: SaveEntry) => SaveEntry]>([
    ["seats", (t) => (t.key === "a" ? { ...t, seats: 6 } : t)],
    ["Moveable", (t) => (t.key === "a" ? { ...t, fixed: true } : t)],
    ["parts", (t) => (t.key === "joined" ? { ...t, partKeys: ["a", "c"] } : t)],
  ])("moves every layout of the department for a change of %s", async (_, change) => {
    const d = await department();
    const { ids } = await save(d.standard, d.zoneId, {
      revision: 0,
      tables: [
        entry("a", fresh("1"), { placement: null }),
        entry("b", fresh("2"), { placement: null }),
        entry("c", fresh("3"), { placement: null }),
        entry("joined", fresh("1+2"), { seats: 8, partKeys: ["a", "b"] }),
      ],
    });
    const keyOf = new Map(Object.entries(ids).map(([key, id]) => [id, key]));
    const dinner = await read(d.dinner, d.zoneId);
    const draft = asSaved(dinner).map((t) => ({
      ...t,
      key: keyOf.get(t.id!)!,
      partKeys: t.partKeys.map((id) => keyOf.get(id)!),
    }));

    await save(d.dinner, d.zoneId, { revision: dinner.revision, tables: draft.map(change) });

    expect(await revisionOf(d.standard, d.zoneId)).toBe(2);
  });

  it("refuses a stale save from another set's editor", async () => {
    const d = await department();
    await save(d.standard, d.zoneId, { revision: 0, tables: [entry("one", fresh("1"))] });
    const standardDraft = await read(d.standard, d.zoneId);
    const dinner = await read(d.dinner, d.zoneId);
    const thirteen = fresh("13");
    const { ids } = await save(d.dinner, d.zoneId, {
      revision: dinner.revision,
      tables: [...asSaved(dinner), entry("thirteen", thirteen)],
    });

    const error = await refusal(
      save(d.standard, d.zoneId, {
        revision: standardDraft.revision,
        tables: asSaved(standardDraft),
      }),
    );

    expect(error.code).toBe("floor_plan.out_of_date");
    const tables = await inTx(v, (tx) =>
      tx
        .select({ id: floorPlanTables.id })
        .from(floorPlanTables)
        .where(eq(floorPlanTables.id, ids.thirteen!)),
    );
    expect(tables).toEqual([{ id: ids.thirteen }]);
  });

  it("deletes a deleted table's places in every layout of the zone", async () => {
    const d = await department();
    const { ids } = await save(d.standard, d.zoneId, {
      revision: 0,
      tables: [entry("a", fresh("1")), entry("b", fresh("2"))],
    });
    const dinner = await read(d.dinner, d.zoneId);
    await save(d.dinner, d.zoneId, {
      revision: dinner.revision,
      tables: asSaved(dinner).map((t) => ({ ...t, placement: { ...PLACE, x: 40 } })),
    });
    const standard = await read(d.standard, d.zoneId);

    await save(d.standard, d.zoneId, {
      revision: standard.revision,
      tables: asSaved(standard).filter((t) => t.id !== ids.b),
    });

    const left = await inTx(v, (tx) =>
      tx
        .select({ id: floorPlanPlacements.id })
        .from(floorPlanPlacements)
        .where(inArray(floorPlanPlacements.planTableId, [ids.b!])),
    );
    expect(left).toEqual([]);
    expect((await read(d.dinner, d.zoneId)).tables.map((t) => t.id)).toEqual([ids.a]);
  });

  it("lets a layout stand a joined table's parts while it leaves the joined table off", async () => {
    const d = await department();
    const tables = [
      entry("four", fresh("4")),
      entry("five", fresh("5"), { placement: { ...PLACE, x: 20 } }),
      entry("joined", fresh("4+5"), { seats: 8, placement: null, partKeys: ["four", "five"] }),
    ];
    const { ids } = await save(d.standard, d.zoneId, { revision: 0, tables });
    expect(
      (await read(d.standard, d.zoneId)).tables.find((t) => t.id === ids.four)!.placement,
    ).toEqual(PLACE);

    const dinner = await read(d.dinner, d.zoneId);
    const draft = asSaved(dinner).map((t) =>
      t.id === ids.joined || t.id === ids.four ? { ...t, placement: PLACE } : t,
    );
    const error = await refusal(
      save(d.dinner, d.zoneId, { revision: dinner.revision, tables: draft }),
    );

    expect({ code: error.code, params: error.params }).toEqual({
      code: "floor_plan.invalid",
      params: { field: `tables.${draft.findIndex((t) => t.id === ids.joined)}.partKeys` },
    });
  });

  it("reads a part as off in a layout that places its joined table", async () => {
    const d = await department();
    const { ids } = await save(d.dinner, d.zoneId, {
      revision: 0,
      tables: [
        entry("four", fresh("4"), { placement: null }),
        entry("five", fresh("5"), { placement: null }),
        entry("joined", fresh("4+5"), { seats: 8, partKeys: ["four", "five"] }),
      ],
    });
    await inTx(v, async (tx) => {
      const [plan] = await tx
        .select({ id: floorPlans.id })
        .from(floorPlans)
        .where(and(eq(floorPlans.setId, d.dinner), eq(floorPlans.zoneId, d.zoneId)));
      await tx
        .insert(floorPlanPlacements)
        .values({ planId: plan!.id, planTableId: ids.four!, ...PLACE, x: 50 });
    });

    const dinner = await read(d.dinner, d.zoneId);

    expect(dinner.tables.find((t) => t.id === ids.four)!.placement).toBeNull();
    expect(dinner.tables.find((t) => t.id === ids.joined)!.placement).toEqual(PLACE);
  });

  it("refuses a zone outside the set's department", async () => {
    const d = await department();
    const expected = { code: "floor_plan_set.invalid", params: { field: "zoneId" } };

    const onRead = await refusal(read(d.dinner, d.elsewhere));
    const onSave = await refusal(save(d.dinner, d.elsewhere, { revision: 0, tables: [] }));

    expect({ code: onRead.code, params: onRead.params }).toEqual(expected);
    expect({ code: onSave.code, params: onSave.params }).toEqual(expected);
  });

  it("refuses an unknown set", async () => {
    const d = await department();
    const setId = randomUUID();
    const expected = { code: "floor_plan_set.not_found", params: { setId } };

    const onRead = await refusal(read(setId, d.zoneId));
    const onSave = await refusal(save(setId, d.zoneId, { revision: 0, tables: [] }));

    expect({ code: onRead.code, params: onRead.params }).toEqual(expected);
    expect({ code: onSave.code, params: onSave.params }).toEqual(expected);
  });

  it("answers the set's name", async () => {
    const d = await department();

    const dinner = await read(d.dinner, d.zoneId);

    expect(dinner).toMatchObject({ setId: d.dinner, setName: "Dinner", zoneId: d.zoneId });
  });
});
