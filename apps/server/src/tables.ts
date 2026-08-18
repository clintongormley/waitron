// Side-effect only: keeps this host's `table.*` codes (errors.ts) reachable from the file that throws
// them — the reachability convention `till-config.ts`/`till-sale.ts` follow. See errors.ts.
import "./errors.js";
import { and, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { authorizeManager } from "@waitron/identity";
import { diningTables, isUniqueViolation, tableServiceStatuses } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { TillConfig } from "./till-config.js";

/** A dining table as the CRUD surface returns it. `createdAt` is an ISO string. The `tab_id` back-pointer
 *  is an INTERNAL link (design §2b), not part of the CRUD surface — occupancy exposes it, not this. */
export interface DiningTable {
  id: string;
  label: string;
  zone: string | null;
  capacity: number | null;
  active: boolean;
  createdAt: string;
}

/**
 * Create a dining table in the till's venue (its `cfg.locationId`), returning the minted id. Runs on the
 * CALLER's transaction under its tenant/app_user scope. A duplicate `(tenant, location, label)` collides
 * on `dining_tables_location_label_key` (the only unique an INSERT can trip — `id` is fresh) and is
 * surfaced as `table.label_taken` rather than the raw 23505.
 */
export async function createTable(
  tx: Transaction,
  cfg: TillConfig,
  input: { label: string; zone?: string; capacity?: number },
): Promise<{ id: string }> {
  try {
    const [row] = await tx
      .insert(diningTables)
      .values({
        tenantId: cfg.tenantId,
        locationId: cfg.locationId,
        label: input.label,
        zone: input.zone ?? null,
        capacity: input.capacity ?? null,
      })
      .returning({ id: diningTables.id });
    return { id: row!.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("table.label_taken", { label: input.label });
    }
    throw error;
  }
}

/** The venue's ACTIVE tables, by `label`. RLS confines the read to the tenant; the location filter
 *  narrows to this till's venue. */
export async function listTables(tx: Transaction, cfg: TillConfig): Promise<DiningTable[]> {
  return tx
    .select({
      id: diningTables.id,
      label: diningTables.label,
      zone: diningTables.zone,
      capacity: diningTables.capacity,
      active: diningTables.active,
      createdAt: diningTables.createdAt,
    })
    .from(diningTables)
    .where(and(eq(diningTables.locationId, cfg.locationId), eq(diningTables.active, true)))
    .orderBy(diningTables.label);
}

/**
 * Edit a table's `label`/`zone`/`capacity` (any subset). An absent id (or another tenant's, RLS-hidden)
 * throws `table.not_found`; a label collision throws `table.label_taken`. Reactivate is `updateTable`-
 * shaped and kept trivial — this task deactivates via {@link deactivateTable}.
 */
export async function updateTable(
  tx: Transaction,
  // Kept for a uniform `(tx, cfg, …)` verb surface; this by-id update relies on RLS for the tenant
  // scope, so the config is unused here (repo idiom for an interface-mandated unused param).
  _cfg: TillConfig,
  id: string,
  input: { label?: string; zone?: string; capacity?: number },
): Promise<void> {
  const patch: { label?: string; zone?: string | null; capacity?: number | null } = {};
  if (input.label !== undefined) patch.label = input.label;
  if (input.zone !== undefined) patch.zone = input.zone;
  if (input.capacity !== undefined) patch.capacity = input.capacity;

  let updated: { id: string }[];
  try {
    updated = await tx
      .update(diningTables)
      .set(patch)
      .where(eq(diningTables.id, id))
      .returning({ id: diningTables.id });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Only `label` participates in the unique, so it was necessarily supplied when this fires.
      throw new AppError("table.label_taken", { label: input.label! });
    }
    throw error;
  }
  if (updated.length === 0) {
    throw new AppError("table.not_found", { tableId: id });
  }
}

/** Deactivate a table (`active = false`) — never a hard delete (the table has order history; app_user
 *  holds no DELETE on `dining_tables`). An absent id throws `table.not_found`. */
export async function deactivateTable(
  tx: Transaction,
  // Unused here for the same reason as `updateTable` — kept for the uniform verb surface.
  _cfg: TillConfig,
  id: string,
): Promise<void> {
  const updated = await tx
    .update(diningTables)
    .set({ active: false })
    .where(eq(diningTables.id, id))
    .returning({ id: diningTables.id });
  if (updated.length === 0) {
    throw new AppError("table.not_found", { tableId: id });
  }
}

/** A configured service status as the CRUD surface returns it. `createdAt` is an ISO string. */
export interface ServiceStatus {
  id: string;
  label: string;
  color: string;
  displayOrder: number;
  active: boolean;
  createdAt: string;
}

// A floor-plan swatch is a hex ("#ef4444") or a short token ("amber", "amber-500"): a bounded,
// charset-restricted string. Validated app-side (design §2a) — the DB stores opaque text. A malformed
// value is a request-payload fault surfaced as `management.request_invalid` naming the FIELD (never the
// value — the no-leak discipline errors.ts states), the same shape the layout PUT route uses; the spec
// enumerates only status.not_found/inactive/label_taken, so no new status.* code is minted (Plan note 3).
const STATUS_COLOR_RE = /^[#A-Za-z0-9_-]{1,32}$/;
function validateStatusColor(color: string): string {
  if (typeof color !== "string" || !STATUS_COLOR_RE.test(color)) {
    throw new AppError("management.request_invalid", { field: "color" });
  }
  return color;
}

/**
 * Create a service status in the tenant's configured set. Manager/admin only (`till.configure`, the
 * #81 venue-config permission — reused, not renamed): the authorize gate runs BEFORE any DB write,
 * proven by-deletion in the suite. A duplicate `(tenant, label)` collides on
 * `table_service_statuses_tenant_label_key` and is surfaced as `status.label_taken`.
 */
export async function createStatus(
  tx: Transaction,
  input: {
    managementSessionId: string;
    tenantId: string;
    label: string;
    color: string;
    displayOrder?: number;
  },
): Promise<{ id: string }> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "till.configure",
  });
  const color = validateStatusColor(input.color);
  try {
    const [row] = await tx
      .insert(tableServiceStatuses)
      .values({
        tenantId: input.tenantId,
        label: input.label,
        color,
        displayOrder: input.displayOrder ?? 0,
      })
      .returning({ id: tableServiceStatuses.id });
    return { id: row!.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("status.label_taken", { label: input.label });
    }
    throw error;
  }
}

