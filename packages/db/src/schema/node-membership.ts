import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { count, json, now, table, ts } from "./columns.js";
import type { SignedMembershipDocument } from "@waitron/membership";

/**
 * The venue's current membership document. A whole-database operational singleton, like
 * `deployment`.
 *
 * The signed document is stored as ONE unit (the whole `SignedMembershipDocument`), never a
 * per-row synced table — a row-image would not carry a signature over the node list. Stored as
 * parsed JSON rather than the signed bytes, which is safe because verification recomputes
 * `canonicalize(body)` from the parsed object (`packages/membership/src/verify.ts`).
 */
export const nodeMembership = table(
  "node_membership",
  {
    id: count("id").primaryKey().notNull().default(1),
    document: json<SignedMembershipDocument>("document").notNull(),
    updatedAt: ts("updated_at").notNull().$defaultFn(now),
  },
  (t) => [check("node_membership_singleton_ck", sql`${t.id} = 1`)],
);
