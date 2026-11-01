import type { Database, NodeDatabase } from "@waitron/db";

/** A box's two files, `venue.db` and its `node.db`. */
export interface VenueAndNodeHandles {
  readonly venue: Database;
  readonly node: NodeDatabase;
}
