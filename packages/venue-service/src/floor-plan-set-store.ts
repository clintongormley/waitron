import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";
import { floorZones, type Transaction } from "@waitron/db";
import type { FloorDeletion, FloorPlanSets, FloorPlanSetSummary } from "@waitron/module";
import { AppError } from "@waitron/shared";
import "./errors.js";
import type {
  FloorPlanSetDeleteImpact,
  FloorPlanSetsModel,
  PeriodFloorPlans,
} from "./floor-plan-set-types.js";
import { listDepartments, type VenueScope } from "./operations.js";
import { departmentFloorPlanSets } from "./schema/floor-plan-sets.js";
import { menuPeriods } from "./schema/menus.js";
import { departments, zoneServicePolicies } from "./schema/service.js";

export type { FloorPlanSetsModel, PeriodFloorPlans };

/** Gives a core floor plan set to a department under `name`; the department's first set is its default. */
export async function linkFloorPlanSet(
  tx: Transaction,
  cfg: VenueScope,
  input: { setId: string; departmentId: string; name: string },
): Promise<void> {
  const [department] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(
      and(
        eq(departments.id, input.departmentId),
        eq(departments.locationId, cfg.locationId),
        eq(departments.active, true),
      ),
    );
  if (department === undefined)
    throw new AppError("department.not_found", { departmentId: input.departmentId });
  const held = await tx
    .select({ name: departmentFloorPlanSets.name })
    .from(departmentFloorPlanSets)
    .where(eq(departmentFloorPlanSets.departmentId, input.departmentId));
  await insertLink(tx, input, held);
}

/** `linkFloorPlanSet` for a caller that has checked the department and read its sets, `held`. */
async function insertLink(
  tx: Transaction,
  input: { setId: string; departmentId: string; name: string },
  held: readonly { name: string }[],
): Promise<void> {
  if (held.some(({ name }) => name === input.name))
    throw new AppError("floor_plan_set.name_taken", {
      departmentId: input.departmentId,
      name: input.name,
    });
  await tx.insert(departmentFloorPlanSets).values({
    setId: input.setId,
    departmentId: input.departmentId,
    name: input.name,
    isDefault: held.length === 0,
  });
}

/** The sets of the venue's active departments, each department's default first, then by name. */
export async function readFloorPlanSets(
  tx: Transaction,
  cfg: VenueScope,
  filter: { setIds?: readonly string[]; departmentId?: string } = {},
): Promise<FloorPlanSetSummary[]> {
  if (filter.setIds?.length === 0) return [];
  const sets = await setRows(tx, cfg, filter);
  if (sets.length === 0) return [];
  const zones = await departmentZones(tx, cfg, [...new Set(sets.map((s) => s.departmentId))]);
  return sets.map((set) => ({
    ...set,
    zoneIds: zones.filter((z) => z.departmentId === set.departmentId).map((z) => z.id),
  }));
}

function setRows(
  tx: Transaction,
  cfg: VenueScope,
  filter: { setIds?: readonly string[]; departmentId?: string },
) {
  return tx
    .select({
      setId: departmentFloorPlanSets.setId,
      departmentId: departmentFloorPlanSets.departmentId,
      name: departmentFloorPlanSets.name,
      isDefault: departmentFloorPlanSets.isDefault,
    })
    .from(departmentFloorPlanSets)
    .innerJoin(departments, eq(departments.id, departmentFloorPlanSets.departmentId))
    .where(
      and(
        eq(departments.locationId, cfg.locationId),
        eq(departments.active, true),
        filter.setIds === undefined
          ? undefined
          : inArray(departmentFloorPlanSets.setId, [...filter.setIds]),
        filter.departmentId === undefined
          ? undefined
          : eq(departmentFloorPlanSets.departmentId, filter.departmentId),
      ),
    )
    .orderBy(
      asc(departmentFloorPlanSets.departmentId),
      desc(departmentFloorPlanSets.isDefault),
      asc(departmentFloorPlanSets.name),
    );
}

/** The active zones of `departmentIds`, in the order the venue lists its zones. */
async function departmentZones(
  tx: Transaction,
  cfg: VenueScope,
  departmentIds: readonly string[],
): Promise<{ id: string; name: string; departmentId: string }[]> {
  if (departmentIds.length === 0) return [];
  return tx
    .select({
      id: floorZones.id,
      name: floorZones.name,
      departmentId: zoneServicePolicies.departmentId,
    })
    .from(zoneServicePolicies)
    .innerJoin(floorZones, eq(floorZones.id, zoneServicePolicies.zoneId))
    .where(
      and(
        eq(zoneServicePolicies.locationId, cfg.locationId),
        eq(floorZones.active, true),
        inArray(zoneServicePolicies.departmentId, [...departmentIds]),
      ),
    )
    .orderBy(asc(floorZones.displayOrder), asc(floorZones.name), asc(floorZones.id));
}

