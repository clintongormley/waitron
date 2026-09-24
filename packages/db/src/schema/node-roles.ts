import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { id, label, now, table, ts } from "./columns.js";

/**
 * This node's role in the venue, one row per node, keyed by the node's own id
 * (`WAITRON_TILL_NODE_ID`). Every read and write names that id, so a node holding another node's
 * copy of `venue.db` reads its own row or none; no row reads as a sole primary
 * (`../deployment.ts`). The environment is not here: it belongs to the database and stays on
 * `deployment`.
 */
// The bracketed thunks below are resolved by `drizzle-kit generate` in its own CLI process,
// never by `vitest run`, so v8 reports them as never-invoked functions. Same treatment, and
// the same reason, as ./sales.ts.
export const nodeRoles = table(
  "node_roles",
  {
    // No foreign key to `nodes`: a `local` table holds none into a venue table
    // (`scripts/two-file-foreign-keys.test.ts`), and adopt writes a standby's role before any
    // `nodes` row carries its id — that row is left to boot's finish-adoption worker
    // (`apps/server/src/finish-adoption.ts`).
    nodeId: id("node_id").primaryKey(),
    // `primary` writes and originates; on a `mirror` boot mounts the read-only gate
    // (`apps/server/src/read-only-gate.ts`). Read at runtime so a promotion needs no restart.
    mode: label("mode").$type<"primary" | "mirror">().notNull().default("primary"),
    // Orthogonal to `mode`: `primary` holds the venue's singleton duties (AEAT submitter and
    // reconciler), `secondary` sells only.
    singletonRole: label("singleton_role")
      .$type<"primary" | "secondary">()
      .notNull()
      .default("primary"),
    // A scrypt verifier of the offline break-glass secret, set at adopt. Never the secret itself.
    breakGlassVerifier: label("break_glass_verifier"),
    updatedAt: ts("updated_at").notNull().$defaultFn(now),
  },
  /* v8 ignore start */
  (t) => [
    check("node_roles_mode_ck", sql`${t.mode} in ('primary', 'mirror')`),
    check("node_roles_singleton_role_ck", sql`${t.singletonRole} in ('primary', 'secondary')`),
    check(
      "node_roles_role_valid_ck",
      sql`not (${t.mode} = 'mirror' and ${t.singletonRole} = 'primary')`,
    ),
  ],
  /* v8 ignore stop */
);
