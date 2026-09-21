import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { count, label, now, table, ts } from "./columns.js";

/**
 * One row, id pinned to 1 by the `deployment_singleton_ck` check below.
 *
 * Brought INTO `./schema/index.ts` by the SQLite flip. It used to be kept out of that barrel because
 * `0001_db_baseline_sql.sql`, a hand-written custom migration, created it and drizzle-kit had
 * therefore never diffed it into a snapshot — so a plain (non-`--custom`) generate could emit a
 * second `CREATE TABLE` that failed against a database which had already run the baseline. Those
 * files named reconciling the snapshot chain as the precondition for bringing the table in, and the
 * flip did exactly that: every set is now one regenerated baseline. Until the barrel caught up, the
 * table had NO creator at all — `scripts/classification-complete.test.ts` is what reported it,
 * classified by core with no migration creating it.
 * Its accessors stay exported from the package's own public barrel (`../index.ts`) as before.
 */
// The bracketed thunks below are resolved by `drizzle-kit generate` in its own CLI process,
// never by `vitest run`, so v8 reports them as never-invoked functions. Same treatment, and
// the same reason, as ./sales.ts.
export const deployment = table(
  "deployment",
  {
    id: count("id").primaryKey(),
    environment: label("environment").notNull(),
    // Which role this database plays in the cloud-mirror topology (C2a design §3): a `primary`
    // writes and originates; on a `mirror` boot mounts the read-only gate
    // (`apps/server/src/read-only-gate.ts`), which refuses a CLIENT's write VERB — everything but
    // GET/HEAD/OPTIONS, apart from the promote trigger boot exempts by path. That is not "a mirror
    // never writes": the server's own writes still run, e.g. boot's `ensureMirrorViewer` and the
    // session keepalive inside a mirror's own GETs (`apps/server/src/mirror-session.ts`). Read at
    // runtime so a later promotion needs no restart. Default 'primary' so every existing deployment
    // is unchanged.
    mode: label("mode").notNull().default("primary"),
    // The singleton-ownership axis (promotion runbook design §2), orthogonal to `mode`: `primary` holds
    // the venue's singleton duties (AEAT submitter + reconciler), `secondary` is sell-only. Default
    // 'primary' so an existing single-node deployment stays a singleton-holder. Read at runtime so a
    // later promotion needs no restart.
    singletonRole: label("singleton_role").notNull().default("primary"),
    // A scrypt verifier of the offline break-glass secret, set at promotion time by the owner.
    // Nullable: a node minted before this column, and the primary (which is never promoted), both
    // hold `null`. Never the secret itself — only a verifier.
    breakGlassVerifier: label("break_glass_verifier"),
    // DEAD: grepping `fenceLsn`/`fence_lsn` across `packages`, `apps` and `scripts` on 2026-09-21
    // found this declaration and one test file, and no other code.
    fenceLsn: label("fence_lsn"),
    stampedAt: ts("stamped_at").notNull().$defaultFn(now),
  },
  /* v8 ignore start */
  (t) => [
    check("deployment_singleton_ck", sql`${t.id} = 1`),
    check("deployment_environment_ck", sql`${t.environment} in ('production', 'preproduction')`),
    check("deployment_mode_ck", sql`${t.mode} in ('primary', 'mirror')`),
    check("deployment_singleton_role_ck", sql`${t.singletonRole} in ('primary', 'secondary')`),
    check(
      "deployment_role_valid_ck",
      sql`not (${t.mode} = 'mirror' and ${t.singletonRole} = 'primary')`,
    ),
  ],
  /* v8 ignore stop */
);
