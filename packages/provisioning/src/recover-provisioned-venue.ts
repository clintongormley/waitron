import { listAdminHolders } from "@waitron/identity";
import { sql } from "drizzle-orm";
import { readVenue, withTransaction, type Database } from "@waitron/db";
import { readIssueZone } from "@waitron/fiscal";
import { enabledModules, type WaitronModule } from "@waitron/module";
import { AppError, nodeId } from "@waitron/shared";
import { parseInitialVenueInput, type InitialVenueInput } from "./initial-venue-input.js";
import { venueFiscalSelection } from "./venue-fiscal.js";
import type { VenueRequest } from "./venue-plan.js";
import { DEFAULT_SERIES_CODES } from "./default-series-codes.js";
import type { VenueResult } from "./venue-apply.js";
import "./errors.js";

export async function recoverProvisionedVenue(
  ownerDb: Database,
  req: { venue: VenueRequest; initialOperations?: InitialVenueInput },
  availableModules: readonly WaitronModule[],
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
    { code: venue.fullSeriesCode ?? DEFAULT_SERIES_CODES.fullSeriesCode, purpose: "full" },
    { code: venue.correctiveSeriesCode, purpose: "corrective" },
    {
      code: venue.fullCorrectiveSeriesCode ?? DEFAULT_SERIES_CODES.fullCorrectiveSeriesCode,
      purpose: "full_corrective",
    },
  ];
  const selection = venueFiscalSelection(availableModules, venue.fiscalTerritory);
  const owners = enabledModules(availableModules, selection.config).filter(
    (module) =>
      selection.contribution !== undefined &&
      module.fiscal?.id === selection.contribution.id &&
      module.provisioning?.seed?.series !== undefined,
  );
  if (owners.length > 1) return refuse();
  return withTransaction(ownerDb, async (tx) => {
    const found = await tx.execute<{ nodeId: string }>(sql`
      select n.id as "nodeId" from nodes n where n.name = ${venue.name}`);
    if (found.rows.length !== 1) return refuse();
    const savedVenue = await readVenue(tx);
    if (savedVenue.name !== venue.name || savedVenue.fiscalTerritory !== venue.fiscalTerritory)
      return refuse();
    const row = found.rows[0]!;
    await readIssueZone(tx, { nodeId: row.nodeId });
    if (initial !== undefined) {
      if (row.nodeId !== initial.nodeId) return refuse();
      const administrators = await listAdminHolders(tx, { status: "active" });
      if (!administrators.some((person) => person.id === initial.administratorId)) return refuse();
    }
    const resolver = owners[0]?.provisioning?.seed?.series;
    const expected: readonly { id?: string; code: string; purpose: string }[] =
      resolver === undefined
        ? bases
        : await resolver.resolve(tx, { nodeId: nodeId(row.nodeId) }, bases);
    const series = await tx.execute<{ id: string; purpose: string; code: string }>(sql`
      select id, purpose, code from invoice_series where node_id = ${row.nodeId}`);
    if (
      expected.length !== bases.length ||
      series.rows.length !== bases.length ||
      new Set(expected.map((reference) => reference.purpose)).size !== bases.length
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
      nodeId: row.nodeId,
      seriesIds: references.map((reference) => reference!.id),
      seeded: [],
    };
  });
}
