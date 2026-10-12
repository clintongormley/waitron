import { and, asc, eq, getTableColumns, inArray, ne } from "drizzle-orm";
import {
  diningTables,
  floorPlans,
  floorPlanTableParts,
  floorPlanTables,
  floorResetTables,
  floorTodayZones,
  floorZones,
  newId,
  type Transaction,
} from "@waitron/db";
import type { TableRemoval } from "@waitron/module";
import { AppError } from "@waitron/shared";
import type { Placement } from "./floor-reset-plan.js";
import { placementColumns, placementOf, resetZone, spareLabels } from "./floor-today-store.js";
import { refusedByAModule } from "./table-removal.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

export interface PlanTable {
  id: string;
  liveTableId: string | null;
  label: string;
  seats: number | null;
  fixed: boolean;
  placement: Placement | null;
  /** A joined table's parts, in label order; empty for any other table. */
  partIds: string[];
}

export interface ZonePlan {
  zoneId: string;
  /** 0 when the zone has no master plan. */
  revision: number;
  savedAt: string | null;
  tables: PlanTable[];
}

export interface ZonePlanSave {
  /** The copy's revision; 0 when the zone had no master plan. */
  revision: number;
  tables: {
    id?: string;
    key: string;
    label: string;
    seats: number | null;
    fixed: boolean;
    placement: Placement | null;
    /** The save keys of a joined table's parts. */
    partKeys: string[];
  }[];
}

export async function requireZone(tx: Transaction, cfg: TillConfig, zoneId: string): Promise<void> {
  const [zone] = await tx
    .select({ id: floorZones.id })
    .from(floorZones)
    .where(
      and(
        eq(floorZones.id, zoneId),
        eq(floorZones.locationId, cfg.locationId),
        eq(floorZones.active, true),
      ),
    );
  if (zone === undefined) throw new AppError("zone.not_found", { zoneId });
}

async function planOf(tx: Transaction, zoneId: string) {
  const [plan] = await tx
    .select({ id: floorPlans.id, revision: floorPlans.revision, savedAt: floorPlans.savedAt })
    .from(floorPlans)
    .where(eq(floorPlans.zoneId, zoneId));
  return plan;
}

async function mastersOf(tx: Transaction, planId: string) {
  return tx
    .select({ ...getTableColumns(floorPlanTables), partOf: floorPlanTableParts.joinedTableId })
    .from(floorPlanTables)
    .leftJoin(floorPlanTableParts, eq(floorPlanTableParts.partTableId, floorPlanTables.id))
    .where(eq(floorPlanTables.planId, planId))
    .orderBy(asc(floorPlanTables.label));
}

/** Each master table's live table, for the masters that have one. */
async function followersOf(tx: Transaction, masterIds: string[]): Promise<Map<string, string>> {
  if (masterIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: diningTables.id, planTableId: diningTables.planTableId })
    .from(diningTables)
    .where(inArray(diningTables.planTableId, masterIds));
  return new Map(rows.map((row) => [row.planTableId!, row.id]));
}

export async function readZonePlan(
  tx: Transaction,
  cfg: TillConfig,
  zoneId: string,
): Promise<ZonePlan> {
  await requireZone(tx, cfg, zoneId);
  const plan = await planOf(tx, zoneId);
  const tables: PlanTable[] = [];
  if (plan !== undefined) {
    const masters = await mastersOf(tx, plan.id);
    const followers = await followersOf(
      tx,
      masters.map((m) => m.id),
    );
    const byJoined = new Map<string, string[]>();
    for (const m of masters) {
      if (m.partOf === null) continue;
      const parts = byJoined.get(m.partOf);
      if (parts === undefined) byJoined.set(m.partOf, [m.id]);
      else parts.push(m.id);
    }
    for (const master of masters) {
      tables.push({
        id: master.id,
        liveTableId: followers.get(master.id) ?? null,
        label: master.label,
        seats: master.seats,
        fixed: master.fixed,
        placement: placementOf(master),
        partIds: byJoined.get(master.id) ?? [],
      });
    }
  }
  return {
    zoneId,
    revision: plan?.revision ?? 0,
    savedAt: plan?.savedAt ?? null,
    tables,
  };
}

function invalid(field: string): AppError {
  return new AppError("floor_plan.invalid", { field });
}

function wholeIn(value: unknown, low: number, high: number): boolean {
  return Number.isInteger(value) && (value as number) >= low && (value as number) <= high;
}

