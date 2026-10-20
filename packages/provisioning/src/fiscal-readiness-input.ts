import { createHash } from "node:crypto";
import type { FiscalContribution } from "@waitron/fiscal";
import type { VenueRequest } from "./venue-plan.js";
import type { FiscalReadinessInput } from "./fiscal-readiness.js";

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
