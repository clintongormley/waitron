import { and, asc, eq, inArray, or } from "drizzle-orm";
import { deviceProfiles, floorZones, workingOrders, type Transaction } from "@waitron/db";
import type { FloorDeletion } from "@waitron/module";
import {
  AppError,
  createLabelComparator,
  type DeleteImpact,
  type DeleteImpactRefusal,
  type DeleteTarget,
} from "@waitron/shared";
import type { VenueScope } from "./operations.js";
import {
  departments,
  deviceProfileServiceAccess,
  deviceProfileZones,
  orderServiceContexts,
  zoneServicePolicies,
} from "./schema/service.js";
import { departmentTransferRequests } from "./schema/department-transfers.js";
import { departmentFloorPlanSets } from "./schema/floor-plan-sets.js";
import { menuPeriods } from "./schema/menus.js";
import {
  clearServiceDeleteSettings,
  readServiceDeleteSettings,
} from "./service-delete-settings.js";
import "./errors.js";

type Kind = "zone" | "department";

function ordered<T extends DeleteTarget>(rows: readonly T[]): T[] {
  const compare = createLabelComparator();
  return [...rows].sort((a, b) => compare(a.name, b.name) || a.id.localeCompare(b.id));
}

function uniqueRefusals(rows: readonly DeleteImpactRefusal[]): DeleteImpactRefusal[] {
  const grouped = new Map<string, DeleteImpactRefusal>();
  for (const row of rows) {
    const key = JSON.stringify([row.code, row.params]);
    const previous = grouped.get(key);
    if (previous === undefined) {
      grouped.set(key, { ...row, targets: [...row.targets] });
      continue;
    }
    previous.targets.push(...row.targets);
  }
  return [...grouped.values()].map((row) => ({
    ...row,
    targets: ordered([...new Map(row.targets.map((target) => [target.id, target])).values()]),
  }));
}

