import { sql } from "drizzle-orm";
import { stampDeployment, withTenant, type Database } from "@waitron/db";
import {
  applyVenue,
  assertNoForeignTenant,
  deriveTenantId,
  planVenue,
  readTenantIdentities,
  type VenueRequest,
  type VenueResult,
} from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import {
  disabledProvisionOnly,
  enabledModules,
  fiscalSlot,
  type ModuleConfig,
} from "@waitron/module";
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
  /** The name of the target database `ownerDb` writes — echoed by `provisioning.foreign_tenant`
   * when a foreign tenant is refused (operator-typed configuration, never a secret). Boot derives
   * it from `config.migrationsDatabaseUrl`. */
  readonly database: string;
}

/**
 * Validate the module set and venue, refuse a FOREIGN or already-present tenant, then stamp and
 * provision. This is the UI production tenant-creation path (`POST /setup-api/provision`); the `venue`
 * CLI and the mirror `adoptFromPrimary` are the others, and all share `assertNoForeignTenant`
 * (one tenant per database, §5).
 * The module-set validation is two-part (both before any DB write, since `applyVenue` mints an
 * unrecoverable SIF/hash chain, §5): a `provision-only` module that is NOT a fiscal-slot member must
 * not be disabled (`module.provision_only_disabled`), and the fiscal slot must resolve to exactly one
 * enabled module (`module.fiscal_slot_empty` / `module.fiscal_slot_ambiguous`).
 * Callers must serialize provisioning: the existence checks and applyVenue use separate transactions.
 * The setup route supplies a process-local latch; these checks reject sequential retries.
 * applyVenue commits the tenant, venue rows and enabled module seeds together. The caller
 * persists configuration and seals credentials after this function returns.
 */
export async function provisionVenue(
  deps: ProvisionDeps,
  req: ProvisionRequest,
): Promise<VenueResult> {
  // 0. Provision-only gate. A `provision-only` module that modules.json disables and that is NOT a
  // fiscal-slot member must never be seeded — it mints unrecoverable state at provision (CLAUDE.md
  // §5). Fiscal-slot members are excluded here and governed by the slot check (0b): once the slot has
  // two members a deployment always disables one. Generic: it names no module, it iterates the tier.
  const blocked = disabledProvisionOnly(ALL_MODULES, deps.moduleConfig);
  if (blocked.length > 0) {
    throw new AppError("module.provision_only_disabled", { module: blocked[0]! });
  }
  // The set whose seeds this box runs: a disabled module contributes no seed-module action and,
  // because the plan and the apply are built from the SAME list, none can be named that the runner
  // does not hold.
  const modules = enabledModules(ALL_MODULES, deps.moduleConfig);

  // 0b. Fiscal-slot resolution. The provision-only gate above no longer covers a fiscal-slot member
  // (those are governed here), so refuse before any DB write unless exactly one enabled module fills
  // the slot: `module.fiscal_slot_empty` (none) or `module.fiscal_slot_ambiguous` (two). `null` is
  // stamped because no node is minted yet — this is provision, not an adoption of an existing chain.
  fiscalSlot(modules, null);

  // 1. Pure validation — throws before touching the database.
  const plan = planVenue(req.venue, modules);
  const tenantId = deriveTenantId(req.venue.country, req.venue.taxId);

  // One tenant per database is the post-RLS isolation boundary (§5), enforced here, in the `venue`
  // CLI and in the mirror `adoptFromPrimary` — every tenant-creation path — through the shared
  // `assertNoForeignTenant` guard. Read every existing identity ONCE, then decide in order: a
  // FOREIGN tenant is refused first (`provisioning.foreign_tenant`), because with row-level
  // security gone a second `(country, tax_id)` would expose one business's rows to the other; only
  // then, if the SAME identity is already present, is it a re-provision (`setup.already_provisioned`).
  // The applied identity is the plan's `ensure-tenant` action, canonicalized by planVenue, so it
  // compares like-for-like with the stored rows. Both reads run before stamping or minting another venue.
  const ensure = plan.find((a) => a.kind === "ensure-tenant");
  const present = await readTenantIdentities(deps.ownerDb);
  if (ensure !== undefined && ensure.kind === "ensure-tenant") {
    assertNoForeignTenant(present, { country: ensure.country, taxId: ensure.taxId }, deps.database);
  }
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
