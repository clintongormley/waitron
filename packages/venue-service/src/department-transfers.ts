import type { DepartmentTransferActor, DepartmentTransferReceiver } from "@waitron/module";
export type { DepartmentTransferActor, DepartmentTransferReceiver } from "@waitron/module";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  billPayments,
  billPaymentRefunds,
  deviceProfiles,
  diningTables,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { AppError } from "@waitron/shared";
import { assertDepartment } from "./department-menus.js";
import {
  getOrderServiceContext,
  retargetOrderServiceContext,
  type VenueScope,
} from "./operations.js";
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

export async function listDepartmentTransferProfiles(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
): Promise<{ id: string; name: string }[]> {
  await activeDepartment(tx, cfg, departmentId);
  const profiles = await tx
    .select({ id: deviceProfiles.id, name: deviceProfiles.name })
    .from(deviceProfiles)
    .where(isNull(deviceProfiles.retiredAt))
    .orderBy(asc(deviceProfiles.name), asc(deviceProfiles.id));
  const choices: { id: string; name: string }[] = [];
  for (const profile of profiles) {
    if (await usableProfile(tx, cfg, departmentId, profile.id)) choices.push(profile);
  }
  return choices;
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
  if (tab === undefined || (tab.status !== "open" && tab.status !== "placed"))
    throw new AppError("department_transfer.tab_unavailable", { tabId });
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

export async function readDepartmentTransfer(
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
  return request;
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

async function pendingRequest(tx: Transaction, cfg: VenueScope, requestId: string) {
  const [request] = await tx
    .select()
    .from(departmentTransferRequests)
    .where(eq(departmentTransferRequests.id, requestId));
  if (request === undefined) throw new AppError("department_transfer.not_found", { requestId });
  await assertDepartment(tx, cfg, request.destinationDepartmentId);
  if (request.status !== "pending")
    throw new AppError("department_transfer.not_pending", { requestId });
  return request;
}

async function checkReceiver(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  receiver: DepartmentTransferReceiver,
) {
  const [desk] = await tx
    .select()
    .from(departmentTransferDesks)
    .where(eq(departmentTransferDesks.departmentId, departmentId));
  if (
    receiver.departmentId !== departmentId ||
    desk?.receivingProfileId !== receiver.profileId ||
    !(await usableProfile(tx, cfg, departmentId, receiver.profileId))
  )
    throw new AppError("department_transfer.not_allowed", {});
}

async function resolveRequest(
  tx: Transaction,
  requestId: string,
  receiver: DepartmentTransferActor,
  values: { status: "accepted" | "declined"; destinationZoneId?: string; reason?: string },
) {
  const [resolved] = await tx
    .update(departmentTransferRequests)
    .set({
      ...values,
      resolvedBy: receiver.personId,
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
  if (resolved === undefined) throw new AppError("department_transfer.not_pending", { requestId });
  return resolved;
}

export async function acceptDepartmentTransfer(
  tx: Transaction,
  cfg: VenueScope,
  requestId: string,
  receiver: DepartmentTransferReceiver,
  input: { tabRevision: number; zoneId: string; tableId: string | null },
) {
  const request = await pendingRequest(tx, cfg, requestId);
  await checkReceiver(tx, cfg, request.destinationDepartmentId, receiver);
  const [tab] = await tx
    .select()
    .from(workingOrders)
    .where(and(eq(workingOrders.id, request.tabId), eq(workingOrders.locationId, cfg.locationId)));
  if (tab === undefined || (tab.status !== "open" && tab.status !== "placed"))
    throw new AppError("department_transfer.tab_unavailable", { tabId: request.tabId });
  if (tab.revision !== input.tabRevision)
    throw new AppError("working_order.out_of_date", {
      workingOrderId: tab.id,
      revision: tab.revision,
    });
  const context = await getOrderServiceContext(tx, cfg, tab.id);
  if (context.departmentId !== request.sourceDepartmentId)
    throw new AppError("department_transfer.not_allowed", {});
  if (tab.paymentAttemptAt !== null)
    throw new AppError("order.payment_in_flight", { workingOrderId: tab.id });
  const [payment] = await tx
    .select({ id: billPayments.id })
    .from(billPayments)
    .where(and(eq(billPayments.workingOrderId, tab.id), eq(billPayments.state, "pending")))
    .limit(1);
  if (payment !== undefined)
    throw new AppError("order.payment_in_flight", { workingOrderId: tab.id });
  const [refund] = await tx
    .select({ id: billPaymentRefunds.id })
    .from(billPaymentRefunds)
    .innerJoin(billPayments, eq(billPayments.id, billPaymentRefunds.billPaymentId))
    .where(and(eq(billPayments.workingOrderId, tab.id), eq(billPaymentRefunds.state, "pending")))
    .limit(1);
  if (refund !== undefined)
    throw new AppError("bill.refund_in_progress", { workingOrderId: tab.id });
  // A single-tab acceptance must not change the table links or order groups shared by other bills.
  if (tab.partyId !== null)
    throw new AppError("department_transfer.structure_unsupported", { tabId: tab.id });
  const scope = await readProfileZones(tx, cfg, receiver.profileId);
  if (!scope.allowedZoneIds?.includes(input.zoneId))
    throw new AppError("department_transfer.destination_invalid", { field: "zoneId" });
  if (input.tableId !== null) {
    const [table] = await tx
      .select({ id: diningTables.id })
      .from(diningTables)
      .where(
        and(
          eq(diningTables.id, input.tableId),
          eq(diningTables.locationId, cfg.locationId),
          eq(diningTables.zoneId, input.zoneId),
          eq(diningTables.active, true),
        ),
      );
    if (table === undefined)
      throw new AppError("department_transfer.destination_invalid", { field: "tableId" });
  }
  await retargetOrderServiceContext(tx, cfg, tab.id, input.zoneId);
  await tx
    .update(workingOrders)
    .set({ deliveryTableId: input.tableId, revision: sql`${workingOrders.revision} + 1` })
    .where(eq(workingOrders.id, tab.id));
  return resolveRequest(tx, request.id, receiver, {
    status: "accepted",
    destinationZoneId: input.zoneId,
  });
}

export async function declineDepartmentTransfer(
  tx: Transaction,
  cfg: VenueScope,
  requestId: string,
  receiver: DepartmentTransferReceiver,
  reason: string,
) {
  const request = await pendingRequest(tx, cfg, requestId);
  await checkReceiver(tx, cfg, request.destinationDepartmentId, receiver);
  if (!reason.trim()) throw new AppError("department_transfer.reason_required", {});
  return resolveRequest(tx, requestId, receiver, { status: "declined", reason: reason.trim() });
}

export async function listDepartmentTransferDestinations(
  tx: Transaction,
  cfg: VenueScope,
  sender: DepartmentTransferActor,
): Promise<{ id: string; name: string }[]> {
  await activeDepartment(tx, cfg, sender.departmentId);
  const rows = await tx
    .select({
      id: departments.id,
      name: departments.name,
      profileId: departmentTransferDesks.receivingProfileId,
    })
    .from(departmentTransferDestinations)
    .innerJoin(
      departments,
      eq(departments.id, departmentTransferDestinations.destinationDepartmentId),
    )
    .innerJoin(departmentTransferDesks, eq(departmentTransferDesks.departmentId, departments.id))
    .where(
      and(
        eq(departmentTransferDestinations.sourceDepartmentId, sender.departmentId),
        eq(departments.locationId, cfg.locationId),
        eq(departments.active, true),
      ),
    )
    .orderBy(asc(departments.name), asc(departments.id));
  const choices: { id: string; name: string }[] = [];
  for (const row of rows)
    if (await usableProfile(tx, cfg, row.id, row.profileId))
      choices.push({ id: row.id, name: row.name });
  return choices;
}

export async function listIncomingDepartmentTransfers(
  tx: Transaction,
  cfg: VenueScope,
  receiver: DepartmentTransferReceiver,
) {
  await checkReceiver(tx, cfg, receiver.departmentId, receiver);
  return listDepartmentTransfers(tx, cfg, receiver.departmentId);
}

export async function readIncomingDepartmentTransfer(
  tx: Transaction,
  cfg: VenueScope,
  requestId: string,
  receiver: DepartmentTransferReceiver,
) {
  const request = await pendingRequest(tx, cfg, requestId);
  await checkReceiver(tx, cfg, request.destinationDepartmentId, receiver);
  return request;
}

export async function listSentDepartmentTransfers(
  tx: Transaction,
  cfg: VenueScope,
  tabId: string,
  sender: DepartmentTransferActor,
) {
  await assertDepartment(tx, cfg, sender.departmentId);
  const rows = await tx
    .select()
    .from(departmentTransferRequests)
    .where(
      and(
        eq(departmentTransferRequests.tabId, tabId),
        eq(departmentTransferRequests.sourceDepartmentId, sender.departmentId),
      ),
    )
    .orderBy(asc(departmentTransferRequests.createdAt), asc(departmentTransferRequests.id));
  if (rows.length === 0) {
    const context = await getOrderServiceContext(tx, cfg, tabId);
    if (context.departmentId !== sender.departmentId)
      throw new AppError("department_transfer.not_allowed", {});
  }
  return rows;
}