async function selection(
  tx: Transaction,
  cfg: VenueScope,
  floor: FloorDeletion,
  kind: Kind,
  id: string,
  now: Date,
): Promise<{ impact: DeleteImpact; zoneIds: string[]; departmentId: string | null }> {
  const [department] =
    kind === "department"
      ? await tx
          .select()
          .from(departments)
          .where(
            and(
              eq(departments.id, id),
              eq(departments.locationId, cfg.locationId),
              eq(departments.active, true),
            ),
          )
      : [];
  const [zone] =
    kind === "zone"
      ? await tx
          .select()
          .from(floorZones)
          .where(
            and(
              eq(floorZones.id, id),
              eq(floorZones.locationId, cfg.locationId),
              eq(floorZones.active, true),
            ),
          )
      : [];
  if (kind === "department" && department === undefined)
    throw new AppError("department.not_found", { departmentId: id });
  if (kind === "zone" && zone === undefined)
    throw new AppError("service_zone.not_found", { zoneId: id });

  const linked =
    kind === "department"
      ? await tx
          .select({ id: floorZones.id, name: floorZones.name, active: floorZones.active })
          .from(zoneServicePolicies)
          .innerJoin(floorZones, eq(floorZones.id, zoneServicePolicies.zoneId))
          .where(
            and(
              eq(zoneServicePolicies.departmentId, id),
              eq(zoneServicePolicies.locationId, cfg.locationId),
              eq(floorZones.locationId, cfg.locationId),
            ),
          )
      : await tx
          .select({ id: floorZones.id, name: floorZones.name, active: floorZones.active })
          .from(floorZones)
          .where(eq(floorZones.id, id));
  const zones = ordered(linked);
  const zoneIds = zones.map((row) => row.id);
  const departmentId = kind === "department" ? id : null;
  const floorImpact = await floor.readImpact(tx, zoneIds, now);
  const settings = await readServiceDeleteSettings(tx, cfg, zoneIds, departmentId);
  const refusals: DeleteImpactRefusal[] = [];

  if (department !== undefined) {
    const active = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.locationId, cfg.locationId), eq(departments.active, true)));
    if (active.length === 1)
      refusals.push({ code: "department.last_active", params: { departmentId: id }, targets: [] });
  }

  const zonePosition = new Map(zoneIds.map((zoneId, index) => [zoneId, index]));
  const floorRefusals = [...floorImpact.refusals].sort((a, b) => {
    const left =
      typeof a.params.zoneId === "string" ? zonePosition.get(a.params.zoneId) : undefined;
    const right =
      typeof b.params.zoneId === "string" ? zonePosition.get(b.params.zoneId) : undefined;
    return (
      (left ?? Number.MAX_SAFE_INTEGER) - (right ?? Number.MAX_SAFE_INTEGER) ||
      a.code.localeCompare(b.code) ||
      JSON.stringify(a.params).localeCompare(JSON.stringify(b.params))
    );
  });
  refusals.push(...floorRefusals);

  const orders =
    zoneIds.length === 0 && departmentId === null
      ? []
      : await tx
          .select({
            id: workingOrders.id,
            zoneId: orderServiceContexts.zoneId,
            departmentId: orderServiceContexts.departmentId,
          })
          .from(orderServiceContexts)
          .innerJoin(workingOrders, eq(workingOrders.id, orderServiceContexts.workingOrderId))
          .where(
            and(
              eq(orderServiceContexts.locationId, cfg.locationId),
              inArray(workingOrders.status, ["open", "placed"]),
              or(
                inArray(orderServiceContexts.zoneId, zoneIds),
                departmentId === null
                  ? undefined
                  : eq(orderServiceContexts.departmentId, departmentId),
              ),
            ),
          )
          .orderBy(asc(workingOrders.id));
  for (const item of orders) {
    if (zoneIds.includes(item.zoneId))
      refusals.push({
        code: "zone.order_in_progress",
        params: { zoneId: item.zoneId, workingOrderId: item.id },
        targets: [],
      });
    if (departmentId !== null && item.departmentId === departmentId)
      refusals.push({
        code: "department.order_in_progress",
        params: { departmentId, workingOrderId: item.id },
        targets: [],
      });
  }

  const transfers = await tx
    .select()
    .from(departmentTransferRequests)
    .where(
      and(
        eq(departmentTransferRequests.status, "pending"),
        or(
          inArray(departmentTransferRequests.destinationZoneId, zoneIds),
          departmentId === null
            ? undefined
            : eq(departmentTransferRequests.sourceDepartmentId, departmentId),
          departmentId === null
            ? undefined
            : eq(departmentTransferRequests.destinationDepartmentId, departmentId),
        ),
      ),
    )
    .orderBy(asc(departmentTransferRequests.id));
  for (const transfer of transfers) {
    if (transfer.destinationZoneId !== null && zoneIds.includes(transfer.destinationZoneId))
      refusals.push({
        code: "zone.transfer_pending",
        params: { zoneId: transfer.destinationZoneId, requestId: transfer.id },
        targets: [],
      });
    if (
      departmentId !== null &&
      (transfer.sourceDepartmentId === departmentId ||
        transfer.destinationDepartmentId === departmentId)
    )
      refusals.push({
        code: "department.transfer_pending",
        params: { departmentId, requestId: transfer.id },
        targets: [],
      });
  }

  const scopes = await tx
    .select({
      id: deviceProfiles.id,
      name: deviceProfiles.name,
      retiredAt: deviceProfiles.retiredAt,
      formFactor: deviceProfiles.formFactor,
      departmentId: deviceProfileServiceAccess.departmentId,
      everyZone: deviceProfileServiceAccess.everyZone,
      startingZoneId: deviceProfileServiceAccess.startingZoneId,
    })
    .from(deviceProfileServiceAccess)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, deviceProfileServiceAccess.deviceProfileId))
    .orderBy(asc(deviceProfiles.name), asc(deviceProfiles.id));
  const memberships = await tx.select().from(deviceProfileZones);
  const candidates = await tx
    .select({ id: floorZones.id, departmentId: zoneServicePolicies.departmentId })
    .from(zoneServicePolicies)
    .innerJoin(floorZones, eq(floorZones.id, zoneServicePolicies.zoneId))
    .innerJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
    .where(
      and(
        eq(zoneServicePolicies.locationId, cfg.locationId),
        eq(floorZones.locationId, cfg.locationId),
        eq(floorZones.active, true),
        eq(departments.active, true),
      ),
    );
  for (const profile of ordered(scopes)) {
    if (profile.retiredAt !== null || profile.formFactor === "kds") continue;
    if (departmentId !== null) {
      if (profile.departmentId === departmentId)
        refusals.push({
          code: "department.profile_in_use",
          params: { departmentId, profileId: profile.id },
          targets: [{ id: profile.id, name: profile.name }],
        });
      continue;
    }
    const affected =
      zoneIds.includes(profile.startingZoneId) ||
      memberships.some((row) => row.deviceProfileId === profile.id && zoneIds.includes(row.zoneId));
    if (!affected) continue;
    const allowed = candidates.filter(
      (candidate) =>
        candidate.departmentId === profile.departmentId &&
        (profile.everyZone ||
          memberships.some(
            (row) => row.deviceProfileId === profile.id && row.zoneId === candidate.id,
          )),
    );
    if (allowed.some((candidate) => !zoneIds.includes(candidate.id))) continue;
    refusals.push({
      code: "zone.profile_in_use",
      params: { zoneId: id, profileId: profile.id },
      targets: [{ id: profile.id, name: profile.name }],
    });
  }

  const removes = [...floorImpact.removes, ...settings];
  if (department !== undefined && zones.length > 0)
    removes.push({
      key: "zones",
      count: zones.length,
      targets: zones.map(({ id: zoneId, name }) => ({ id: zoneId, name })),
    });
  return {
    impact: {
      target: kind === "department" ? { id, name: department!.name } : { id, name: zone!.name },
      refusals: uniqueRefusals(refusals),
      ends: [],
      removes,
    },
    zoneIds,
    departmentId,
  };
}

