import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { bigCount, count, json, now, table, ts } from "./columns.js";
import type { SignedMembershipDocument } from "@waitron/membership";

/**
 * The venue's current membership document. A whole-database operational singleton, like
 * `deployment`.
 *
 * The signed document is stored as ONE unit (the whole `SignedMembershipDocument`), never a
 * per-row synced table — a row-image would not carry a signature over the node list. Stored as
 * parsed JSON rather than the signed bytes, which is safe because verification recomputes
 * `canonicalize(body)` from the parsed object (`packages/membership/src/verify.ts`). `term` is
 * denormalised into its own column from `document.body.term` so ordering/superseding can be read
 * without parsing the blob. `writeNodeMembership` derives the column from the blob on every write,
 * so a write through that accessor keeps the two in step — a property of the accessor, not a DB
 * constraint (a raw SQL write could set them apart).
 */
export const nodeMembership = table(
  "node_membership",
  {
    id: count("id").primaryKey().notNull().default(1),
    // Read back as a JS `number` (`bigCount`): `term` increments by one per edit, so it never
    // approaches 2^53.
    term: bigCount("term").notNull(),
    document: json<SignedMembershipDocument>("document").notNull(),
    updatedAt: ts("updated_at").notNull().$defaultFn(now),
  },
  /* v8 ignore start */
  (t) => [check("node_membership_singleton_ck", sql`${t.id} = 1`)],
  /* v8 ignore stop */
);
