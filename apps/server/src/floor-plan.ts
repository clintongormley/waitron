import { and, asc, eq, getTableColumns, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  diningTables,
  floorPlanPlacements,
  floorPlans,
  floorPlanTableParts,
  floorPlanTables,
  floorPlanTableSizes,
  floorResetTables,
  floorTodayZones,
  floorZones,
  newId,
  type Transaction,
} from "@waitron/db";
import type { FloorPlanSetSummary, TableRemoval } from "@waitron/module";
import { AppError } from "@waitron/shared";
import type { Placement } from "./floor-reset-plan.js";
import { placementOf, resetZone, spareLabels } from "./floor-today-store.js";
import { VENUE_SERVICE } from "./modules.js";
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
  /** The size the table last had on the plan, kept by the save while it is off the plan. */
  keptSize: { width: number; height: number } | null;
  /** A joined table's parts, in label order; empty for any other table. */
  partIds: string[];
}

export interface LayoutRef {
  setId: string;
  zoneId: string;
}

export interface ZonePlan {
  zoneId: string;
  setId: string;
  setName: string;
  /** 0 when the set has no layout of the zone yet. */
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

async function planOf(tx: Transaction, at: LayoutRef) {
  const [plan] = await tx
    .select({ id: floorPlans.id, revision: floorPlans.revision, savedAt: floorPlans.savedAt })
    .from(floorPlans)
    .where(and(eq(floorPlans.zoneId, at.zoneId), eq(floorPlans.setId, at.setId)));
  return plan;
}

/** The set, refused when it is unknown or its department does not hold the zone. */
async function requireSetOf(
  tx: Transaction,
  cfg: TillConfig,
  at: LayoutRef,
): Promise<FloorPlanSetSummary> {
  const [set] = await VENUE_SERVICE.readFloorPlanSets(tx, cfg, { setIds: [at.setId] });
  if (set === undefined) throw new AppError("floor_plan_set.not_found", { setId: at.setId });
  if (!set.zoneIds.includes(at.zoneId))
    throw new AppError("floor_plan_set.invalid", { field: "zoneId" });
  return set;
}

type MasterRow = typeof floorPlanTables.$inferSelect;

export type LayoutTable = MasterRow & {
  /** Where the layout puts the table; null when it leaves the table off. */
  placement: Placement | null;
  /** The size the table keeps in this layout while it is off it. */
  keptSize: { width: number; height: number } | null;
  /** The joined table this table is a part of. */
  partOf: string | null;
};

/**
 * The zone's tables, in label order, each with its place and kept size in layout `planId`; with no
 * layout, every table is off.
 */
export async function layoutTables(
  tx: Transaction,
  zoneId: string,
  planId: string | null,
): Promise<LayoutTable[]> {
  const inLayout = (column: SQLiteColumn): SQL => (planId === null ? sql`0` : eq(column, planId));
  const rows = await tx
    .select({
      ...getTableColumns(floorPlanTables),
      partOf: floorPlanTableParts.joinedTableId,
      placedX: floorPlanPlacements.x,
      placedY: floorPlanPlacements.y,
      placedWidth: floorPlanPlacements.width,
      placedHeight: floorPlanPlacements.height,
      placedShape: floorPlanPlacements.shape,
      placedRotation: floorPlanPlacements.rotation,
      keptWidth: floorPlanTableSizes.width,
      keptHeight: floorPlanTableSizes.height,
    })
    .from(floorPlanTables)
    .leftJoin(floorPlanTableParts, eq(floorPlanTableParts.partTableId, floorPlanTables.id))
    .leftJoin(
      floorPlanPlacements,
      and(
        inLayout(floorPlanPlacements.planId),
        eq(floorPlanPlacements.planTableId, floorPlanTables.id),
      ),
    )
    .leftJoin(
      floorPlanTableSizes,
      and(
        inLayout(floorPlanTableSizes.planId),
        eq(floorPlanTableSizes.planTableId, floorPlanTables.id),
      ),
    )
    .where(eq(floorPlanTables.zoneId, zoneId))
    .orderBy(asc(floorPlanTables.label));
  return rows.map(
    ({
      placedX,
      placedY,
      placedWidth,
      placedHeight,
      placedShape,
      placedRotation,
      keptWidth,
      keptHeight,
      ...row
    }) => ({
      ...row,
      placement: placementOf({
        x: placedX,
        y: placedY,
        width: placedWidth,
        height: placedHeight,
        shape: placedShape,
        rotation: placedRotation,
      }),
      keptSize:
        keptWidth === null || keptHeight === null ? null : { width: keptWidth, height: keptHeight },
    }),
  );
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

async function planTables(tx: Transaction, masters: LayoutTable[]): Promise<PlanTable[]> {
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
  const placedIds = new Set(masters.flatMap((m) => (m.placement === null ? [] : [m.id])));
  return masters.map((master) => ({
    id: master.id,
    liveTableId: followers.get(master.id) ?? null,
    label: master.label,
    seats: master.seats,
    fixed: master.fixed,
    // A part's place in a layout that places its joined table reads as off, so a change of
    // parts saved in another set never leaves this layout invalid.
    placement: master.partOf !== null && placedIds.has(master.partOf) ? null : master.placement,
    keptSize: master.keptSize,
    partIds: byJoined.get(master.id) ?? [],
  }));
}

/** A set's layout of a zone; with no layout row yet, the zone's tables all off, at revision 0. */
export async function readLayout(
  tx: Transaction,
  cfg: TillConfig,
  at: LayoutRef,
): Promise<ZonePlan> {
  await requireZone(tx, cfg, at.zoneId);
  const set = await requireSetOf(tx, cfg, at);
  const plan = await planOf(tx, at);
  return {
    zoneId: at.zoneId,
    setId: at.setId,
    setName: set.name,
    revision: plan?.revision ?? 0,
    savedAt: plan?.savedAt ?? null,
    tables: await planTables(tx, await layoutTables(tx, at.zoneId, plan?.id ?? null)),
  };
}

function invalid(field: string): AppError {
  return new AppError("floor_plan.invalid", { field });
}

function wholeIn(value: unknown, low: number, high: number): boolean {
  return Number.isInteger(value) && (value as number) >= low && (value as number) <= high;
}

/** The ranges `floor_plan_placements`' checks hold. */
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
      if (part.placement !== null && table.placement !== null) throw invalid(at);
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
    .innerJoin(floorZones, eq(floorZones.id, floorPlanTables.zoneId))
    .where(and(eq(floorZones.locationId, cfg.locationId), ne(floorPlanTables.zoneId, zoneId)));
  const live = await tx
    .select({ label: diningTables.label })
    .from(diningTables)
    .where(and(eq(diningTables.locationId, cfg.locationId), ne(diningTables.zoneId, zoneId)));
  return new Set([...masters.map((m) => m.label), ...live.map((t) => t.label)]);
}

/** What a passed check read, for the save to reuse. */
interface CheckedZonePlanSave {
  plan: Awaited<ReturnType<typeof planOf>>;
  /** The plan's tables, by label. */
  masters: LayoutTable[];
  tables: ZonePlanSave["tables"];
  /** The saved set's department. */
  departmentId: string;
}

/** Checks a save of a set's layout without writing it. */
export async function checkLayoutSave(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  at: LayoutRef,
  input: ZonePlanSave,
  now: Date = new Date(),
): Promise<void> {
  await checkSave(tx, cfg, removals, at, input, now);
}

async function checkSave(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  at: LayoutRef,
  input: ZonePlanSave,
  now: Date,
): Promise<CheckedZonePlanSave> {
  const { zoneId } = at;
  await requireZone(tx, cfg, zoneId);
  const { departmentId } = await requireSetOf(tx, cfg, at);
  const plan = await planOf(tx, at);
  const revision = plan?.revision ?? 0;
  if (input.revision !== revision) {
    throw new AppError("floor_plan.out_of_date", { zoneId, revision });
  }
  // A set's layout shares the zone's tables, so it holds them all even before its first save.
  const masters = await layoutTables(tx, zoneId, plan?.id ?? null);
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
  return { plan, masters, tables, departmentId };
}

function masterColumns(table: ZonePlanSave["tables"][number]) {
  return { seats: table.seats, fixed: table.fixed };
}

/** A zone's first save builds today's plan at once, from the layout due now (spec decision 19). */
async function firstSaveReset(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  zoneId: string,
  now: Date,
): Promise<void> {
  const [today] = await tx
    .select({ id: floorTodayZones.id })
    .from(floorTodayZones)
    .where(eq(floorTodayZones.zoneId, zoneId));
  if (today === undefined) await resetZone(tx, cfg, removals, zoneId, now, "due");
}

/**
 * Writes a checked save to a set's layout. A save that changes the zone's shared tables moves
 * the revision of every layout of the zone in the set's department, writing the missing ones,
 * so an editor open on another set cannot save a stale table list over it. A zone's first save
 * builds today's plan.
 */
export async function saveLayout(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  at: LayoutRef,
  input: ZonePlanSave,
  now: Date = new Date(),
): Promise<{ revision: number; ids: Record<string, string> }> {
  const checked = await checkSave(tx, cfg, removals, at, input, now);
  const saved = await writeSave(tx, at, checked, now);
  if (saved.shared) {
    const sets = await VENUE_SERVICE.readFloorPlanSets(tx, cfg, {
      departmentId: checked.departmentId,
    });
    const others = sets.map((s) => s.setId).filter((id) => id !== at.setId);
    if (others.length > 0) {
      const existing = await tx
        .select({ setId: floorPlans.setId })
        .from(floorPlans)
        .where(and(eq(floorPlans.zoneId, at.zoneId), inArray(floorPlans.setId, others)));
      await tx
        .update(floorPlans)
        .set({ revision: sql`${floorPlans.revision} + 1` })
        .where(and(eq(floorPlans.zoneId, at.zoneId), inArray(floorPlans.setId, others)));
      const held = new Set(existing.map((row) => row.setId));
      const missing = others.filter((id) => !held.has(id));
      if (missing.length > 0) {
        await tx.insert(floorPlans).values(
          missing.map((setId) => ({
            zoneId: at.zoneId,
            setId,
            revision: 1,
            savedAt: now.toISOString(),
          })),
        );
      }
    }
  }
  await firstSaveReset(tx, cfg, removals, at.zoneId, now);
  return { revision: saved.revision, ids: saved.ids };
}

async function writeSave(
  tx: Transaction,
  at: LayoutRef,
  checked: CheckedZonePlanSave,
  now: Date,
): Promise<{ revision: number; ids: Record<string, string>; shared: boolean }> {
  const { zoneId, setId } = at;
  const { masters, tables } = checked;
  const savedAt = now.toISOString();
  let plan = checked.plan;
  if (plan === undefined) {
    [plan] = await tx
      .insert(floorPlans)
      .values({ zoneId, setId, revision: 0, savedAt })
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
          .where(eq(floorPlanTables.zoneId, zoneId)),
      ),
    );
  const kept = new Set(tables.flatMap((t) => (t.id === undefined ? [] : [t.id])));
  const deleted = masters.filter((m) => !kept.has(m.id)).map((m) => m.id);
  // A deleted table may stand in another set's layout of the zone too.
  await tx
    .delete(floorPlanPlacements)
    .where(
      or(eq(floorPlanPlacements.planId, planId), inArray(floorPlanPlacements.planTableId, deleted)),
    );
  const masterOf = new Map(masters.map((m) => [m.id, m]));
  const leaving = tables.flatMap((t) =>
    t.id !== undefined && t.placement === null && masterOf.get(t.id)!.placement !== null
      ? [t.id]
      : [],
  );
  const placed = tables.flatMap((t) => (t.id !== undefined && t.placement !== null ? [t.id] : []));
  const sizesGone = [...leaving, ...placed];
  if (sizesGone.length > 0 || deleted.length > 0) {
    await tx
      .delete(floorPlanTableSizes)
      .where(
        or(
          inArray(floorPlanTableSizes.planTableId, deleted),
          and(
            eq(floorPlanTableSizes.planId, planId),
            inArray(floorPlanTableSizes.planTableId, sizesGone),
          ),
        ),
      );
  }
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
  // another row is giving up never meets the unique (zone_id, label) key halfway.
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
      created.push({ id, zoneId, label: table.label.trim(), ...masterColumns(table) });
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
  if (leaving.length > 0) {
    await tx.insert(floorPlanTableSizes).values(
      leaving.map((id) => {
        const { width, height } = masterOf.get(id)!.placement!;
        return { planId, planTableId: id, width, height };
      }),
    );
  }
  const placements = tables.flatMap((table) =>
    table.placement === null
      ? []
      : [
          {
            planId,
            planTableId: ids.get(table.key)!,
            x: table.placement.x,
            y: table.placement.y,
            width: table.placement.width,
            height: table.placement.height,
            shape: table.placement.shape,
            rotation: table.placement.rotation,
          },
        ],
  );
  if (placements.length > 0) await tx.insert(floorPlanPlacements).values(placements);
  const parts = tables.flatMap((table) =>
    table.partKeys.map((key) => ({
      joinedTableId: ids.get(table.key)!,
      partTableId: ids.get(key)!,
    })),
  );
  if (parts.length > 0) await tx.insert(floorPlanTableParts).values(parts);

  const revision = plan!.revision + 1;
  await tx.update(floorPlans).set({ revision, savedAt }).where(eq(floorPlans.id, planId));

  return { revision, ids: Object.fromEntries(ids), shared: changedShared(masters, tables, ids) };
}

/** Whether the save added, deleted or renamed a table, or changed its seats, "Moveable" or parts. */
function changedShared(
  masters: LayoutTable[],
  tables: ZonePlanSave["tables"],
  ids: Map<string, string>,
): boolean {
  if (tables.length !== masters.length || tables.some((t) => t.id === undefined)) return true;
  const masterOf = new Map(masters.map((m) => [m.id, m]));
  for (const table of tables) {
    const master = masterOf.get(table.id!)!;
    if (
      master.label !== table.label.trim() ||
      master.seats !== table.seats ||
      master.fixed !== table.fixed
    ) {
      return true;
    }
  }
  const before = new Set(
    masters.flatMap((m) => (m.partOf === null ? [] : [`${m.id}>${m.partOf}`])),
  );
  const after = tables.flatMap((t) =>
    t.partKeys.map((key) => `${ids.get(key)!}>${ids.get(t.key)!}`),
  );
  return after.length !== before.size || after.some((link) => !before.has(link));
}