/** The ranges `floor_plan_tables`' checks hold. */
function checkPlacement(placement: Placement, at: string): void {
  const ranges: [keyof Placement, number, number][] = [
    ["x", 0, 999],
    ["y", 0, 999],
    ["width", 1, 99],
    ["height", 1, 99],
  ];
  for (const [name, low, high] of ranges) {
    if (!wholeIn(placement[name], low, high)) throw invalid(`${at}.placement.${name}`);
  }
  if (placement.shape !== "rect" && placement.shape !== "round") {
    throw invalid(`${at}.placement.shape`);
  }
  if (!wholeIn(placement.rotation, 0, 345) || placement.rotation % 15 !== 0) {
    throw invalid(`${at}.placement.rotation`);
  }
}

function checkEntries(input: ZonePlanSave): void {
  const keys = new Set<string>();
  const ids = new Set<string>();
  input.tables.forEach((table, index) => {
    const at = `tables.${index}`;
    if (keys.has(table.key)) throw invalid(`${at}.key`);
    keys.add(table.key);
    if (typeof table.label !== "string" || table.label.trim() === "") throw invalid(`${at}.label`);
    if (table.seats !== null && !wholeIn(table.seats, 0, 999)) throw invalid(`${at}.seats`);
    if (table.placement !== null) checkPlacement(table.placement, at);
    const ref = table.id;
    if (ref !== undefined) {
      if (ids.has(ref)) throw invalid(`${at}.id`);
      ids.add(ref);
    }
  });
  checkParts(input.tables);
}

function checkParts(tables: ZonePlanSave["tables"]): void {
  const byKey = new Map(tables.map((table) => [table.key, table]));
  const claimed = new Set<string>();
  tables.forEach((table, index) => {
    if (table.partKeys.length === 0) return;
    const at = `tables.${index}.partKeys`;
    // An entry with no partKeys is a plain table, so a joined table stripped of every part
    // saves as a plain one; the editor refuses that before sending.
    if (table.partKeys.length < 2) throw invalid(at);
    for (const key of table.partKeys) {
      const part = byKey.get(key);
      if (part === undefined) throw invalid(at);
      if (part.placement !== null) throw invalid(at);
      if (part.partKeys.length > 0) throw invalid(at);
      if (claimed.has(key)) throw invalid(at);
      claimed.add(key);
    }
    if (table.seats === null || table.seats < 1) throw invalid(`tables.${index}.seats`);
  });
}

async function namesTaken(tx: Transaction, cfg: TillConfig, zoneId: string): Promise<Set<string>> {
  const masters = await tx
    .select({ label: floorPlanTables.label })
    .from(floorPlanTables)
    .innerJoin(floorPlans, eq(floorPlans.id, floorPlanTables.planId))
    .innerJoin(floorZones, eq(floorZones.id, floorPlans.zoneId))
    .where(and(eq(floorZones.locationId, cfg.locationId), ne(floorPlans.zoneId, zoneId)));
  const live = await tx
    .select({ label: diningTables.label })
    .from(diningTables)
    .where(and(eq(diningTables.locationId, cfg.locationId), ne(diningTables.zoneId, zoneId)));
  return new Set([...masters.map((m) => m.label), ...live.map((t) => t.label)]);
}

type MasterRow = typeof floorPlanTables.$inferSelect;

/** What a passed check read, for the save to reuse. */
interface CheckedZonePlanSave {
  plan: Awaited<ReturnType<typeof planOf>>;
  /** The plan's tables, by label. */
  masters: MasterRow[];
  tables: ZonePlanSave["tables"];
}

export async function checkZonePlanSave(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  zoneId: string,
  input: ZonePlanSave,
  now: Date = new Date(),
): Promise<void> {
  await checkSave(tx, cfg, removals, zoneId, input, now);
}

async function checkSave(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  zoneId: string,
  input: ZonePlanSave,
  now: Date,
): Promise<CheckedZonePlanSave> {
  await requireZone(tx, cfg, zoneId);
  const plan = await planOf(tx, zoneId);
  const revision = plan?.revision ?? 0;
  if (input.revision !== revision) {
    throw new AppError("floor_plan.out_of_date", { zoneId, revision });
  }
  const masters = plan === undefined ? [] : await mastersOf(tx, plan.id);
  const masterIds = new Set(masters.map((m) => m.id));
  const followers = await followersOf(tx, [
    ...new Set([...masterIds, ...input.tables.flatMap((t) => t.id ?? [])]),
  ]);
  const tables = input.tables;
  checkEntries(input);
  for (const table of tables) {
    if (table.id !== undefined && !masterIds.has(table.id)) {
      throw new AppError("table.not_found", { tableId: table.id });
    }
  }

  const taken = await namesTaken(tx, cfg, zoneId);
  const seen = new Set<string>();
  for (const table of tables) {
    const label = table.label.trim();
    if (seen.has(label) || taken.has(label)) throw new AppError("table.label_taken", { label });
    seen.add(label);
  }

  const kept = new Set(tables.map((t) => t.id));
  const liveIds = masters.flatMap((m) => (kept.has(m.id) ? [] : (followers.get(m.id) ?? [])));
  const refusals = await refusedByAModule(tx, cfg, removals, liveIds, now);
  for (const liveId of liveIds) {
    const refusal = refusals.get(liveId);
    if (refusal !== undefined) throw refusal;
  }
  return { plan, masters, tables };
}

