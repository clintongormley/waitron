import { join } from "node:path";
import { sql } from "drizzle-orm";
import { recordSale } from "@waitron/core";
import { openVenueDatabase, stampDeployment, withTransaction, type Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import type { FiscalContribution, TrustedClock } from "@waitron/fiscal";
import { applyMigrations, migrationOptionsFor } from "@waitron/migrations";
import { orderedMigrationSets, type WaitronModule } from "@waitron/module";
import { nodeId, seriesId, jobOrigin, AppError } from "@waitron/shared";
import { applyVenue, type VenueResult } from "./venue-apply.js";
import {
  initialVenueApplyInput,
  parseInitialVenueInput,
  type InitialVenueInput,
} from "./initial-venue-input.js";
import { planVenue, type VenueRequest } from "./venue-plan.js";
import { readTenantIdentities } from "./tenant-guard.js";
import { throwawayApplyInput } from "./throwaway-allocation.js";
import {
  fiscalReadinessBinding,
  type FiscalReadinessInput,
  type FiscalTestResult,
} from "./fiscal-readiness.js";
import { recoverProvisionedVenue } from "./recover-provisioned-venue.js";

export { fiscalReadinessInput } from "./fiscal-readiness-input.js";

async function testVenue(
  db: Database,
  venue: VenueRequest,
  modules: readonly WaitronModule[],
  initialOperations?: InitialVenueInput,
): Promise<VenueResult> {
  if ((await readTenantIdentities(db)).length === 0) {
    await stampDeployment(db, "preproduction");
    const plan = planVenue(venue, modules);
    const input =
      initialOperations === undefined
        ? throwawayApplyInput(plan, modules, ["preproduction"])
        : initialVenueApplyInput(initialOperations);
    return applyVenue(plan, {
      db,
      modules: input !== undefined && "modules" in input ? input.modules : modules,
      ...input,
    });
  }
  return recoverProvisionedVenue(db, { venue, initialOperations }, modules);
}

export function fiscalReadinessDatabaseKey(input: FiscalReadinessInput): string {
  return fiscalReadinessBinding(input);
}

/** Exercise the normal record and drain path in a retained, isolated preproduction database. */
export async function submitFiscalReadiness(args: {
  stateDir: string;
  migrationsRoot?: string;
  modules: readonly WaitronModule[];
  venue: VenueRequest;
  contribution: FiscalContribution;
  secret: unknown;
  ring: KeyRing;
  readinessInput: FiscalReadinessInput;
  initialOperations?: InitialVenueInput;
  now?: () => Date;
  clock: () => TrustedClock;
}): Promise<FiscalTestResult> {
  if (args.contribution.activationReadiness === "not-applicable") return { status: "accepted" };
  const request = structuredClone(args.venue);
  const modules = [...args.modules];
  const initial =
    args.initialOperations === undefined
      ? undefined
      : parseInitialVenueInput(args.initialOperations);
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
  const testIdentity = fiscalReadinessDatabaseKey(args.readinessInput);
  // The sample has a real preproduction chain and retains its own venue directory.
  const directory = join(args.stateDir, `fiscal-readiness-db-${testIdentity}`);
  // Migrate before opening the sample handle so migration can acquire its venue hold.
  await applyMigrations(
    directory,
    migrationOptionsFor(orderedMigrationSets(modules), args.migrationsRoot ?? null),
  );
  const store = await openVenueDatabase(directory);
  const db = store.venue;
  try {
    const venue = await testVenue(db, request, modules, initial);
    const secret = args.contribution.provisioningSecret;
    if (secret !== undefined && (args.secret !== undefined || secret.required("preproduction")))
      await secret.seal({ db, ring: args.ring, nodeId: venue.nodeId }, args.secret);

    const existing = await db.execute<{ count: number }>(sql`
      select count(*) as count from sales
    `);
    if (existing.rows[0]!.count === 0) {
      const now = (args.now ?? (() => new Date()))();
      await withTransaction(db, (tx) =>
        recordSale(
          tx,
          args.contribution.makeBackend({ db, clock: args.clock(), environment: "preproduction" }),
          {
            origin: jobOrigin("readiness_test"),
            nodeId: nodeId(venue.nodeId),
            seriesId: seriesId(venue.seriesIds[0]!),
            locale: request.location.invoiceLocales[0]!,
            invoiceLocales: request.location.invoiceLocales,
            total: "1.00",
            lines: [
              {
                lineNo: 1,
                name: "Fiscal readiness test",
                descriptions: { [request.location.invoiceLocales[0]!]: "Fiscal readiness test" },
                quantity: "1",
                unitPrice: "1.00",
                vatRate: "0.00",
                lineTotal: "1.00",
              },
            ],
            clock: args.clock(),
            settlement: {
              kind: "immediate",
              tenders: [{ method: "cash", amount: "1.00", tipAmount: "0.00", settledAt: now }],
            },
          },
        ),
      );
    }
    let result;
    try {
      result = await args.contribution.drain(
        { db, ring: args.ring, environment: "preproduction", skipRetryMs: 0 },
        (args.now ?? (() => new Date()))(),
      );
    } catch {
      return { status: "uncertain" };
    }
    if (result.recordsAccepted > 0) return { status: "accepted" };
    const rejections = await args.contribution.readinessRejections?.(db);
    if (result.recordsHalted > 0 || (rejections?.length ?? 0) > 0) {
      return rejections === undefined ? { status: "rejected" } : { status: "rejected", rejections };
    }
    return { status: "uncertain" };
  } finally {
    await store.close();
  }
}
