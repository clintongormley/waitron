import { bigint, check, integer, jsonb, pgTable, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { SignedMembershipDocument } from "@waitron/membership";

/**
 * The venue's current membership document (membership & rejoin wire-protocol, design §3). A whole-
 * database operational singleton without tenant_id, like `deployment`, `mirror_config` and
 * `sync_cursor`.
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
 * `0096_node_membership.sql` is a hand-written custom migration, so drizzle-kit never diffed this
 * table into any snapshot. Adding it to the barrel would risk a duplicate `CREATE TABLE` on the next
 * plain `drizzle-kit generate`. The accessors are exported from the package barrel (`../index.ts`,
 * via `../node-membership.ts`); that surface is unaffected.
 */
export const nodeMembership = pgTable(
  "node_membership",
  {
    id: integer("id").primaryKey().notNull().default(1),
    // JS `number` (mode) reconciles the Slice-1 document's `number` term with the bigint column; the
    // ≤3-node topology increments `term` by one per edit, so it never approaches 2^53.
    term: bigint("term", { mode: "number" }).notNull(),
    document: jsonb("document").$type<SignedMembershipDocument>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("node_membership_singleton_ck", sql`${t.id} = 1`)],
);
