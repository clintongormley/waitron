import { deleteServiceSteps } from "./service-steps.js";
import { and, asc, eq, inArray, isNotNull, or } from "drizzle-orm";
import {
  floorPlanSets,
  departments,
  departmentCourses,
  departmentTransferDestinations,
  deviceProfileKitchenScreenZones,
  deviceProfiles,
  devices,
  deviceZoneSelections,
  deviceZoneSelectionZones,
  floorZones,
  menuPeriods,
  routingCellPeriods,
  routingCells,
  removeIdFromJson,
  serviceSteps,
  openingHours,
  type Transaction,
} from "@waitron/db";
import { createLabelComparator, type DeleteImpactItem, type DeleteTarget } from "@waitron/shared";

async function settings(
  tx: Transaction,
  requestedZones: readonly string[],
  requestedDepartment: string | null,
) {
  const zones = await tx
    .select()
    .from(floorZones)
    .where(inArray(floorZones.id, [...requestedZones]));
  const zoneIds = zones.map((row) => row.id);
  const [department] = await tx
    .select()
    .from(departments)
    .where(eq(departments.id, requestedDepartment ?? ""));
  const departmentId = department?.id ?? null;
  const cells = await tx.select().from(routingCells).where(inArray(routingCells.zoneId, zoneIds));
  const periods = await tx
    .select()
    .from(routingCellPeriods)
    .where(
      or(
        inArray(
          routingCellPeriods.cellId,
          cells.map((row) => row.id),
        ),
        departmentId === null
          ? undefined
          : inArray(
              routingCellPeriods.periodId,
              tx
                .select({ id: menuPeriods.id })
                .from(menuPeriods)
                .where(eq(menuPeriods.departmentId, departmentId)),
            ),
      ),
    );
  const scopes = await tx
    .select()
    .from(deviceProfiles)
    .where(isNotNull(deviceProfiles.orderDepartmentId));
  const obsolete = scopes.filter(
    (profile) =>
      (profile.retiredAt !== null || profile.formFactor === "kds") &&
      (profile.orderDepartmentId === departmentId ||
        (profile.orderStartingZoneId !== null && zoneIds.includes(profile.orderStartingZoneId)) ||
        profile.orderZoneIds?.some((zoneId) => zoneIds.includes(zoneId))),
  );
  const obsoleteIds = obsolete.map((profile) => profile.id);
  const profileZones = scopes.flatMap((profile) =>
    (profile.orderZoneIds ?? [])
      .filter((zoneId) => obsoleteIds.includes(profile.id) || zoneIds.includes(zoneId))
      .map(() => profile),
  );
  const candidates = await tx
    .select({
      id: floorZones.id,
      name: floorZones.name,
      departmentId: floorZones.departmentId,
    })
    .from(floorZones)
    .innerJoin(departments, eq(departments.id, floorZones.departmentId))
    .where(and(eq(floorZones.active, true), eq(departments.active, true)))
    .orderBy(asc(floorZones.displayOrder), asc(floorZones.name), asc(floorZones.id));
  const surviving = candidates.filter(
    (row) => !zoneIds.includes(row.id) && row.departmentId !== departmentId,
  );
  const starts = scopes
    .filter(
      (profile) =>
        !obsoleteIds.includes(profile.id) &&
        profile.orderStartingZoneId !== null &&
        zoneIds.includes(profile.orderStartingZoneId),
    )
    .flatMap((profile) => {
      const permitted = surviving.find(
        (zone) =>
          zone.departmentId === profile.orderDepartmentId &&
          (profile.orderZoneIds === null || profile.orderZoneIds.includes(zone.id)),
      );
      return permitted === undefined ? [] : [{ profile, zoneId: permitted.id }];
    });
  const screenProfiles = await tx
    .select()
    .from(deviceProfileKitchenScreenZones)
    .innerJoin(
      deviceProfiles,
      eq(deviceProfiles.id, deviceProfileKitchenScreenZones.deviceProfileId),
    )
    .where(inArray(deviceProfileKitchenScreenZones.zoneId, zoneIds));
  const sets = await tx
    .select()
    .from(floorPlanSets)
    .where(eq(floorPlanSets.departmentId, departmentId ?? ""));
  const desks = await tx
    .select()
    .from(departments)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, departments.transferDeskProfileId))
    .where(eq(departments.id, departmentId ?? ""));
  const routes = await tx
    .select()
    .from(departmentTransferDestinations)
    .where(
      or(
        eq(departmentTransferDestinations.sourceDepartmentId, departmentId ?? ""),
        eq(departmentTransferDestinations.destinationDepartmentId, departmentId ?? ""),
      ),
    );
  const counterparts = await tx
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(
      inArray(
        departments.id,
        routes.map((row) =>
          row.sourceDepartmentId === departmentId
            ? row.destinationDepartmentId
            : row.sourceDepartmentId,
        ),
      ),
    );
  const [departmentReplacement] = department?.isDefault
    ? await tx
        .select({ id: departments.id, name: departments.name })
        .from(departments)
        .where(eq(departments.active, true))
        .orderBy(asc(departments.name), asc(departments.id))
        .then((rows) => rows.filter((row) => row.id !== departmentId))
    : [];
  const oldCounter = zones.find((row) => row.isCounterDefault);
  const counterReplacement =
    oldCounter === undefined
      ? undefined
      : (surviving.find((row) => row.departmentId === oldCounter.departmentId) ?? surviving[0]);
  const deviceChoices = await tx
    .select({
      deviceId: devices.id,
      profileId: deviceZoneSelectionZones.deviceProfileId,
      zoneId: deviceZoneSelectionZones.zoneId,
      name: devices.label,
      deletedAt: devices.deletedAt,
      active: devices.active,
    })
    .from(deviceZoneSelectionZones)
    .innerJoin(devices, eq(devices.id, deviceZoneSelectionZones.deviceId))
    .where(inArray(deviceZoneSelectionZones.zoneId, zoneIds));
  const deviceStarts = await tx
    .select({
      deviceId: devices.id,
      profileId: deviceZoneSelections.deviceProfileId,
      zoneId: deviceZoneSelections.startingZoneId,
      name: devices.label,
      deletedAt: devices.deletedAt,
      active: devices.active,
    })
    .from(deviceZoneSelections)
    .innerJoin(devices, eq(devices.id, deviceZoneSelections.deviceId))
    .where(inArray(deviceZoneSelections.startingZoneId, zoneIds));
  const deviceZoneReferences = [
    ...new Map(
      [...deviceChoices, ...deviceStarts].map((row) => [
        JSON.stringify([row.deviceId, row.profileId, row.zoneId]),
        row,
      ]),
    ).values(),
  ];
  const compare = createLabelComparator();
  const targets = (rows: DeleteTarget[]) =>
    [
      ...new Map(
        rows.map((row) => [
          row.id,
          { id: row.id, name: row.name, ...(row.deleted ? { deleted: true } : {}) },
        ]),
      ).values(),
    ].sort((a, b) => compare(a.name, b.name) || a.id.localeCompare(b.id));
  const liveProfile = (profile: typeof deviceProfiles.$inferSelect) =>
    profile.retiredAt === null && profile.formFactor !== "kds";
  const removes: DeleteImpactItem[] = [
    { key: "routing_rules", count: cells.length, targets: [] },
    { key: "routing_periods", count: periods.length, targets: [] },
    {
      key: "profile_zones",
      count: profileZones.length,
      targets: targets(profileZones.filter(liveProfile)),
    },
    {
      key: "profile_starting_zones",
      count: starts.length,
      targets: targets(starts.map((row) => row.profile)),
    },
    {
      key: "screen_zones",
      count: screenProfiles.length + deviceZoneReferences.length,
      targets: targets([
        ...deviceZoneReferences
          .filter((row) => row.deletedAt === null)
          .map((row) => ({
            id: row.deviceId,
            name: row.name,
            ...(row.active ? {} : { deleted: true }),
          })),
        ...screenProfiles
          .filter((row) => row.device_profiles.retiredAt === null)
          .map((row) => row.device_profiles),
      ]),
    },
    { key: "floor_plan_sets", count: sets.length, targets: [] },
    {
      key: "transfer_desks",
      count: desks.length,
      targets: targets(desks.map((row) => row.device_profiles)),
    },
    { key: "transfer_routes", count: routes.length, targets: targets(counterparts) },
    {
      key: "default_department",
      count: department?.isDefault ? 1 : 0,
      targets: departmentReplacement === undefined ? [] : [departmentReplacement],
    },
    {
      key: "counter_default",
      count: oldCounter === undefined ? 0 : 1,
      targets:
        counterReplacement === undefined
          ? []
          : [{ id: counterReplacement.id, name: counterReplacement.name }],
    },
  ].filter((item) => item.count > 0);
  return {
    zoneIds,
    departmentId,
    cells,
    periods,
    obsoleteIds,
    starts,
    departmentReplacement,
    oldDefault: department?.isDefault ?? false,
    counterReplacement,
    removes,
  };
}

