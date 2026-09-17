import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/pg-core";
import { bigCount, count, json, table, ts } from "./columns.js";
import type { SignedMembershipDocument } from "@waitron/membership";

/**
 * The venue's current membership document (membership & rejoin wire-protocol, design §3). A whole-
 * database operational singleton, like `deployment` and `mirror_config`.
 *
 * The signed document is stored as ONE unit (the `document` jsonb column holds the whole
 * `SignedMembershipDocument`), never a per-row synced table — a row-image would not carry a
 * signature over the node list (design §3). `jsonb` follows the package's convention for structured
 * document columns (catalogue/incidents/layouts/…), so the driver parses it on read and Drizzle
 * serialises it on write — no hand-rolled JSON. jsonb key-reordering is harmless because
 * verification recomputes `canonicalize(body)` from the parsed object (packages/membership). `term`
 * is denormalised into its own bigint column from `document.body.term` so ordering/superseding can
 * be read without parsing the blob. `writeNodeMembership` derives the column from the blob on every
 * write, so a write through that accessor keeps the two in step — a property of the accessor, not a
 * DB constraint (a raw SQL write could set them apart).
 *
 * Deliberately NOT re-exported from `./schema/index.ts` (which `drizzle.config.ts` reads and
 * `client.ts` derives `Schema` from), for the same reason `mirror-config.ts`/`deployment.ts` are:
 * `0001_db_baseline_sql.sql` is a hand-written custom migration, so drizzle-kit never diffed this
 * table into any snapshot. Adding it to the barrel would risk a duplicate `CREATE TABLE` on the next
 * plain `drizzle-kit generate`. The accessors are exported from the package barrel (`../index.ts`,
 * via `../node-membership.ts`); that surface is unaffected.
 */
export const nodeMembership = table(
  "node_membership",
  {
    id: count("id").primaryKey().notNull().default(1),
    // The Slice-1 document's `term`, held as a bigint column and read back as a JS `number`
    // (`bigCount`); the ≤3-node topology increments `term` by one per edit, so it never
    // approaches 2^53.
    term: bigCount("term").notNull(),
    document: json<SignedMembershipDocument>("document").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [check("node_membership_singleton_ck", sql`${t.id} = 1`)],
);
