import { tillLayouts } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { eq, sql } from "drizzle-orm";
import { DEFAULT_LAYOUT, DEFAULT_RECEIPT } from "./defaults.js";
import type { LayoutDef, ReceiptConfig } from "./types.js";
import { validateLayout } from "./validate.js";

/**
 * The get/put service over `till_layouts` (design §5). One row per tenant (D2), keyed on `tenant_id`.
 *
 * Every function takes a `(tx, …)` the CALLER has already scoped — the management/till routes open it
 * with `withTenant(deps.db, tenantId, …)` + `asAppUser(tx)`, so the app role's tenant-isolation policy
 * (0036) supplies `current_tenant_id()` and no function here sets a GUC. Proven under that exact shape
 * in `store.rls.test.ts` (real Postgres — RLS as the app role is a false pass on PGlite, CLAUDE.md §4).
 *
 * The receipt trim moved OUT of this store (SP-B4): it now lives in its own `tenant_receipts` row,
 * served by `getReceipt`/`putReceipt` in `receipt-store.ts`. `till_layouts` keeps a `receipt` column
 * for now (removed in a later task) — `getLayout` still returns it and `putLayout` still fills it with
 * the built-in default on first author — but no live receipt reader/writer uses it any more.
 *
 * `putLayout` runs, in order: (1) `authorizeManager(..., "till.configure")` — the write gate, before
 * any DB write, proven by-deletion in the store suite; (2) `validateLayout` — fail-closed on an
 * invalid `definition` (design D8); (3) an `INSERT … ON CONFLICT (tenant_id) DO UPDATE` that touches
 * ONLY `definition` + `updated_at`. On the first author the `receipt` column is filled from its
 * built-in default (it is `NOT NULL`); on a later author it is left untouched by the `set` list.
 */

/**
 * The authored layout + receipt for the current tenant, or the built-in defaults when the tenant has
 * never opened the editor. Read on the till's boot path, which is why the stored jsonb is returned as
 * its typed shape WITHOUT re-running `validateLayout`: the value was validated on the write that stored
 * it (below), and the only writer is this service, so re-validating on every boot read would spend work
 * to re-prove an invariant the write already holds. The `as` casts re-attach the shapes the plain-jsonb
 * columns drop (they are not `.$type<>()`-annotated to avoid a `@waitron/layouts` → `@waitron/db`
 * circular dependency, see `packages/db/src/schema/layouts.ts`).
 */
export async function getLayout(
  tx: Transaction,
  tenantId: string,
): Promise<{ definition: LayoutDef; receipt: ReceiptConfig }> {
  const [row] = await tx
    .select({ definition: tillLayouts.definition, receipt: tillLayouts.receipt })
    .from(tillLayouts)
    .where(eq(tillLayouts.tenantId, tenantId));
  if (row === undefined) {
    return { definition: DEFAULT_LAYOUT, receipt: DEFAULT_RECEIPT };
  }
  return { definition: row.definition as LayoutDef, receipt: row.receipt as ReceiptConfig };
}

/** Author (create or replace) the tenant's till layout. Manager/admin only (`till.configure`). */
export async function putLayout(
  tx: Transaction,
  input: { managementSessionId: string; tenantId: string; definition: unknown },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "till.configure",
  });
  const definition = validateLayout(input.definition);
  await tx
    .insert(tillLayouts)
    // On INSERT the receipt half is the built-in default (a first-time layout author leaves the
    // receipt untouched); on conflict the `set` below never mentions receipt, so an authored one
    // survives.
    .values({ tenantId: input.tenantId, definition, receipt: DEFAULT_RECEIPT })
    .onConflictDoUpdate({
      target: tillLayouts.tenantId,
      set: { definition, updatedAt: sql`now()` },
    });
}
