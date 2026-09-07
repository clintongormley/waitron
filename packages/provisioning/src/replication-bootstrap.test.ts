import { describe, expect, it } from "vitest";
import { REPLICATION_ROLE, replicationBootstrapStatements } from "./replication-bootstrap.js";

describe("replicationBootstrapStatements", () => {
  const stmts = replicationBootstrapStatements("s3cr'et");
  it("creates the replication login with REPLICATION and an escaped password literal", () => {
    expect(stmts[0]).toBe(`create role "waitron_repl" login replication password 's3cr''et'`);
  });
  it("grants pg_create_subscription to the migrator", () => {
    expect(stmts).toContain(`grant pg_create_subscription to "waitron_migrator"`);
  });
  it("grants SELECT now and by default for the migrator's future tables (§13.3)", () => {
    expect(stmts).toContain(`grant select on all tables in schema public to "waitron_repl"`);
    expect(stmts).toContain(
      `alter default privileges for role "waitron_migrator" in schema public grant select on tables to "waitron_repl"`,
    );
  });
  it("bounds the WAL retained for a dead standby and reloads (spec §6)", () => {
    expect(stmts).toContain(`alter system set max_slot_wal_keep_size = '4GB'`);
    expect(stmts).toContain(`select pg_reload_conf()`);
  });
  it("exports the replication role name for the readiness check to verify", () => {
    expect(REPLICATION_ROLE).toBe("waitron_repl");
  });
});
