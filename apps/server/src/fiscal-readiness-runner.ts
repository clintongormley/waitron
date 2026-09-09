import { createHash } from "node:crypto";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { recordSale } from "@waitron/core";
import { createPgliteDb, runMigrations, withTenant } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import type { FiscalContribution } from "@waitron/fiscal";
import { migrationOptionsFor } from "@waitron/migrations";
import { orderedMigrationSets, type WaitronModule } from "@waitron/module";
import { nodeId, seriesId, tenantId, tillId } from "@waitron/shared";
import {
  applyVenue,
  planVenue,
  readTenantIdentities,
  type VenueRequest,
  type VenueResult,
} from "@waitron/provisioning";
import {
  fiscalReadinessBinding,
  type FiscalReadinessInput,
  type FiscalTestStatus,
} from "./fiscal-readiness.js";
import { recoverProvisionedVenue } from "./provision.js";
import { systemClock } from "./till-backend.js";

export function fiscalReadinessInput(args: {
  venue: VenueRequest;
  contribution: FiscalContribution;
  secret: unknown;
  moduleVersions: Record<string, number>;
  applicationVersion: string;
}): FiscalReadinessInput {
  const raw = args.secret as { pfxBase64?: unknown; certKind?: unknown } | undefined;
  const certificateFingerprint =
    typeof raw?.pfxBase64 === "string"
      ? createHash("sha256").update(Buffer.from(raw.pfxBase64, "base64")).digest("hex")
      : null;
  return {
    requirement: args.contribution.activationReadiness,
    fiscalModule: args.contribution.id,
    country: args.venue.country,
    taxId: args.venue.taxId,
    legalName: args.venue.legalName,
    fiscalTerritory: args.venue.location.fiscalTerritory,
    submissionTarget: args.contribution.activationReadinessTarget?.(args.secret) ?? null,
    certificateFingerprint,
    certificateKind: typeof raw?.certKind === "string" ? raw.certKind : null,
    moduleVersions: args.moduleVersions,
    applicationVersion: args.applicationVersion,
  };
}

async function testVenue(
  db: Awaited<ReturnType<typeof createPgliteDb>>,
  venue: VenueRequest,
  modules: readonly WaitronModule[],
): Promise<VenueResult> {
  if ((await readTenantIdentities(db)).length === 0) {
    return applyVenue(planVenue(venue, modules), { db, modules });
  }
  return recoverProvisionedVenue(db, { environment: "preproduction", venue });
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
  now?: () => Date;
}): Promise<FiscalTestStatus> {
  if (args.contribution.activationReadiness === "not-applicable") return "accepted";
  const testIdentity = fiscalReadinessDatabaseKey(args.readinessInput);
  const db = await createPgliteDb(join(args.stateDir, `fiscal-readiness-db-${testIdentity}`));
  try {
    for (const migrations of migrationOptionsFor(
      orderedMigrationSets(args.modules),
      args.migrationsRoot ?? null,
    )) {
      await runMigrations(db, migrations);
    }
    const venue = await testVenue(db, args.venue, args.modules);
    const secret = args.contribution.provisioningSecret;
    if (secret !== undefined)
      await secret.seal({ db, ring: args.ring }, venue.tenantId, args.secret);

    const existing = await db.execute<{ count: number }>(sql`
      select count(*)::int as count from sales where tenant_id = ${venue.tenantId}
    `);
    if (existing.rows[0]!.count === 0) {
      const now = (args.now ?? (() => new Date()))();
      await withTenant(db, venue.tenantId, (tx) =>
        recordSale(
          tx,
          args.contribution.makeBackend({ db, clock: systemClock(), environment: "preproduction" }),
          {
            tenantId: tenantId(venue.tenantId),
            tillId: tillId(venue.tillId),
            nodeId: nodeId(venue.nodeId),
            seriesId: seriesId(venue.seriesIds[0]!),
            locale: args.venue.location.invoiceLocales[0]!,
            invoiceLocales: args.venue.location.invoiceLocales,
            total: "1.00",
            lines: [
              {
                lineNo: 1,
                descriptions: { [args.venue.location.invoiceLocales[0]!]: "Fiscal readiness test" },
                quantity: "1",
                unitPrice: "1.00",
                vatRate: "0.00",
                lineTotal: "1.00",
              },
            ],
            clock: systemClock(),
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
      return "uncertain";
    }
    if (result.recordsAccepted > 0) return "accepted";
    if (result.recordsHalted > 0) return "rejected";
    return "uncertain";
  } finally {
    await db.close();
  }
}