/** The Floor plans page: every active department, its zones and its sets. */
export async function readFloorPlanSetsModel(
  tx: Transaction,
  cfg: VenueScope,
  core: FloorPlanSets,
): Promise<FloorPlanSetsModel> {
  const departmentRows = await listDepartments(tx, cfg);
  const departmentIds = departmentRows.map((d) => d.id);
  const sets = await setRows(tx, cfg, {});
  const zones = await departmentZones(tx, cfg, departmentIds);
  const periods = await tx
    .select({
      id: menuPeriods.id,
      name: menuPeriods.name,
      colour: menuPeriods.colour,
      departmentId: menuPeriods.departmentId,
      setId: menuPeriods.floorPlanSetId,
    })
    .from(menuPeriods)
    .where(inArray(menuPeriods.departmentId, departmentIds))
    .orderBy(asc(menuPeriods.name), asc(menuPeriods.id));
  const zonesOf = byDepartment(zones);
  const setsOf = byDepartment(sets);
  const { tableCounts, layouts } = await core.readLayouts(
    tx,
    zones.map((z) => z.id),
    sets.flatMap((set) =>
      (zonesOf.get(set.departmentId) ?? []).map((z) => ({ setId: set.setId, zoneId: z.id })),
    ),
  );
  const layoutOf = new Map(layouts.map((l) => [`${l.setId}:${l.zoneId}`, l]));
  const periodsOf = byDepartment(periods);
  return {
    departments: departmentRows.map((department) => {
      const ownZones = zonesOf.get(department.id) ?? [];
      const ownPeriods = periodsOf.get(department.id) ?? [];
      return {
        id: department.id,
        name: department.name,
        zones: ownZones.map((z) => ({
          id: z.id,
          name: z.name,
          tableCount: tableCounts.get(z.id)!,
        })),
        sets: (setsOf.get(department.id) ?? []).map((set) => ({
          id: set.setId,
          name: set.name,
          isDefault: set.isDefault,
          usedBy: ownPeriods
            .filter((p) => p.setId === set.setId || (set.isDefault && p.setId === null))
            .map(({ id, name, colour }) => ({ id, name, colour })),
          layouts: ownZones.map((z) => {
            const { onPlan, spare } = layoutOf.get(`${set.setId}:${z.id}`)!;
            return { zoneId: z.id, onPlan, spare };
          }),
        })),
      };
    }),
  };
}

export async function readPeriodFloorPlans(
  tx: Transaction,
  cfg: VenueScope,
  core: FloorPlanSets,
): Promise<PeriodFloorPlans> {
  const departmentIds = (await listDepartments(tx, cfg)).map((d) => d.id);
  const zones = await departmentZones(tx, cfg, departmentIds);
  if (zones.length === 0) return { departments: [] };
  const { tableCounts } = await core.readLayouts(
    tx,
    zones.map((z) => z.id),
    [],
  );
  const planned = new Set(
    zones.filter((z) => tableCounts.get(z.id)! > 0).map((z) => z.departmentId),
  );
  const shown = departmentIds.filter((id) => planned.has(id));
  if (shown.length === 0) return { departments: [] };
  const sets = await tx
    .select({
      id: departmentFloorPlanSets.setId,
      departmentId: departmentFloorPlanSets.departmentId,
      name: departmentFloorPlanSets.name,
      isDefault: departmentFloorPlanSets.isDefault,
    })
    .from(departmentFloorPlanSets)
    .where(inArray(departmentFloorPlanSets.departmentId, shown))
    .orderBy(desc(departmentFloorPlanSets.isDefault), asc(departmentFloorPlanSets.name));
  const setsOf = byDepartment(sets);
  return {
    departments: shown.map((id) => ({
      id,
      sets: (setsOf.get(id) ?? []).map(({ id: setId, name, isDefault }) => ({
        id: setId,
        name,
        isDefault,
      })),
    })),
  };
}

function byDepartment<T extends { departmentId: string }>(rows: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const held = grouped.get(row.departmentId);
    if (held === undefined) grouped.set(row.departmentId, [row]);
    else held.push(row);
  }
  return grouped;
}

function setName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") throw new AppError("floor_plan_set.invalid", { field: "name" });
  return trimmed;
}

async function ownedSet(tx: Transaction, cfg: VenueScope, setId: string) {
  const [set] = await readFloorPlanSets(tx, cfg, { setIds: [setId] });
  if (set === undefined) throw new AppError("floor_plan_set.not_found", { setId });
  return set;
}

/**
 * Makes a set for a department and links it under `name`. The department's first set starts
 * empty and takes no `fromSetId`; every later one copies the layouts of `fromSetId`, a set of the
 * same department.
 */
export async function createFloorPlanSet(
  tx: Transaction,
  cfg: VenueScope,
  core: FloorPlanSets,
  input: { departmentId: string; name: string; fromSetId?: string },
): Promise<string> {
  const [department] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(
      and(
        eq(departments.id, input.departmentId),
        eq(departments.locationId, cfg.locationId),
        eq(departments.active, true),
      ),
    );
  if (department === undefined)
    throw new AppError("floor_plan_set.invalid", { field: "departmentId" });
  const held = await readFloorPlanSets(tx, cfg, { departmentId: input.departmentId });
  if (
    held.length === 0
      ? input.fromSetId !== undefined
      : !held.some((set) => set.setId === input.fromSetId)
  )
    throw new AppError("floor_plan_set.invalid", { field: "fromSetId" });
  const name = setName(input.name);
  const setId = await core.create(tx);
  await insertLink(tx, { setId, departmentId: input.departmentId, name }, held);
  if (input.fromSetId !== undefined) await core.copyLayouts(tx, input.fromSetId, setId);
  return setId;
}

