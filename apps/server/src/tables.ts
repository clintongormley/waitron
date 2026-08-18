// Side-effect only: keeps this host's `table.*` codes (errors.ts) reachable from the file that throws
// them — the reachability convention `till-config.ts`/`till-sale.ts` follow. See errors.ts.
import "./errors.js";
import { and, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { diningTables, isUniqueViolation } from "@waitron/db";
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
