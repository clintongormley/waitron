import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenant, type Database, type Transaction } from "@waitron/db";
import { registerSif, type SifRegistration } from "@waitron/fiscal-verifactu";
import { nodeId as brandNodeId, tenantId as brandTenantId } from "@waitron/shared";
import type { VenueAction } from "./venue-plan.js";

export interface VenueApplyDeps {
  /** The OWNER connection to the TARGET database — the admin that ran `instance` and so owns the
   * tables. Task C1's container test proved the owner INSERTs a node under the tenant GUC while a
   * SELECT-only login role cannot, so this runs the whole flow as one role with no grant widened. */
  db: Database;
}

export interface VenueResult {
  tenantId: string;
  locationId: string;
  tillId: string;
  nodeId: string;
  sif: SifRegistration;
  /** The ids of the series actually inserted, in plan order: `[standard, rectificative]`. planVenue
   * rejects equal standard/rectificative codes, so a valid plan always yields exactly those two, in
   * that order; a hand-built plan whose second series collides yields only `[standard]` (the
   * create-series gate below never returns a phantom id for a row it did not insert). */
  seriesIds: string[];
}

/**
 * Runs one plan as ONE transaction under `withTenant`, mirroring provisionNode (NOT applyInstance:
 * there is no cluster DDL here, and a single transaction is what a partial venue must never be).
 * The tenant scope is adopted from the ensure-tenant action's deterministic id, so every WITH CHECK
 * (`tenant_id = current_tenant_id()`) is satisfied by the row this run inserts.
 *
 * Idempotency is `ON CONFLICT DO NOTHING` on the natural keys — the transaction-safe form of spec
 * D8's "insert, treat conflict as already-present" (a bare 23505 catch would poison the
 * transaction). It applies only where a natural key exists: the tenant (country, tax_id) and the
 * series (tenant, node, code). Location/till/node have no business key — a tenant legitimately has
 * many shops — so a re-run ADDS a shop; it never resumes a half-built one, and never re-registers
 * an existing node's SIF (the fiscally load-bearing guard, spec D5): each run creates a FRESH node,
 * so `registerSif` mints a new installation number and starts a new chain rather than forking one.
 */
