import { describe, expect, it } from "vitest";
import {
  REPLICATION_ROLE,
  replicationBootstrapStatements,
  replicationRepairStatements,
  replicationSchemaGrantStatements,
} from "./replication-bootstrap.js";

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

describe("replicationSchemaGrantStatements", () => {
  it("is exactly the per-database half of the bootstrap, in the same order", () => {
    // `toEqual`, not `toContain`: this is the whole re-grant a caller runs against a database that
    // was discarded and recreated while `waitron_repl` survived in the shared catalogue, so a
    // statement drifting OUT of this list is the defect — and a cluster-global one drifting IN would
    // be re-run needlessly by that caller.
    expect(replicationSchemaGrantStatements()).toEqual([
      `grant select on all tables in schema public to "waitron_repl"`,
      `alter default privileges for role "waitron_migrator" in schema public grant select on tables to "waitron_repl"`,
    ]);
  });

  it("carries no credential, so a caller may log it", () => {
    // The reason this half needs no withholding catch, unlike the full array.
    expect(replicationSchemaGrantStatements().join(" ")).not.toContain("password");
  });

  it("is composed INTO the full bootstrap rather than copied beside it", () => {
    // One home for the statements: a fix to either list must reach the other by construction.
    const full = replicationBootstrapStatements("pw");
    const schemaLocal = replicationSchemaGrantStatements();
    expect(full.slice(full.indexOf(schemaLocal[0]!), full.indexOf(schemaLocal[0]!) + 2)).toEqual(
      schemaLocal,
    );
  });
});

describe("replicationRepairStatements", () => {
  it("is every bootstrap statement except CREATE ROLE, in order", () => {
    // `toEqual`, not `toContain`: the repair a surviving role re-runs must be the WHOLE non-CREATE
    // half — a statement drifting OUT leaves a prerequisite unrepaired, and `CREATE ROLE` drifting
    // IN would fail 42710 on the surviving role.
    expect(replicationRepairStatements()).toEqual([
      `grant pg_create_subscription to "waitron_migrator"`,
      `grant select on all tables in schema public to "waitron_repl"`,
      `alter default privileges for role "waitron_migrator" in schema public grant select on tables to "waitron_repl"`,
      `alter system set max_slot_wal_keep_size = '4GB'`,
      `select pg_reload_conf()`,
    ]);
  });

  it("carries no credential, so a caller may log it", () => {
    // The password lives only in CREATE ROLE, so the repair half needs no withholding catch.
    expect(replicationRepairStatements().join(" ")).not.toContain("password");
  });

  it("is the full bootstrap minus its CREATE ROLE head, by construction", () => {
    // One home: the full array IS `[create role, ...repair]`, so a fix to either reaches the other.
    const full = replicationBootstrapStatements("pw");
    expect(full[0]).toContain("create role");
    expect(full.slice(1)).toEqual(replicationRepairStatements());
  });
});
