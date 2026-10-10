import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  diningTables,
  floorPlanJoins,
  floorPlanJoinTables,
  floorPlans,
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
  /** The master table; null for a live table offered for adoption. */
  id: string | null;
  liveTableId: string | null;
  label: string;
  seats: number | null;
  fixed: boolean;
  placement: Placement | null;
}

export interface PlanJoin {
  id: string;
  seats: number;
  tableIds: string[];
}

export interface ZonePlan {
  zoneId: string;
  /** 0 when the zone has no master plan. */
  revision: number;
  savedAt: string | null;
  tables: PlanTable[];
  joins: PlanJoin[];
}

export interface ZonePlanSave {
  /** The copy's revision; 0 when the zone had no master plan. */
  revision: number;
  tables: {
    id?: string;
    liveTableId?: string;
    key: string;
    label: string;
    seats: number | null;
    fixed: boolean;
    placement: Placement | null;
  }[];
  joins: { seats: number; tableKeys: string[] }[];
}

async function requireZone(tx: Transaction, cfg: TillConfig, zoneId: string): Promise<void> {
  const [zone] = await tx
    .select({ id: floorZones.id })
    .from(floorZones)
    .where(and(eq(floorZones.id, zoneId), eq(floorZones.locationId, cfg.locationId)));
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
    .select()
    .from(floorPlanTables)
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

/** The zone's active live tables that follow no master table and never did. */
async function adoptableOf(tx: Transaction, cfg: TillConfig, zoneId: string) {
  return tx
    .select({ id: diningTables.id, label: diningTables.label, capacity: diningTables.capacity })
    .from(diningTables)
    .where(
      and(
        eq(diningTables.locationId, cfg.locationId),
        eq(diningTables.zoneId, zoneId),
        eq(diningTables.active, true),
        isNull(diningTables.planTableId),
        eq(diningTables.planned, false),
      ),
    )
    .orderBy(asc(diningTables.label));
}

/** The zone's master plan for the editor, with the live tables it could adopt (decision 16). */
export async function readZonePlan(
  tx: Transaction,
  cfg: TillConfig,
  zoneId: string,
): Promise<ZonePlan> {
  await requireZone(tx, cfg, zoneId);
  const plan = await planOf(tx, zoneId);
  const tables: PlanTable[] = [];
  const joins: PlanJoin[] = [];
  if (plan !== undefined) {
    const masters = await mastersOf(tx, plan.id);
    const followers = await followersOf(
      tx,
      masters.map((m) => m.id),
    );
    for (const master of masters) {
      tables.push({
        id: master.id,
        liveTableId: followers.get(master.id) ?? null,
        label: master.label,
        seats: master.seats,
        fixed: master.fixed,
        placement: placementOf(master),
      });
    }
    const joinRows = await tx
      .select({ id: floorPlanJoins.id, seats: floorPlanJoins.seats })
      .from(floorPlanJoins)
      .where(eq(floorPlanJoins.planId, plan.id))
      .orderBy(asc(floorPlanJoins.id));
    const membersOf = new Map(joinRows.map((join) => [join.id, [] as string[]]));
    if (joinRows.length > 0) {
      const members = await tx
        .select({ joinId: floorPlanJoinTables.joinId, tableId: floorPlanJoinTables.planTableId })
        .from(floorPlanJoinTables)
        .where(inArray(floorPlanJoinTables.joinId, [...membersOf.keys()]))
        .orderBy(asc(floorPlanJoinTables.planTableId));
      for (const member of members) membersOf.get(member.joinId)!.push(member.tableId);
    }
    for (const join of joinRows) {
      joins.push({ id: join.id, seats: join.seats, tableIds: membersOf.get(join.id)! });
    }
  }
  for (const live of await adoptableOf(tx, cfg, zoneId)) {
    tables.push({
      id: null,
      liveTableId: live.id,
      label: live.label,
      seats: live.capacity,
      fixed: false,
      placement: null,
    });
  }
  return {
    zoneId,
    revision: plan?.revision ?? 0,
    savedAt: plan?.savedAt ?? null,
    tables,
    joins,
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
    if (table.id !== undefined && table.liveTableId !== undefined) throw invalid(`${at}.id`);
    const ref = table.id ?? table.liveTableId;
    if (ref !== undefined) {
      if (ids.has(ref)) throw invalid(`${at}.${table.id === undefined ? "liveTableId" : "id"}`);
      ids.add(ref);
    }
  });
  input.joins.forEach((join, index) => {
    const at = `joins.${index}`;
    const members = new Set(join.tableKeys);
    if (
      members.size < 2 ||
      members.size !== join.tableKeys.length ||
      join.tableKeys.some((key) => !keys.has(key))
    ) {
      throw invalid(`${at}.tableKeys`);
    }
    if (!Number.isInteger(join.seats) || join.seats < 1) throw invalid(`${at}.seats`);
  });
}