function masterColumns(table: ZonePlanSave["tables"][number]) {
  return { seats: table.seats, fixed: table.fixed, ...placementColumns(table.placement) };
}

/**
 * Writes a checked save to the master plan; nothing live changes until the zone's next reset,
 * except on the zone's first save, which builds today's plan at once (decision 16).
 */
export async function saveZonePlan(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  zoneId: string,
  input: ZonePlanSave,
  now: Date = new Date(),
): Promise<{ revision: number; ids: Record<string, string> }> {
  const checked = await checkSave(tx, cfg, removals, zoneId, input, now);
  const { masters, tables } = checked;
  const savedAt = now.toISOString();
  let plan = checked.plan;
  if (plan === undefined) {
    [plan] = await tx
      .insert(floorPlans)
      .values({ zoneId, revision: 0, savedAt })
      .returning({ id: floorPlans.id, revision: floorPlans.revision, savedAt: floorPlans.savedAt });
  }
  const planId = plan!.id;

  await tx
    .delete(floorPlanTableParts)
    .where(
      inArray(
        floorPlanTableParts.joinedTableId,
        tx
          .select({ id: floorPlanTables.id })
          .from(floorPlanTables)
          .where(eq(floorPlanTables.planId, planId)),
      ),
    );

  const kept = new Set(tables.flatMap((t) => (t.id === undefined ? [] : [t.id])));
  const deleted = masters.filter((m) => !kept.has(m.id)).map((m) => m.id);
  if (deleted.length > 0) {
    await tx
      .update(diningTables)
      .set({ planTableId: null })
      .where(inArray(diningTables.planTableId, deleted));
    await tx
      .update(floorResetTables)
      .set({ planTableId: null })
      .where(inArray(floorResetTables.planTableId, deleted));
    await tx.delete(floorPlanTables).where(inArray(floorPlanTables.id, deleted));
  }

  // Each renamed table first steps aside under a spare name, so a swap or a rename onto a name
  // another row is giving up never meets the unique (plan_id, label) key halfway.
  const masterOf = new Map(masters.map((m) => [m.id, m]));
  const spare = spareLabels(
    tables.flatMap((t) =>
      t.id !== undefined && masterOf.get(t.id)!.label !== t.label.trim() ? [t.id] : [],
    ),
    new Set([...masters.map((m) => m.label), ...tables.map((t) => t.label.trim())]),
  );
  for (const [id, label] of spare) {
    await tx.update(floorPlanTables).set({ label }).where(eq(floorPlanTables.id, id));
  }
  // A Map, because a draft key is any string: on a plain object `__proto__` sets the prototype.
  const ids = new Map<string, string>();
  const created: (typeof floorPlanTables.$inferInsert)[] = [];
  for (const table of tables) {
    const id = table.id ?? newId();
    ids.set(table.key, id);
    if (table.id === undefined) {
      created.push({ id, planId, label: table.label.trim(), ...masterColumns(table) });
    }
  }
  if (created.length > 0) await tx.insert(floorPlanTables).values(created);
  for (const table of tables) {
    if (table.id === undefined) continue;
    const next = { label: table.label.trim(), ...masterColumns(table) };
    const current = masterOf.get(table.id)!;
    if ((Object.keys(next) as (keyof typeof next)[]).every((k) => current[k] === next[k])) continue;
    await tx.update(floorPlanTables).set(next).where(eq(floorPlanTables.id, table.id));
  }
  const parts = tables.flatMap((table) =>
    table.partKeys.map((key) => ({
      joinedTableId: ids.get(table.key)!,
      partTableId: ids.get(key)!,
    })),
  );
  if (parts.length > 0) await tx.insert(floorPlanTableParts).values(parts);

  const revision = plan!.revision + 1;
  await tx.update(floorPlans).set({ revision, savedAt }).where(eq(floorPlans.id, planId));

  const [today] = await tx
    .select({ id: floorTodayZones.id })
    .from(floorTodayZones)
    .where(eq(floorTodayZones.zoneId, zoneId));
  if (today === undefined) await resetZone(tx, cfg, removals, zoneId, now);
  return { revision, ids: Object.fromEntries(ids) };
}
