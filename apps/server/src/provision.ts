import { sql } from "drizzle-orm";
import { stampDeployment, withTransaction, type Database, type Transaction } from "@waitron/db";
import {
  applyVenue,
  assertNoForeignTenant,
  planVenue,
  readTenantIdentities,
  venueFiscalSelection,
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
import { writeModuleConfig } from "./module-config.js";
import "./errors.js";

/**
 * The operator `base` with the fiscal slot forced onto the module the venue's TERRITORY selects — the
 * territory, not a default or a toggle, decides the slot. Throws `fiscal.regime_not_implemented` for an
 * unimplemented territory.
 */
export function venueModuleConfig(base: ModuleConfig, fiscalTerritory: string): ModuleConfig {
  return venueFiscalSelection(ALL_MODULES, fiscalTerritory, base).config;
}

export interface ProvisionRequest {
  /** The fiscal environment this box is being stamped for. Demo and Prepare are preproduction. */
  environment: "production" | "preproduction";
  /** country/taxId/legalName/location/tillName/series/admin(hashed) — every field the wizard collects. */
  venue: VenueRequest;
  /** Server-derived from the selected Live journey; browser input cannot name a staged file directly. */
  configurationImport?: boolean;
}

export interface ProvisionDeps {
  ownerDb: Database;
  /** The fiscal slot ALREADY resolved to exactly one member by the caller's `venueModuleConfig`. */
  readonly moduleConfig: ModuleConfig;
  /** Echoed by `provisioning.foreign_tenant`, so it must never carry a secret. */
  readonly database: string;
  readonly stateDir: string;
  readonly beforeCommit?: (tx: Transaction, result: VenueResult) => Promise<void>;
}

/**
 * Recover the identifiers minted by a matching persisted setup operation. This is deliberately
 * narrower than a general "find venue" query: first boot creates one location, till and node for a
 * previously empty tenant, and both invoice series must still match the submitted codes. A shape
 * outside those invariants is refused instead of guessing which fiscal identity to publish.
 */
export async function recoverProvisionedVenue(
  ownerDb: Database,
  req: ProvisionRequest,
): Promise<VenueResult> {
  const venue = await withTransaction(ownerDb, (tx) =>
    tx.execute<{ locationId: string; tillId: string; nodeId: string }>(sql`
      select l.id as "locationId", t.id as "tillId", n.id as "nodeId"
      from locations l
      join tills t on t.location_id = l.id
      join nodes n on n.location_id = l.id
      where l.name = ${req.venue.location.name}
        and l.fiscal_territory = ${req.venue.location.fiscalTerritory}
        and t.name = ${req.venue.tillName}
        and n.name = ${req.venue.location.name}`),
  );
  if (venue.rows.length !== 1) {
    throw new AppError("setup.already_provisioned", {});
  }
  const row = venue.rows[0]!;
  const series = await withTransaction(ownerDb, (tx) =>
    tx.execute<{ id: string; purpose: string; code: string }>(sql`
      select id, purpose, code
      from invoice_series
      where node_id = ${row.nodeId}`),
  );
  const standard = series.rows.find(
    (item) => item.purpose === "standard" && item.code === req.venue.seriesCode,
  );
  const rectificative = series.rows.find(
    (item) => item.purpose === "rectificative" && item.code === req.venue.rectificativeSeriesCode,
  );
  if (series.rows.length !== 2 || standard === undefined || rectificative === undefined) {
    throw new AppError("setup.already_provisioned", {});
  }
  return {
    locationId: row.locationId,
    tillId: row.tillId,
    nodeId: row.nodeId,
    seriesIds: [standard.id, rectificative.id],
    seeded: [],
  };
}

/**
 * Callers must serialize provisioning: the tenant-exists read is not atomic with `applyVenue`. The
 * setup route supplies a process-local latch; the checks below reject sequential retries.
 *
 * Not one transaction: `stampDeployment` writes before `applyVenue`'s transaction opens, so a
 * refusal from `applyVenue` or its `beforeCommit` leaves the database stamped. A retry for the same
 * environment passes the stamp; a different one is refused (`deployment.already_stamped`).
 */
export async function provisionVenue(
  deps: ProvisionDeps,
  req: ProvisionRequest,
): Promise<VenueResult> {
  const blocked = disabledProvisionOnly(ALL_MODULES, deps.moduleConfig);
  if (blocked.length > 0) {
    throw new AppError("module.provision_only_disabled", { module: blocked[0]! });
  }
  // The plan and the apply are built from this SAME list, so no seed can be named that the runner
  // does not hold.
  const modules = enabledModules(ALL_MODULES, deps.moduleConfig);

  // `null`: no node is minted yet, so there is no stamped regime to compare against.
  fiscalSlot(modules, null);

  const plan = planVenue(req.venue, modules);

  // A FOREIGN identity is refused first (`provisioning.foreign_tenant`); only then is any present row
  // a re-provision. `tenants_singleton_ck` pins the id to 1, so a non-empty read IS the taxpayer.
  const ensure = plan.find((a) => a.kind === "ensure-tenant");
  const present = await readTenantIdentities(deps.ownerDb);
  if (ensure !== undefined && ensure.kind === "ensure-tenant") {
    assertNoForeignTenant(present, { country: ensure.country, taxId: ensure.taxId }, deps.database);
  }
  if (present.length > 0) {
    throw new AppError("setup.already_provisioned", {});
  }

  await stampDeployment(deps.ownerDb, req.environment);

  const result = await applyVenue(plan, {
    db: deps.ownerDb,
    modules,
    beforeCommit: deps.beforeCommit,
  });

  // Without this file the default-on set enables BOTH fiscal modules and the trading boot fails
  // `module.fiscal_slot_ambiguous`. Written after the commit, so a failed mint leaves none behind.
  await writeModuleConfig(deps.stateDir, deps.moduleConfig);
  return result;
}
