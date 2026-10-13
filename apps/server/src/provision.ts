import { sql } from "drizzle-orm";
import { stampDeployment, withTransaction, type Database, type Transaction } from "@waitron/db";
import {
  applyVenue,
  parseInitialVenueInput,
  initialVenueApplyInput,
  assertNoForeignTenant,
  planVenue,
  readTenantIdentities,
  venueFiscalSelection,
  type VenueRequest,
  type VenueResult,
  type InitialVenueInput,
} from "@waitron/provisioning";
import { AppError, locationId, nodeId } from "@waitron/shared";
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
  /** country/taxId/legalName/location/series/admin(hashed) — every field the wizard collects. */
  venue: VenueRequest;
  /** Server-derived from the selected Live journey; browser input cannot name a staged file directly. */
  configurationImport?: boolean;
  /** The import goes to a different taxpayer: the request's tax ID must differ from the bundle's. */
  newTaxpayer?: boolean;
  initialOperations?: InitialVenueInput;
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

export async function recoverProvisionedVenue(
  ownerDb: Database,
  req: ProvisionRequest,
): Promise<VenueResult> {
  const venue = structuredClone(req.venue);
  const initial =
    req.initialOperations === undefined ? undefined : parseInitialVenueInput(req.initialOperations);
  const refuse = (): never => {
    throw new AppError("setup.already_provisioned", {});
  };
  if (initial === null) return refuse();
  const bases = [
    { code: venue.seriesCode, purpose: "standard" },
    { code: venue.fullSeriesCode ?? "FF", purpose: "full" },
    { code: venue.rectificativeSeriesCode, purpose: "rectificative" },
  ];
  const selection = venueFiscalSelection(ALL_MODULES, venue.location.fiscalTerritory);
  const owners = enabledModules(ALL_MODULES, selection.config).filter(
    (module) =>
      module.fiscal?.id === selection.contribution?.id &&
      module.provisioning?.seed?.series !== undefined,
  );
  if (owners.length > 1) return refuse();
  return withTransaction(ownerDb, async (tx) => {
    const found = await tx.execute<{ locationId: string; nodeId: string }>(sql`
      select l.id as "locationId", n.id as "nodeId"
      from locations l join nodes n on n.location_id = l.id
      where l.name = ${venue.location.name}
        and l.fiscal_territory = ${venue.location.fiscalTerritory}
        and n.name = ${venue.location.name}`);
    if (found.rows.length !== 1) return refuse();
    const row = found.rows[0]!;
    if (initial !== undefined) {
      if (row.nodeId !== initial.nodeId) return refuse();
      const administrator = await tx.execute<{ id: string }>(sql`
        select id from persons where id = ${initial.administratorId}
          and role = 'admin' and status = 'active'`);
      if (administrator.rows.length !== 1) return refuse();
    }
    const resolver = owners[0]?.provisioning?.seed?.series;
    const expected: readonly { id?: string; code: string; purpose: string }[] =
      resolver === undefined
        ? bases
        : await resolver.resolve(
            tx,
            { nodeId: nodeId(row.nodeId), locationId: locationId(row.locationId) },
            bases,
          );
    const series = await tx.execute<{ id: string; purpose: string; code: string }>(sql`
      select id, purpose, code from invoice_series where node_id = ${row.nodeId}`);
    if (
      expected.length !== 3 ||
      series.rows.length !== 3 ||
      new Set(expected.map((reference) => reference.purpose)).size !== 3
    )
      return refuse();
    const references = bases.map((base) => {
      const reference = expected.find((item) => item.purpose === base.purpose);
      return series.rows.find(
        (item) =>
          item.purpose === base.purpose &&
          item.code === reference?.code &&
          (reference.id === undefined || item.id === reference.id),
      );
    });
    if (references.some((reference) => reference === undefined)) return refuse();
    return {
      locationId: row.locationId,
      nodeId: row.nodeId,
      seriesIds: references.map((reference) => reference!.id),
      seeded: [],
    };
  });
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
  const initial =
    req.initialOperations === undefined ? undefined : parseInitialVenueInput(req.initialOperations);
  if (
    initial === null ||
    initial?.inputs.some(
      (input) =>
        !modules.some(
          (module) =>
            module.name === input.module &&
            module.operations !== undefined &&
            module.provisioning?.seed !== undefined,
        ),
    )
  )
    throw new AppError("setup.request_invalid", { field: "initialOperations" });

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
    ...(initial === undefined ? {} : initialVenueApplyInput(initial)),
    db: deps.ownerDb,
    modules,
    beforeCommit: deps.beforeCommit,
  });

  // Without this file the default-on set enables BOTH fiscal modules and the trading boot fails
  // `module.fiscal_slot_ambiguous`. Written after the commit, so a failed mint leaves none behind.
  await writeModuleConfig(deps.stateDir, deps.moduleConfig);
  return result;
}
