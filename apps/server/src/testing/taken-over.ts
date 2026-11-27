import { onTestFinished } from "vitest";
import { invoiceSeries, withTransaction } from "@waitron/db";
import { seedNode } from "@waitron/db/testing/seed.js";
import {
  openSuccessorInstallation,
  recordTakeover,
} from "@waitron/fiscal-verifactu/test/takeover-fixture.js";
import type { NodeId } from "@waitron/shared";
import type { BillVenue } from "./bill-venue.js";

let takeovers = 0;

/**
 * Makes `venue` the box that took over from the one that issued its sales so far: a new node with
 * its own open installation and corrective series, recorded as a finished handover from the old
 * box, whose records stay as they are.
 * `venue.cfg`, and every app `venue.appWith` mounts from now on, name the new box until the test
 * finishes; `venue.app` keeps the old one. Answers the new node.
 */
export async function takeOver(venue: BillVenue): Promise<NodeId> {
  const was = venue.cfg.nodeId;
  // Invoice numbers are unique across the taxpayer's boxes, so each new box numbers its own series.
  const series = `T${++takeovers}`;
  const nodeId = await withTransaction(venue.db, async (tx) => {
    const node = await seedNode(tx);
    await openSuccessorInstallation(tx, was, node);
    await tx.insert(invoiceSeries).values([
      { nodeId: node, code: `${series}R`, purpose: "corrective" },
      { nodeId: node, code: `${series}F`, purpose: "full_corrective" },
    ]);
    return node;
  });
  await recordTakeover(venue.db, was, nodeId);
  Object.assign(venue.cfg, { nodeId });
  onTestFinished(() => {
    Object.assign(venue.cfg, { nodeId: was });
  });
  return nodeId;
}