export async function readZoneDeleteImpact(
  tx: Transaction,
  cfg: VenueScope,
  floor: FloorDeletion,
  zoneId: string,
  now: Date,
): Promise<DeleteImpact> {
  return (await selection(tx, cfg, floor, "zone", zoneId, now)).impact;
}

export async function readDepartmentDeleteImpact(
  tx: Transaction,
  cfg: VenueScope,
  floor: FloorDeletion,
  departmentId: string,
  now: Date,
): Promise<DeleteImpact> {
  return (await selection(tx, cfg, floor, "department", departmentId, now)).impact;
}

async function remove(
  tx: Transaction,
  cfg: VenueScope,
  floor: FloorDeletion,
  kind: Kind,
  id: string,
  now: Date,
): Promise<DeleteImpact> {
  const { impact, zoneIds, departmentId } = await selection(tx, cfg, floor, kind, id, now);
  const first = impact.refusals[0];
  if (first !== undefined)
    throw new AppError(
      first.code as keyof import("@waitron/shared").ErrorParams,
      first.params as never,
    );
  await floor.clear(tx, zoneIds, now);
  if (departmentId !== null) {
    const links = await tx
      .select({ setId: departmentFloorPlanSets.setId })
      .from(departmentFloorPlanSets)
      .where(eq(departmentFloorPlanSets.departmentId, departmentId));
    await tx
      .update(menuPeriods)
      .set({ floorPlanSetId: null })
      .where(eq(menuPeriods.departmentId, departmentId));
    await tx
      .delete(departmentFloorPlanSets)
      .where(eq(departmentFloorPlanSets.departmentId, departmentId));
    await floor.removeSets(
      tx,
      links.map((link) => link.setId),
    );
  }
  await clearServiceDeleteSettings(tx, cfg, zoneIds, departmentId);
  if (zoneIds.length > 0)
    await tx.update(floorZones).set({ active: false }).where(inArray(floorZones.id, zoneIds));
  if (departmentId !== null)
    await tx.update(departments).set({ active: false }).where(eq(departments.id, departmentId));
  return impact;
}

export async function deleteZone(
  tx: Transaction,
  cfg: VenueScope,
  floor: FloorDeletion,
  zoneId: string,
  now: Date,
): Promise<DeleteImpact> {
  return remove(tx, cfg, floor, "zone", zoneId, now);
}

export async function deleteDepartment(
  tx: Transaction,
  cfg: VenueScope,
  floor: FloorDeletion,
  departmentId: string,
  now: Date,
): Promise<DeleteImpact> {
  return remove(tx, cfg, floor, "department", departmentId, now);
}
