import { sql } from "drizzle-orm";
import { stampDeployment, withTenant, type Database } from "@waitron/db";
import {
  applyVenue,
  obligadoTenantId,
  planVenue,
  type VenueRequest,
  type VenueResult,
} from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import { disabledProvisionOnly, enabledModules, type ModuleConfig } from "@waitron/module";
import { ALL_MODULES } from "./modules.js";
import "./errors.js";

export interface ProvisionRequest {
  /** The demo/live fork: which environment this box is being stamped for. */
  environment: "production" | "preproduction";
  /** country/taxId/legalName/location/tillName/series/admin(hashed) — every field the wizard collects. */
  venue: VenueRequest;
}

export interface ProvisionDeps {
  /** The OWNER connection to the target database (`config.migrationsDatabaseUrl`) — the admin that
   * owns the tables, which `applyVenue` needs and which `stampDeployment` writes the singleton with. */
  ownerDb: Database;
  /** The desired module set (from `<stateDir>/modules.json`). Two duties: a `provision-only` module
   * disabled here refuses provisioning (spec §4) — never mint an unrecoverable chain for a module
   * that is off — and the enabled set is what `planVenue`/`applyVenue` draw the per-node seeds from,
   * so a disabled module's seed cannot run. */
  readonly moduleConfig: ModuleConfig;
}

/**
 * Stamp the deployment environment, then `applyVenue`, refusing a box that already holds THIS tenant.
 * Returns the ids the trading boot needs (tenant/location/till/node/series) plus one report line per
 * module seed that ran. Does NOT persist config or seal the AEAT cert — the caller does that
 * (onboarding slice 2b).
 *
 * **Concurrency contract — callers MUST serialize concurrent provisions of the same tenant.** The
 * tenant-exists guard below (step 2) is NOT atomic with `applyVenue` (step 4): it reads in one
 * `withTenant` transaction and mints in a separate one, so two provisions of the same box running
 * concurrently could BOTH pass the guard and each reach `applyVenue`, which has no business key on
 * location/till/node/SIF and would mint a SECOND, unrecoverable SIF/hash chain (CLAUDE.md §5). This
 * function does not lock, by design: the invariant is that a Waitron box runs ONE setup process, and
 * the `/setup-api/provision` endpoint holds a synchronous one-shot latch (`setup-api.ts`) that refuses
 * a second provision while one is in flight. That single-process + latch pairing is the serialization;
 * the guard here backstops only the SEQUENTIAL re-POST (a retry after a completed provision), not the
 * concurrent case. A future caller from another process would need its own external lock.
 *
 * The order is load-bearing and matches the plan's D-decisions:
 *  0. **SP-1b fiscal gate.** Before anything else, refuse if a `provision-only` module (fiscal today)
 *     is disabled in `deps.moduleConfig` — `applyVenue` mints an unrecoverable SIF/hash chain
 *     (CLAUDE.md §5), so a disabled provision-only module must never reach it. No DB write has
 *     happened yet.
 *  1. `planVenue` — pure validation (locales/series/territory), so a malformed request throws before
 *     any DB write and no admin connection is spent.
 *  2. **Double-provision guard (the fiscal footgun, R6b).** `applyVenue`'s location/till/node/SIF have
 *     NO business key, so a second run ADDS a shop and mints a FRESH SIF/hash chain (venue-apply.ts's
 *     own header). Nothing in `applyVenue` stops a re-POST from starting a second chain, and a wrong
 *     chain is unrecoverable (CLAUDE.md §5). So before stamping or minting anything, refuse a box that
 *     already holds this tenant. The check reads the DERIVED obligado id under the tenant GUC (spec
 *     D8's insert-and-reuse pattern, never a tax_id lookup RLS would hide): `id = current_tenant_id()`.
 *  3. `stampDeployment` — idempotent for the SAME environment; a CHANGED value throws
 *     `deployment.already_stamped`, the DB-level guard that a preproduction box can never become
 *     production (CLAUDE.md §5). Let it propagate — it is the correct fiscal refusal.
 *  4. `applyVenue` — the single `withTenant` transaction that mints tenant/location/till/node/series,
 *     seeds the admin, runs every enabled module's seed (fiscal's registers the SIF), and returns
 *     the ids.
 */
export async function provisionVenue(
  deps: ProvisionDeps,
  req: ProvisionRequest,
): Promise<VenueResult> {
  // 0. Provision-only gate. A `provision-only` module (fiscal today) that modules.json disables must
  // never be seeded — the fiscal seed mints an unrecoverable chain (CLAUDE.md §5). The gate REFUSES
  // rather than minting a venue without that module: a venue with no fiscal identity needs a fiscal
  // module that seeds none, not a missing one. Generic: it names no module, it iterates the tier.
  const blocked = disabledProvisionOnly(ALL_MODULES, deps.moduleConfig);
  if (blocked.length > 0) {
    throw new AppError("module.provision_only_disabled", { module: blocked[0]! });
  }
  // The set whose seeds this box runs: a disabled module contributes no seed-module action and,
  // because the plan and the apply are built from the SAME list, none can be named that the runner
  // does not hold.
  const modules = enabledModules(ALL_MODULES, deps.moduleConfig);

  // 1. Pure validation — throws before touching the database.
  const plan = planVenue(req.venue, modules);
  const tenantId = obligadoTenantId(req.venue.country, req.venue.taxId);

  // 2. Double-provision guard. `current_tenant_id()` reads the `app.tenant_id` GUC withTenant sets,
  // so this row exists iff the derived obligado has already been provisioned into this box.
  const alreadyProvisioned = await withTenant(deps.ownerDb, tenantId, async (tx) => {
    const rows = await tx.execute(sql`select 1 from tenants where id = current_tenant_id()`);
    return rows.rows.length > 0;
  });
  if (alreadyProvisioned) {
    throw new AppError("setup.already_provisioned", { tenantId });
  }

  // 3. Stamp the environment (throws deployment.already_stamped on a changed value — let it propagate).
  await stampDeployment(deps.ownerDb, req.environment);

  // 4. Mint the venue and every enabled module's seed under one transaction.
  return applyVenue(plan, { db: deps.ownerDb, modules });
}