/** Copies a set into a new set of its department under `name`. */
export async function copyFloorPlanSet(
  tx: Transaction,
  cfg: VenueScope,
  core: FloorPlanSets,
  setId: string,
  name: string,
): Promise<string> {
  const set = await ownedSet(tx, cfg, setId);
  return createFloorPlanSet(tx, cfg, core, {
    departmentId: set.departmentId,
    name,
    fromSetId: setId,
  });
}

export async function renameFloorPlanSet(
  tx: Transaction,
  cfg: VenueScope,
  setId: string,
  name: string,
): Promise<void> {
  const set = await ownedSet(tx, cfg, setId);
  const trimmed = setName(name);
  const held = await readFloorPlanSets(tx, cfg, { departmentId: set.departmentId });
  if (held.some((other) => other.setId !== setId && other.name === trimmed))
    throw new AppError("floor_plan_set.name_taken", {
      departmentId: set.departmentId,
      name: trimmed,
    });
  await tx
    .update(departmentFloorPlanSets)
    .set({ name: trimmed })
    .where(eq(departmentFloorPlanSets.setId, setId));
}

/** The old default's flag is cleared first: the database holds one default per department. */
export async function makeDefaultFloorPlanSet(
  tx: Transaction,
  cfg: VenueScope,
  setId: string,
): Promise<void> {
  const set = await ownedSet(tx, cfg, setId);
  if (set.isDefault) return;
  await tx
    .update(departmentFloorPlanSets)
    .set({ isDefault: false })
    .where(eq(departmentFloorPlanSets.departmentId, set.departmentId));
  await tx
    .update(departmentFloorPlanSets)
    .set({ isDefault: true })
    .where(eq(departmentFloorPlanSets.setId, setId));
}

/** What deleting a set changes: the periods that name it, and the zones whose today's map came from it. */
export async function readFloorPlanSetDeleteImpact(
  tx: Transaction,
  cfg: VenueScope,
  core: FloorPlanSets,
  setId: string,
): Promise<FloorPlanSetDeleteImpact> {
  await ownedSet(tx, cfg, setId);
  const periods = await tx
    .select({ id: menuPeriods.id, name: menuPeriods.name })
    .from(menuPeriods)
    .where(eq(menuPeriods.floorPlanSetId, setId))
    .orderBy(asc(menuPeriods.name), asc(menuPeriods.id));
  const zoneIds = await core.zonesShowing(tx, setId);
  const names =
    zoneIds.length === 0
      ? []
      : await tx
          .select({ id: floorZones.id, name: floorZones.name })
          .from(floorZones)
          .where(inArray(floorZones.id, zoneIds));
  const nameOf = new Map(names.map((z) => [z.id, z.name]));
  return {
    periods,
    zonesShowing: zoneIds.map((id) => ({ id, name: nameOf.get(id)! })),
  };
}

/**
 * Deletes a set that is not its department's default. Its periods take `replaceWith`, another set
 * of the department; the default, named or null, is stored as an empty field so the periods
 * follow whichever set is the default later.
 */
export async function deleteFloorPlanSet(
  tx: Transaction,
  cfg: VenueScope,
  deletion: Pick<FloorDeletion, "removeSets">,
  setId: string,
  replaceWith: string | null,
): Promise<void> {
  const set = await ownedSet(tx, cfg, setId);
  if (set.isDefault) throw new AppError("floor_plan_set.is_default", { setId });
  let replacement: string | null = null;
  if (replaceWith !== null) {
    const held = await readFloorPlanSets(tx, cfg, { departmentId: set.departmentId });
    const chosen = held.find((other) => other.setId === replaceWith);
    if (replaceWith === setId || chosen === undefined)
      throw new AppError("floor_plan_set.invalid", { field: "replaceWith" });
    if (!chosen.isDefault) replacement = replaceWith;
  }
  await removeFloorPlanSets(
    tx,
    deletion,
    [setId],
    eq(menuPeriods.floorPlanSetId, setId),
    replacement,
  );
}

/**
 * Deletes `setIds` after the periods `periods` selects take `replacement`. The periods and the
 * department links go before core's rows, which they name by plain foreign keys.
 */
export async function removeFloorPlanSets(
  tx: Transaction,
  deletion: Pick<FloorDeletion, "removeSets">,
  setIds: readonly string[],
  periods: SQL,
  replacement: string | null,
): Promise<void> {
  await tx.update(menuPeriods).set({ floorPlanSetId: replacement }).where(periods);
  await tx
    .delete(departmentFloorPlanSets)
    .where(inArray(departmentFloorPlanSets.setId, [...setIds]));
  await deletion.removeSets(tx, setIds);
}
