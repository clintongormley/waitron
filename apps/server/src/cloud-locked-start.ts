import { join } from "node:path";
import { lockVenueDatabase } from "@waitron/db";
import { NODE_FILE, openBackupQuery, VENUE_FILE } from "@waitron/store";
import { placeEmergencyCopy } from "./emergency-copy-placement.js";

/** Immutable readers need the folder held: they deliberately ignore SQLite's journals. */
export async function openLockedCopy(deps: Parameters<typeof placeEmergencyCopy>[0]) {
  const hold = await lockVenueDatabase(deps.venueDir);
  let venue: Awaited<ReturnType<typeof openBackupQuery>> | undefined;
  let node: Awaited<ReturnType<typeof openBackupQuery>> | undefined;
  async function close() {
    try {
      await node?.close();
    } finally {
      try {
        await venue?.close();
      } finally {
        hold.release();
      }
    }
  }
  try {
    await placeEmergencyCopy(deps);
    venue = await openBackupQuery(join(deps.venueDir, VENUE_FILE), { immutable: true });
    node = await openBackupQuery(join(deps.venueDir, NODE_FILE), { immutable: true });
    return { venue: venue.query, node: node.query, close };
  } catch (error) {
    await close();
    throw error;
  }
}
