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
 * Validate the module set and venue, refuse an existing derived tenant id, then stamp and provision.
 * Callers must serialize provisioning: the existence check and applyVenue use separate transactions.
 * The setup route supplies a process-local latch; this check rejects sequential retries.
 * applyVenue commits the tenant, venue rows and enabled module seeds together. The caller
 * persists configuration and seals credentials after this function returns.
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

  // Refuse a tenant id already present before stamping or minting another venue.
  const alreadyProvisioned = await withTenant(deps.ownerDb, tenantId, async (tx) => {
    const rows = await tx.execute(sql`select 1 from tenants where id = ${tenantId}`);
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