/**
 * Names a table of this save may not take: other zones' master names, every live table's name in
 * another zone, and this zone's never-planned tables the save does not adopt. This zone's planned
 * tables do not count: its own reset frees their names, a removed table's once its removal succeeds.
 */
async function namesTaken(
  tx: Transaction,
  cfg: TillConfig,
  zoneId: string,
  adopted: ReadonlySet<string>,
): Promise<Set<string>> {
  const masters = await tx
    .select({ label: floorPlanTables.label })
    .from(floorPlanTables)
    .innerJoin(floorPlans, eq(floorPlans.id, floorPlanTables.planId))
    .innerJoin(floorZones, eq(floorZones.id, floorPlans.zoneId))
    .where(and(eq(floorZones.locationId, cfg.locationId), ne(floorPlans.zoneId, zoneId)));
  const live = await tx
    .select({
      id: diningTables.id,
      label: diningTables.label,
      zoneId: diningTables.zoneId,
      planned: diningTables.planned,
    })
    .from(diningTables)
    .where(eq(diningTables.locationId, cfg.locationId));
  const blocking = live.filter((t) =>
    t.zoneId === zoneId ? !t.planned && !adopted.has(t.id) : true,
  );
  return new Set([...masters.map((m) => m.label), ...blocking.map((t) => t.label)]);
}

type MasterRow = typeof floorPlanTables.$inferSelect;

/** What a passed check read, for the save to reuse. */
interface CheckedZonePlanSave {
  plan: Awaited<ReturnType<typeof planOf>>;
  /** The plan's tables, by label. */
  masters: MasterRow[];
  /** The save's tables, each master entry's `liveTableId` dropped when it names that table's own live table. */
  tables: ZonePlanSave["tables"];
}

/**
 * Every check of a save; throws the first refusal, writes nothing. Labels compare by exact
 * characters, as the `dining_tables` and `floor_plan_tables` unique keys do (plain `text`, the
 * engine's default binary collation). A master entry may carry its own live table, as
 * `readZonePlan` sends it; that is not an adoption.
 */
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
  const tables = input.tables.map(({ liveTableId, ...table }): ZonePlanSave["tables"][number] =>
    table.id !== undefined && liveTableId === followers.get(table.id)
      ? table
      : { ...table, ...(liveTableId === undefined ? {} : { liveTableId }) },
  );
  checkEntries({ ...input, tables });

  const adoptable = new Set((await adoptableOf(tx, cfg, zoneId)).map((t) => t.id));
  const adopted = new Set<string>();
  for (const table of tables) {
    if (table.id !== undefined && !masterIds.has(table.id)) {
      throw new AppError("table.not_found", { tableId: table.id });
    }
    if (table.liveTableId !== undefined) {
      if (!adoptable.has(table.liveTableId)) {
        throw new AppError("table.not_found", { tableId: table.liveTableId });
      }
      adopted.add(table.liveTableId);
    }
  }

  const taken = await namesTaken(tx, cfg, zoneId, adopted);
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

  // A member row points at a master table, so the joins go before any master table can.
  const joins = await tx
    .select({ id: floorPlanJoins.id })
    .from(floorPlanJoins)
    .where(eq(floorPlanJoins.planId, planId));
  const joinIds = joins.map((j) => j.id);
  if (joinIds.length > 0) {
    await tx.delete(floorPlanJoinTables).where(inArray(floorPlanJoinTables.joinId, joinIds));
    await tx.delete(floorPlanJoins).where(inArray(floorPlanJoins.id, joinIds));
  }

  const kept = new Set(tables.flatMap((t) => (t.id === undefined ? [] : [t.id])));
  const deleted = masters.filter((m) => !kept.has(m.id)).map((m) => m.id);
  if (deleted.length > 0) {
    // `planned` stays true, so the next reset removes the live table.
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

  if (input.joins.length > 0) {
    const joinRows = input.joins.map((join) => ({ id: newId(), planId, seats: join.seats }));
    await tx.insert(floorPlanJoins).values(joinRows);
    await tx
      .insert(floorPlanJoinTables)
      .values(
        input.joins.flatMap((join, i) =>
          join.tableKeys.map((key) => ({ joinId: joinRows[i]!.id, planTableId: ids.get(key)! })),
        ),
      );
  }

  for (const table of tables) {
    if (table.liveTableId === undefined) continue;
    await tx
      .update(diningTables)
      .set({ planTableId: ids.get(table.key)!, planned: true })
      .where(eq(diningTables.id, table.liveTableId));
  }

  const revision = plan!.revision + 1;
  await tx.update(floorPlans).set({ revision, savedAt }).where(eq(floorPlans.id, planId));

  const [today] = await tx
    .select({ id: floorTodayZones.id })
    .from(floorTodayZones)
    .where(eq(floorTodayZones.zoneId, zoneId));
  if (today === undefined) await resetZone(tx, cfg, removals, zoneId, now);
  return { revision, ids: Object.fromEntries(ids) };
}
