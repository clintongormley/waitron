import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { deviceProfiles, workingOrders, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { assertDepartment } from "./department-menus.js";
import { getOrderServiceContext, type VenueScope } from "./operations.js";
import { readProfileZones } from "./profile-access.js";
import { departments } from "./schema/service.js";
import {
  departmentTransferDesks,
  departmentTransferDestinations,
  departmentTransferRequests,
} from "./schema/department-transfers.js";
import "./errors.js";

export interface DepartmentTransferSettings {
  departmentId: string;
  receivingProfileId: string | null;
  destinationDepartmentIds: string[];
}

export interface DepartmentTransferActor {
  departmentId: string;
  personId: string;
}

export async function readDepartmentTransferSettings(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
): Promise<DepartmentTransferSettings> {
  await assertDepartment(tx, cfg, departmentId);
  const [desk] = await tx
    .select()
    .from(departmentTransferDesks)
    .where(eq(departmentTransferDesks.departmentId, departmentId));
  const destinations = await tx
    .select()
    .from(departmentTransferDestinations)
    .where(eq(departmentTransferDestinations.sourceDepartmentId, departmentId))
    .orderBy(asc(departmentTransferDestinations.destinationDepartmentId));
  return {
    departmentId,
    receivingProfileId: desk?.receivingProfileId ?? null,
    destinationDepartmentIds: destinations.map((row) => row.destinationDepartmentId),
  };
}

async function activeDepartment(tx: Transaction, cfg: VenueScope, departmentId: string) {
  const [row] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(
      and(
        eq(departments.id, departmentId),
        eq(departments.locationId, cfg.locationId),
        eq(departments.active, true),
      ),
    );
  if (row === undefined) throw new AppError("department.not_found", { departmentId });
}

async function usableProfile(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  profileId: string,
) {
  const [profile] = await tx
    .select({ formFactor: deviceProfiles.formFactor })
    .from(deviceProfiles)
    .where(and(eq(deviceProfiles.id, profileId), isNull(deviceProfiles.retiredAt)));
  if (profile === undefined || profile.formFactor === "kds") return false;
  const scope = await readProfileZones(tx, cfg, profileId);
  return (
    scope.departmentId === departmentId &&
    scope.allowedZoneIds !== null &&
    scope.allowedZoneIds.length > 0
  );
}

export async function setDepartmentTransferSettings(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  input: Omit<DepartmentTransferSettings, "departmentId">,
): Promise<void> {
  await activeDepartment(tx, cfg, departmentId);
  if (
    input.receivingProfileId !== null &&
    !(await usableProfile(tx, cfg, departmentId, input.receivingProfileId))
  )
    throw new AppError("department_transfer.settings_invalid", { field: "receivingProfileId" });
  const destinationIds = [...new Set(input.destinationDepartmentIds)];
  for (const destinationId of destinationIds) {
    const [destination] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(
        and(
          eq(departments.id, destinationId),
          eq(departments.locationId, cfg.locationId),
          eq(departments.active, true),
        ),
      );
    if (destinationId === departmentId || destination === undefined)
      throw new AppError("department_transfer.settings_invalid", {
        field: "destinationDepartmentIds",
      });
  }
  await tx
    .delete(departmentTransferDesks)
    .where(eq(departmentTransferDesks.departmentId, departmentId));
  if (input.receivingProfileId !== null)
    await tx
      .insert(departmentTransferDesks)
      .values({ departmentId, receivingProfileId: input.receivingProfileId });
  await tx
    .delete(departmentTransferDestinations)
    .where(eq(departmentTransferDestinations.sourceDepartmentId, departmentId));
  if (destinationIds.length > 0)
    await tx.insert(departmentTransferDestinations).values(
      destinationIds.map((destinationDepartmentId) => ({
        sourceDepartmentId: departmentId,
        destinationDepartmentId,
      })),
    );
}

export async function requestDepartmentTransfer(
  tx: Transaction,
  cfg: VenueScope,
  tabId: string,
  destinationDepartmentId: string,
  sender: DepartmentTransferActor,
) {
  const [tab] = await tx
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(and(eq(workingOrders.id, tabId), eq(workingOrders.locationId, cfg.locationId)));
  if (tab?.status !== "open") throw new AppError("department_transfer.tab_unavailable", { tabId });
  const context = await getOrderServiceContext(tx, cfg, tabId);
  if (context.departmentId !== sender.departmentId)
    throw new AppError("department_transfer.not_allowed", {});
  await activeDepartment(tx, cfg, context.departmentId);
  await activeDepartment(tx, cfg, destinationDepartmentId);
  const [direction] = await tx
    .select()
    .from(departmentTransferDestinations)
    .where(
      and(
        eq(departmentTransferDestinations.sourceDepartmentId, context.departmentId),
        eq(departmentTransferDestinations.destinationDepartmentId, destinationDepartmentId),
      ),
    );
  if (direction === undefined) throw new AppError("department_transfer.not_allowed", {});
  const [desk] = await tx
    .select()
    .from(departmentTransferDesks)
    .where(eq(departmentTransferDesks.departmentId, destinationDepartmentId));
  if (
    desk === undefined ||
    !(await usableProfile(tx, cfg, destinationDepartmentId, desk.receivingProfileId))
  )
    throw new AppError("department_transfer.desk_unavailable", {
      departmentId: destinationDepartmentId,
    });
  const [pending] = await tx
    .select({ id: departmentTransferRequests.id })
    .from(departmentTransferRequests)
    .where(
      and(
        eq(departmentTransferRequests.tabId, tabId),
        eq(departmentTransferRequests.status, "pending"),
      ),
    );
  if (pending !== undefined) throw new AppError("department_transfer.pending", { tabId });
  const [request] = await tx
    .insert(departmentTransferRequests)
    .values({
      tabId,
      sourceDepartmentId: context.departmentId,
      destinationDepartmentId,
      senderId: sender.personId,
    })
    .returning();
  return request!;
}

export async function listDepartmentTransfers(
  tx: Transaction,
  cfg: VenueScope,
  destinationDepartmentId: string,
) {
  await assertDepartment(tx, cfg, destinationDepartmentId);
  return tx
    .select()
    .from(departmentTransferRequests)
    .where(
      and(
        eq(departmentTransferRequests.destinationDepartmentId, destinationDepartmentId),
        eq(departmentTransferRequests.status, "pending"),
      ),
    )
    .orderBy(asc(departmentTransferRequests.createdAt), asc(departmentTransferRequests.id));
}

export async function withdrawDepartmentTransfer(
  tx: Transaction,
  cfg: VenueScope,
  requestId: string,
  sender: DepartmentTransferActor,
) {
  const [request] = await tx
    .select()
    .from(departmentTransferRequests)
    .where(eq(departmentTransferRequests.id, requestId));
  if (request === undefined) throw new AppError("department_transfer.not_found", { requestId });
  await assertDepartment(tx, cfg, request.sourceDepartmentId);
  if (request.sourceDepartmentId !== sender.departmentId)
    throw new AppError("department_transfer.not_allowed", {});
  if (request.status !== "pending")
    throw new AppError("department_transfer.not_pending", { requestId });
  const [withdrawn] = await tx
    .update(departmentTransferRequests)
    .set({
      status: "withdrawn",
      resolvedBy: sender.personId,
      resolvedAt: new Date().toISOString(),
      revision: sql`${departmentTransferRequests.revision} + 1`,
    })
    .where(
      and(
        eq(departmentTransferRequests.id, requestId),
        eq(departmentTransferRequests.status, "pending"),
      ),
    )
    .returning();
  return withdrawn!;
}
