import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { bigCount, count, json, now, table, ts } from "./columns.js";
import type { SignedMembershipDocument } from "@waitron/membership";

/**
 * The venue's current membership document (membership & rejoin wire-protocol, design §3). A whole-
 * database operational singleton, like `deployment`.
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
 * Its accessors are exported from the package barrel (`../index.ts`, via `../node-membership.ts`).
 */
// The bracketed thunks below are resolved by `drizzle-kit generate` in its own CLI process,
// never by `vitest run`, so v8 reports them as never-invoked functions. Same treatment, and
// the same reason, as ./sales.ts.
export const nodeMembership = table(
  "node_membership",
  {
    id: count("id").primaryKey().notNull().default(1),
    // The Slice-1 document's `term`, held as a bigint column and read back as a JS `number`
    // (`bigCount`); the ≤3-node topology increments `term` by one per edit, so it never
    // approaches 2^53.
    term: bigCount("term").notNull(),
    document: json<SignedMembershipDocument>("document").notNull(),
    updatedAt: ts("updated_at").notNull().$defaultFn(now),
  },
  /* v8 ignore start */
  (t) => [check("node_membership_singleton_ck", sql`${t.id} = 1`)],
  /* v8 ignore stop */
);