export async function readServiceDeleteSettings(
  tx: Transaction,
  zoneIds: readonly string[],
  departmentId: string | null,
): Promise<DeleteImpactItem[]> {
  return (await settings(tx, zoneIds, departmentId)).removes;
}

export async function clearServiceDeleteSettings(
  tx: Transaction,
  zoneIds: readonly string[],
  departmentId: string | null,
): Promise<void> {
  const selected = await settings(tx, zoneIds, departmentId);
  await tx.delete(routingCellPeriods).where(
    inArray(
      routingCellPeriods.id,
      selected.periods.map((row) => row.id),
    ),
  );
  await tx.delete(routingCells).where(
    inArray(
      routingCells.id,
      selected.cells.map((row) => row.id),
    ),
  );
  await tx.delete(openingHours).where(inArray(openingHours.zoneId, selected.zoneIds));
  for (const start of selected.starts)
    await tx
      .update(deviceProfiles)
      .set({ orderStartingZoneId: start.zoneId })
      .where(eq(deviceProfiles.id, start.profile.id));
  await tx
    .update(deviceProfiles)
    .set({ orderDepartmentId: null, orderStartingZoneId: null, orderZoneIds: null })
    .where(inArray(deviceProfiles.id, selected.obsoleteIds));
  for (const zoneId of selected.zoneIds)
    await removeIdFromJson(tx, deviceProfiles.orderZoneIds, zoneId);
  await tx
    .delete(deviceZoneSelectionZones)
    .where(inArray(deviceZoneSelectionZones.zoneId, selected.zoneIds));
  await tx
    .update(deviceZoneSelections)
    .set({ startingZoneId: null })
    .where(inArray(deviceZoneSelections.startingZoneId, selected.zoneIds));
  // Keep explicit parents: zero zone memberships must continue to mean no zones.
  await tx
    .delete(deviceProfileKitchenScreenZones)
    .where(inArray(deviceProfileKitchenScreenZones.zoneId, selected.zoneIds));
  await tx
    .update(floorZones)
    .set({
      isCounterDefault: false,
      orderStart: null,
      paidWhen: null,
      collectionNumber: null,
      keptOpenDay: null,
      keptOpenFrom: null,
      keptOpenUntil: null,
    })
    .where(inArray(floorZones.id, selected.zoneIds));
  if (selected.departmentId !== null) {
    await tx.delete(openingHours).where(eq(openingHours.departmentId, selected.departmentId));
    await tx.delete(menuPeriods).where(eq(menuPeriods.departmentId, selected.departmentId));
    await tx
      .delete(departmentCourses)
      .where(eq(departmentCourses.departmentId, selected.departmentId));
    const steps = await tx
      .select({ id: serviceSteps.id })
      .from(serviceSteps)
      .where(eq(serviceSteps.departmentId, selected.departmentId));
    await deleteServiceSteps(
      tx,
      steps.map((row) => row.id),
    );
    await tx
      .update(departments)
      .set({ transferDeskProfileId: null })
      .where(eq(departments.id, selected.departmentId));
    await tx
      .delete(departmentTransferDestinations)
      .where(
        or(
          eq(departmentTransferDestinations.sourceDepartmentId, selected.departmentId),
          eq(departmentTransferDestinations.destinationDepartmentId, selected.departmentId),
        ),
      );
    if (selected.oldDefault) {
      await tx
        .update(departments)
        .set({ isDefault: false })
        .where(eq(departments.id, selected.departmentId));
      if (selected.departmentReplacement !== undefined)
        await tx
          .update(departments)
          .set({ isDefault: true })
          .where(eq(departments.id, selected.departmentReplacement.id));
    }
  }
  if (selected.counterReplacement !== undefined)
    await tx
      .update(floorZones)
      .set({ isCounterDefault: true })
      .where(eq(floorZones.id, selected.counterReplacement.id));
}