export async function applyVenue(
  actions: readonly VenueAction[],
  deps: VenueApplyDeps,
): Promise<VenueResult> {
  const ensure = actions.find((a) => a.kind === "ensure-tenant");
  if (ensure === undefined || ensure.kind !== "ensure-tenant") {
    throw new Error("applyVenue: plan is missing ensure-tenant");
  }
  const tenantId = ensure.tenantId;

  // Re-run idempotency (reuse the obligado, ON CONFLICT DO NOTHING) relies on every tenant for a
  // (country, tax_id) having been created with this deterministic obligadoTenantId: a re-run adopts
  // the derived id as its scope and inserts locations under it. This holds because `venue` is now
  // the ONLY production tenant-creation path (bootstrap-tenant.sql retired 2026-08-04). A future
  // path inserting a random-id tenant for the same identity would leave the ensure-tenant ON
  // CONFLICT a no-op while this scope adopts the derived id, so the locations FK to tenants(id) fails.
  return withTenant(deps.db, tenantId, async (tx) => {
    let locationId = "";
    let tillId = "";
    let nodeId = "";
    let sif: SifRegistration | undefined;
    const seriesIds: string[] = [];

    for (const action of actions) {
      switch (action.kind) {
        case "ensure-tenant":
          // Deterministic id + explicit id satisfies WITH CHECK (id = current_tenant_id()); DO
          // NOTHING reuses an existing obligado (spec D8). No tax_id lookup — RLS forbids it.
          await tx.execute(sql`
            insert into tenants (id, country, tax_id, legal_name)
            values (${action.tenantId}, ${action.country}, ${action.taxId}, ${action.legalName})
            on conflict (country, tax_id) do nothing`);
          break;
        case "seed-admin":
          // Seed the tenant's admin ONCE. Like ensure-tenant's ON CONFLICT DO NOTHING, this makes a
          // re-run a no-op on a row keyed to the TENANT — the admin belongs to the obligado, not to a
          // shop, so the D8 second-shop re-run (create-location/create-till/create-node deliberately
          // ADD a shop each run) must not add a duplicate admin each time. A plain insert did exactly
          // that. `insert … select … where not exists` seeds the admin only if the tenant has none
          // yet (the `role='admin'` predicate, RLS-scoped to this tenant; the explicit tenant_id is
          // redundant under RLS but guards a non-scoped connection, as elsewhere here). Raw SQL like
          // every other insert — no @waitron/identity import; the `persons` table exists because the
          // identity migrations run before a venue is applied. `pin_hash` (till) and `password_hash`
          // (dashboard) are already scrypt hashes, hashed at the CLI boundary, never a plaintext
          // secret. `role='admin'` is the whole point: this person can log in and authorize privileged
          // actions from day one.
          await tx.execute(sql`
            insert into persons (tenant_id, display_name, pin_hash, password_hash, role)
            select ${tenantId}, ${action.displayName}, ${action.pinHash}, ${action.passwordHash}, 'admin'
            where not exists (
              select 1 from persons where tenant_id = ${tenantId} and role = 'admin')`);
          break;
        case "create-location": {
          locationId = randomUUID();
          // `invoice_locales` is `text[]`. A JS array interpolated straight into a `sql` template
          // (`${action.invoiceLocales}`, as the brief drafted) is expanded by Drizzle into a
          // value LIST — `values (…, ($4), …)` binding `$4 = 'es-ES'` — which Postgres rejects
          // with `22P02 malformed array literal` (observed in this task's first green run). Build
          // the array literal explicitly instead, each element its OWN bound param
          // (`array[$n, …]::text[]`), so nothing is string-concatenated.
          const invoiceLocales = sql`array[${sql.join(
            action.invoiceLocales.map((locale) => sql`${locale}`),
            sql`, `,
          )}]::text[]`;
          await tx.execute(sql`
            insert into locations
              (id, tenant_id, name, invoice_locales, operation_description, fiscal_territory,
               address_line1, address_line2, postal_code, city, province, time_zone, day_cutover)
            values (${locationId}, ${tenantId}, ${action.name}, ${invoiceLocales},
               ${action.operationDescription}, ${action.fiscalTerritory}, ${action.addressLine1},
               ${action.addressLine2}, ${action.postalCode}, ${action.city}, ${action.province},
               ${action.timeZone}, ${action.dayCutover})`);
          // KDS-1: seed this location's DEFAULT kitchen station so firing (placeOrder / sendToPrep / a
          // tab's round-send → fireLines) has a fallback the instant the venue exists. Spec §2a ("one
          // default") + §2b: a location with NO default station makes firing a fail-loud
          // `station.no_default` misconfiguration, so a fresh venue must ship one. Owner-role INSERT under
          // the tenant GUC — the same tx/role that just inserted the location, so the FORCE-RLS
          // `kitchen_stations_tenant_isolation` WITH CHECK passes (tenant_id = current_tenant_id()). The
          // operator can rename it later via updateStation; `station.no_default` then guards only the
          // deactivated-last-station edge, not a fresh venue.
          await tx.execute(sql`
            insert into kitchen_stations (tenant_id, location_id, name, display_order, is_default, active)
            values (${tenantId}, ${locationId}, 'Cocina', 0, true, true)`);
          break;
        }
        case "create-till":
          // planVenue always emits create-location first, so `locationId` is set here. A malformed
          // or future-planner plan that runs create-till early would insert an EMPTY location_id — a
          // low-signal 22P02 (invalid uuid). Refuse it as a plan-integrity error instead. A plain
          // Error, NOT an operator-facing AppError code: this is a programming/plan bug, not input.
          if (locationId === "") throw new Error("applyVenue: create-till before create-location");
          tillId = randomUUID();
          await tx.execute(sql`
            insert into tills (id, tenant_id, location_id, name)
            values (${tillId}, ${tenantId}, ${locationId}, ${action.name})`);
          break;
        case "create-node":
          // As create-till: create-node before create-location would insert an empty location_id.
          if (locationId === "") throw new Error("applyVenue: create-node before create-location");
          nodeId = randomUUID();
          await tx.execute(sql`
            insert into nodes (id, tenant_id, location_id, name, filing_module, tax_module)
            values (${nodeId}, ${tenantId}, ${locationId}, ${action.name}, ${action.filingModule}, ${action.taxModule})`);
          break;
        case "register-sif":
          // register-sif before create-node would register a SIF against an EMPTY node id — fiscally
          // load-bearing (spec D5: a fresh node starts a new chain), so refuse it as a plan-integrity
          // error rather than let it reach `registerSif`.
          if (nodeId === "") throw new Error("applyVenue: register-sif before create-node");
          // registerSif takes nif as a param, so read it here from the tenant we just ensured
          // (never an argument, mirroring provisionNode's obligadoNif: an operator-supplied NIF
          // would file a real tenant's sales under someone else's).
          sif = await registerSifForNode(tx, tenantId, nodeId, action.idSistemaInformatico);
          break;
        case "create-series": {
          // As register-sif: create-series before create-node would insert an empty node_id.
          if (nodeId === "") throw new Error("applyVenue: create-series before create-node");
          const seriesId = randomUUID();
          const inserted = await tx.execute<{ id: string }>(sql`
            insert into invoice_series (id, tenant_id, node_id, code, purpose)
            values (${seriesId}, ${tenantId}, ${nodeId}, ${action.code}, ${action.purpose})
            on conflict (tenant_id, node_id, code) do nothing
            returning id`);
          // Push ONLY when a row was actually inserted. `ON CONFLICT DO NOTHING` returns no rows on
          // a collision, and returning the un-inserted id would put a PHANTOM id in the result — a
          // row that does not exist. planVenue now rejects equal standard/rectificative codes
          // up front, so a valid plan never collides here; this keeps VenueResult honest even for a
          // hand-built plan that does (defense in depth, proven by venue-apply.test.ts).
          if (inserted.rows.length > 0) seriesIds.push(seriesId);
          break;
        }
      }
    }

    if (sif === undefined) throw new Error("applyVenue: register-sif never ran");
    // Completeness guard for the one id no LATER action depends on: the ordering guards make
    // locationId/nodeId non-empty whenever a dependent action runs (and a plan with none of them
    // trips `sif === undefined` above), but nothing downstream reads tillId, so an OMITTED create-till
    // slips through and would return a "complete" venue with an empty till id — a shop that cannot
    // sell (recordSale needs a real till). Named here rather than left to fail confusingly later.
    if (tillId === "") throw new Error("applyVenue: plan is missing create-till");
    return { tenantId, locationId, tillId, nodeId, sif, seriesIds };
  });
}

/** Reads the obligado's tax_id (the NIF) from the tenant row and registers the node as its SIF. */
async function registerSifForNode(
  tx: Transaction,
  tenantId: string,
  nodeId: string,
  idSistemaInformatico: string,
): Promise<SifRegistration> {
  const rows = await tx.execute<{ tax_id: string }>(
    sql`select tax_id from tenants where id = ${tenantId}`,
  );
  const nif = rows.rows[0]?.tax_id;
  if (nif === undefined) throw new Error("applyVenue: tenant vanished before SIF registration");
  return registerSif(tx, {
    tenantId: brandTenantId(tenantId),
    nodeId: brandNodeId(nodeId),
    nif,
    idSistemaInformatico,
  });
}
