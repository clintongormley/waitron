import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenant, type Database, type Transaction } from "@waitron/db";
import { startManagementSession } from "@waitron/identity";
import { createDeviceProfile, listDeviceProfiles } from "@waitron/layouts";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  tenantId as brandTenantId,
} from "@waitron/shared";
import type { CapabilityFlag } from "@waitron/layouts";
import type { SeedReport, WaitronModule } from "@waitron/module";
import type { VenueAction } from "./venue-plan.js";

export interface VenueApplyDeps {
  /** The OWNER connection to the TARGET database — the admin that ran `instance` and so owns the
   * tables. Task C1's container test proved the owner INSERTs a node under the tenant GUC while a
   * SELECT-only login role cannot, so this runs the whole flow as one role with no grant widened. */
  db: Database;
  /** The modules whose seeds a `seed-module` action may name — the enabled set, in the composition
   * list's order. */
  modules: readonly WaitronModule[];
}

export interface VenueResult {
  tenantId: string;
  locationId: string;
  tillId: string;
  nodeId: string;
  /** The ids of the series actually inserted, in plan order: `[standard, rectificative]`. planVenue
   * rejects equal standard/rectificative codes, so a valid plan always yields exactly those two, in
   * that order; a hand-built plan whose second series collides yields only `[standard]` (the
   * create-series gate below never returns a phantom id for a row it did not insert). */
  seriesIds: string[];
  /** One entry per `seed-module` action run, in plan order: the module and its one-line report. */
  seeded: readonly SeedReport[];
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
 * many shops — so a re-run ADDS a shop; it never resumes a half-built one: each run creates a FRESH
 * node and runs every module's seed for it, so the fiscal seed mints a new installation number and
 * starts a new chain rather than forking one.
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
    const seeded: SeedReport[] = [];
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
          // actions from day one. `email` is the admin's dashboard-login address, captured during
          // onboarding — OPTIONAL, so NULL when the request omits it (the CLI/dev-setup/e2e paths seed
          // an emailless admin); validated/normalized at the setup-api boundary, written verbatim here.
          await tx.execute(sql`
            insert into persons (tenant_id, display_name, pin_hash, password_hash, email, role)
            select ${tenantId}, ${action.displayName}, ${action.pinHash}, ${action.passwordHash}, ${action.email ?? null}, 'admin'
            where not exists (
              select 1 from persons where tenant_id = ${tenantId} and role = 'admin')`);
          break;
        case "seed-device-profiles":
          // Non-fiscal. Seed the tenant's starter device profiles under an admin management session —
          // the SAME store path the management dashboard uses (createDeviceProfile), so its
          // capability validation and the `till.configure` gate run here too. seed-admin must have run
          // first (the admin is the only person who can open that session); a hand-built plan that
          // runs this before seed-admin is refused as a plan-integrity error, mirroring the ordering
          // guards below. Idempotent: find-or-create by name, so a D8 second-shop re-run adds no
          // duplicate (profiles belong to the tenant, not a shop). Runs on the caller's owner tx under
          // the tenant GUC — device_profiles/management_sessions are FORCE-RLS, satisfied because
          // withTenant set current_tenant_id() to this tenant, proven under the owner role in
          // venue-apply.node-privilege.rls.test.ts.
          await seedDeviceProfiles(tx, tenantId, action.profiles);
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
          // operator can rename it later via updateStation; `station.no_default` then guards any venue
          // left with no ACTIVE default station — including one whose sole default was DEACTIVATED
          // (fireLines' fallback requires `is_default AND active`) — not a fresh venue, which always ships
          // this one.
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
        case "seed-module": {
          // A seed before create-node would run against an EMPTY node id; refuse it as a plan-integrity
          // error like the other ordering guards.
          if (nodeId === "") throw new Error("applyVenue: seed-module before create-node");
          const seed = deps.modules.find((m) => m.name === action.module)?.provisioning?.seed;
          if (seed === undefined) {
            throw new Error(
              `applyVenue: seed-module names ${action.module}, which is not in deps.modules or declares no seed`,
            );
          }
          const report = await seed.run(tx, {
            tenantId: brandTenantId(tenantId),
            locationId: brandLocationId(locationId),
            nodeId: brandNodeId(nodeId),
          });
          seeded.push({ module: action.module, report });
          break;
        }
        case "create-series": {
          // create-series before create-node would insert an empty node_id.
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

    // Completeness guards for ids the ordering guards above cannot cover. Those guards only fire when
    // a DEPENDENT action runs, so a plan that omits create-node (and therefore every seed and series
    // that depends on it) reaches here with an empty nodeId, and a plan that omits create-till reaches
    // here with an empty tillId — nothing downstream reads it at all. Either way the venue would be
    // returned as "complete" with an empty id: a node that files nothing, or a shop that cannot sell
    // (recordSale needs a real till). Named here rather than left to fail confusingly later. Plain
    // Errors, NOT operator-facing AppError codes: a plan bug, not input.
    if (nodeId === "") throw new Error("applyVenue: plan is missing create-node");
    if (tillId === "") throw new Error("applyVenue: plan is missing create-till");
    return { tenantId, locationId, tillId, nodeId, seriesIds, seeded };
  });
}

/**
 * Seed the tenant's starter device profiles idempotently (find-or-create by name). Looks up the admin
 * seed-admin created — the only person who can open a `till.configure` management session the store's
 * `createDeviceProfile` authorises against — opens one, and creates each missing profile with
 * `canvasId: null` (→ the form-factor default canvas at runtime). Names + capabilities are already
 * resolved by the planner. Runs on the caller's tenant-scoped tx.
 */
async function seedDeviceProfiles(
  tx: Transaction,
  tenantId: string,
  profiles: { name: string; capabilities: CapabilityFlag[] }[],
): Promise<void> {
  // Find-or-create is NAME-based, so idempotency is scoped to a SAME-LOCALE, same-names re-provision: a
  // different-locale re-run would seed a second, differently-named set, and a tenant who renamed a
  // seeded profile would have it re-created. Acceptable because profiles are tenant-editable AND the
  // double-provision latch makes a tenant re-provision unreachable in practice.
  const existing = new Set((await listDeviceProfiles(tx, tenantId)).map((p) => p.name));
  const toCreate = profiles.filter((p) => !existing.has(p.name));
  if (toCreate.length === 0) return; // a re-provision whose profiles all exist: nothing to do

  // The admin seed-admin created (role='admin') authors the profiles; a plan that reaches here without
  // one ran seed-device-profiles before seed-admin — a plan-integrity bug, refused like the ordering
  // guards in the apply loop. Raw SQL, like the other lookups here (no @waitron/identity persons import).
  const admin = await tx.execute<{ id: string }>(
    sql`select id from persons where tenant_id = ${tenantId} and role = 'admin' limit 1`,
  );
  const personId = admin.rows[0]?.id;
  if (personId === undefined) {
    throw new Error("applyVenue: seed-device-profiles before seed-admin");
  }
  const session = await startManagementSession(tx, { tenantId, personId });
  for (const profile of toCreate) {
    await createDeviceProfile(tx, {
      managementSessionId: session.id,
      tenantId,
      name: profile.name,
      canvasId: null,
      capabilities: profile.capabilities,
    });
  }
}
