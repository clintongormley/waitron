// Real PostgreSQL: the first HONEST single-node replication-provisioning proof (swap S2). Provision
// ONE node the prototype's way — waitron_migrator OWNS every table — run the SUPERUSER bootstrap,
// verify readiness refuses then passes, create both publications as the OWNER, and prove §13.3 (a
// table migrated AFTER the bootstrap is covered by ALTER DEFAULT PRIVILEGES with no explicit grant).
//
// Order-dependent by construction, and safe under this package's `singleFork` (one file, one worker,
// declaration order = run order): assertion 2 must observe the PRE-bootstrap state, assertion 3 runs
// the bootstrap, and assertion 5 depends on it having run. The node is shared across the file via
// beforeAll for the same reason instance-apply.pg.test.ts shares its container — the bootstrap is a
// one-way state transition, not a per-case fixture.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { isAppError } from "@waitron/shared";
import {
  assertReplicationReady,
  REPLICATION_ROLE,
  replicationBootstrapStatements,
} from "@waitron/provisioning";
import { createPublications, publicationName } from "./publications.js";
import { startReplicationNode, type ReplicationNode } from "./testing/replication-node.js";

// A SMALL hardcoded real-table list — NOT @waitron/composition, which depends on @waitron/sync and
// would be a package cycle. Every one is created by the core baseline and classified in S1: `sales`
// and `tenders` are ledger, `tenants` and `locations` are state.
const LEDGER = ["sales", "tenders"];
const STATE = ["tenants", "locations"];
const PUBLISHED = [...LEDGER, ...STATE];

const REPL_PASSWORD = "repl_secret_pw";

describe("single-node replication provisioning against a real container", () => {
  let node: ReplicationNode;

  beforeAll(async () => {
    node = await startReplicationNode();
  }, 180_000);

  afterAll(async () => {
    if (node !== undefined) await node.stop();
  });

  it("the migrator owns every published table (the shape native replication requires)", async () => {
    const rows = await node.owner.execute<{ tablename: string; tableowner: string }>(
      sql`select tablename, tableowner from pg_tables where tablename = any(${sql.raw(
        `array['${PUBLISHED.join("','")}']`,
      )})`,
    );
    // Every one present and owned by waitron_migrator. A non-migrator owner is the live-provisioning
    // gap Task 8 closes; here it would fail loudly at the publication create below.
    expect(rows.rows.map((r) => r.tablename).sort()).toEqual([...PUBLISHED].sort());
    for (const row of rows.rows) expect(row.tableowner).toBe("waitron_migrator");
  });

  it("readiness REFUSES before the bootstrap — replication role and pg_create_subscription only", async () => {
    let thrown: unknown;
    try {
      await assertReplicationReady(node.owner);
    } catch (error) {
      thrown = error;
    }
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.code).toBe("provisioning.replication_not_ready");
    const missing = (thrown.params as { missing: string[] }).missing;
    // The two gaps the bootstrap fills.
    expect(missing).toContain("replication role missing");
    expect(missing).toContain("migrator lacks pg_create_subscription");
    // NOT the WAL settings: the node BOOTED with wal_level=logical, track_commit_timestamp=on and a
    // bounded max_slot_wal_keep_size, so no `pg_reload_conf` timing is raced here.
    expect(missing).not.toContain("wal_level is not logical");
    expect(missing).not.toContain("track_commit_timestamp is off");
    expect(missing).not.toContain("max_slot_wal_keep_size is unbounded");
  });

  it("readiness PASSES after the SUPERUSER bootstrap", async () => {
    // Each bootstrap statement over the container SUPERUSER — the real box image / operator step
    // (`instance` never performs it, only verifies it).
    for (const statement of replicationBootstrapStatements(REPL_PASSWORD)) {
      await node.superuser.execute(sql.raw(statement));
    }
    // Now readiness must resolve: replication role present, migrator holds pg_create_subscription.
    await expect(assertReplicationReady(node.owner)).resolves.toBeUndefined();
  });

  it("the owner creates both publications, each naming its own tables", async () => {
    await createPublications(node.owner, {
      environment: "preproduction",
      ledgerTables: LEDGER,
      stateTables: STATE,
    });

    const ledgerName = publicationName("preproduction", "ledger");
    const stateName = publicationName("preproduction", "state");

    const pubs = await node.owner.execute<{ pubname: string }>(
      sql`select pubname from pg_publication where pubname = any(${sql.raw(
        `array['${ledgerName}','${stateName}']`,
      )}) order by pubname`,
    );
    expect(pubs.rows.map((r) => r.pubname)).toEqual([ledgerName, stateName].sort());

    // Each publication names EXACTLY its own tables (pg_publication_tables, the resolved membership).
    const membership = await node.owner.execute<{ pubname: string; tablename: string }>(
      sql`select pubname, tablename from pg_publication_tables
          where pubname = any(${sql.raw(`array['${ledgerName}','${stateName}']`)})`,
    );
    const tablesOf = (name: string) =>
      membership.rows
        .filter((r) => r.pubname === name)
        .map((r) => r.tablename)
        .sort();
    expect(tablesOf(ledgerName)).toEqual([...LEDGER].sort());
    expect(tablesOf(stateName)).toEqual([...STATE].sort());
  });

  it("§13.3 — ALTER DEFAULT PRIVILEGES covers a table migrated AFTER the bootstrap", async () => {
    // As waitron_migrator (the owner), create a table AFTER the bootstrap's `alter default privileges
    // for role waitron_migrator … grant select … to waitron_repl` ran. That default privilege must
    // reach the new table with NO explicit grant — spec §13 verification #3, RUN.
    await node.owner.execute(sql.raw(`create table repl_later_probe (id int primary key)`));
    try {
      const rows = await node.owner.execute<{ can_select: boolean }>(
        sql`select has_table_privilege(${REPLICATION_ROLE}, 'repl_later_probe', 'SELECT') as can_select`,
      );
      expect(rows.rows[0]?.can_select).toBe(true);
    } finally {
      await node.owner.execute(sql.raw(`drop table repl_later_probe`));
    }
  });
});
