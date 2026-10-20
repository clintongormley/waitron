import { sql } from "drizzle-orm";
import { withTransaction, type Database } from "@waitron/db";
import { enabledModules, type WaitronModule } from "@waitron/module";
import { AppError, locationId, nodeId } from "@waitron/shared";
import { parseInitialVenueInput, type InitialVenueInput } from "./initial-venue-input.js";
import { venueFiscalSelection } from "./venue-fiscal.js";
import type { VenueRequest } from "./venue-plan.js";
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
    { code: venue.fullSeriesCode ?? "FF", purpose: "full" },
    { code: venue.rectificativeSeriesCode, purpose: "rectificative" },
  ];
  const selection = venueFiscalSelection(availableModules, venue.location.fiscalTerritory);
  const owners = enabledModules(availableModules, selection.config).filter(
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