/**
 * The tenant's WHOLE status set — active AND inactive, ordered by `display_order` then `label` — so the
 * editor can reactivate a deactivated one. Manager/admin only (`till.configure`), gated here rather than
 * at the route so the verb is safe from any caller. RLS confines the read to the tenant.
 */
export async function listStatuses(
  tx: Transaction,
  input: { managementSessionId: string; tenantId: string },
): Promise<ServiceStatus[]> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "till.configure",
  });
  return tx
    .select({
      id: tableServiceStatuses.id,
      label: tableServiceStatuses.label,
      color: tableServiceStatuses.color,
      displayOrder: tableServiceStatuses.displayOrder,
      active: tableServiceStatuses.active,
      createdAt: tableServiceStatuses.createdAt,
    })
    .from(tableServiceStatuses)
    .orderBy(tableServiceStatuses.displayOrder, tableServiceStatuses.label);
}

/**
 * Edit a status's `label`/`color`/`displayOrder`/`active` (any subset). Manager/admin only
 * (`till.configure`). An absent id (or another tenant's, RLS-hidden) throws `status.not_found`; a label
 * collision throws `status.label_taken`; a malformed color throws `management.request_invalid`.
 * Reactivation is `updateStatus({ active: true })`.
 */
export async function updateStatus(
  tx: Transaction,
  input: {
    managementSessionId: string;
    tenantId: string;
    id: string;
    label?: string;
    color?: string;
    displayOrder?: number;
    active?: boolean;
  },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "till.configure",
  });
  const patch: { label?: string; color?: string; displayOrder?: number; active?: boolean } = {};
  if (input.label !== undefined) patch.label = input.label;
  if (input.color !== undefined) patch.color = validateStatusColor(input.color);
  if (input.displayOrder !== undefined) patch.displayOrder = input.displayOrder;
  if (input.active !== undefined) patch.active = input.active;

  let updated: { id: string }[];
  try {
    updated = await tx
      .update(tableServiceStatuses)
      .set(patch)
      .where(eq(tableServiceStatuses.id, input.id))
      .returning({ id: tableServiceStatuses.id });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Only `label` participates in the unique, so it was necessarily supplied when this fires.
      throw new AppError("status.label_taken", { label: input.label! });
    }
    throw error;
  }
  if (updated.length === 0) {
    throw new AppError("status.not_found", { statusId: input.id });
  }
}

/** Deactivate a status (`active = false`) — never a hard delete (a table may reference it; app_user
 *  holds no DELETE on `table_service_statuses`). Manager/admin only. Absent id → `status.not_found`. */
export async function deactivateStatus(
  tx: Transaction,
  input: { managementSessionId: string; tenantId: string; id: string },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "till.configure",
  });
  const updated = await tx
    .update(tableServiceStatuses)
    .set({ active: false })
    .where(eq(tableServiceStatuses.id, input.id))
    .returning({ id: tableServiceStatuses.id });
  if (updated.length === 0) {
    throw new AppError("status.not_found", { statusId: input.id });
  }
}

/**
 * Set (or clear, with `null`) a table's single manual status (design §3b) — an OPERATIONAL verb a
 * logged-in operator uses the way they ring a sale, so it is gated by the operator SESSION at the route
 * (`requireSession`, Task 8), NOT by `till.configure`. Validates the table is active (an absent,
 * deactivated, or foreign/RLS-hidden table → `table.not_found`, design §3b) and, when `statusId` is
 * non-null, that the status is real (`status.not_found`) and `active` (`status.inactive`). Runs on the
 * CALLER's transaction under its tenant/app_user scope. The status is occupancy-INDEPENDENT: a `free`
 * table may carry one, so this never consults the tab state.
 */
export async function setTableStatus(
  tx: Transaction,
  // Unused here for the same reason as `updateTable`/`deactivateTable` — this by-id verb relies on RLS
  // for the tenant scope, so the config is kept only for the uniform `(tx, cfg, …)` verb surface.
  _cfg: TillConfig,
  tableId: string,
  statusId: string | null,
): Promise<void> {
  const [table] = await tx
    .select({ active: diningTables.active })
    .from(diningTables)
    .where(eq(diningTables.id, tableId));
  if (table === undefined || !table.active) {
    throw new AppError("table.not_found", { tableId });
  }

  if (statusId !== null) {
    const [status] = await tx
      .select({ active: tableServiceStatuses.active })
      .from(tableServiceStatuses)
      .where(eq(tableServiceStatuses.id, statusId));
    if (status === undefined) {
      throw new AppError("status.not_found", { statusId });
    }
    if (!status.active) {
      throw new AppError("status.inactive", { statusId });
    }
  }

  await tx.update(diningTables).set({ statusId }).where(eq(diningTables.id, tableId));
}
