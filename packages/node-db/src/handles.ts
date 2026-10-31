import type { Database, NodeDatabase } from "@waitron/db";

/** A box's two files, for a write that reads `venue.db` and writes `node.db`. */
export interface VenueAndNodeHandles {
  readonly venue: Database;
  readonly node: NodeDatabase;
}
