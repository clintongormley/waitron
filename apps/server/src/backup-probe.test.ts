import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertBackupCanReadFiscal } from "./backup-probe.js";
import { locateSharedContainer } from "./testing/locate-shared-container.js";
import "./errors.js";

// Real Postgres enforces the read grants and runs pg_dump; PGlite cannot test this privilege boundary.
const suite = useTemplateDb({ template: "manifest" });
let appDb: Database;
let reader: Database;
const execFileAsync = promisify(execFile);

beforeAll(async () => {
  appDb = await suite.pg.connectAs("app_login", "app_pw");
  await suite.admin.execute(sql`create role backup_probe_reader login password 'reader'`);
  await suite.admin.execute(
    sql`grant select on all tables in schema public to backup_probe_reader`,
  );
  await suite.admin.execute(
    sql`grant select on all sequences in schema public to backup_probe_reader`,
  );
  await suite.admin.execute(
    sql`create schema backup_probe_owned authorization backup_probe_reader`,
  );
  await suite.admin.execute(sql`create view public.backup_probe_view as select 42 as id`);
  reader = await suite.pg.connectAs("backup_probe_reader", "reader");
  await reader.execute(sql`create table backup_probe_owned.receipt (id integer)`);
  await reader.execute(sql`create sequence backup_probe_owned.counter`);
  await reader.execute(sql`insert into backup_probe_owned.receipt values (42)`);
}, 180_000);

afterAll(async () => {
  if (appDb !== undefined) await appDb.close();
  if (reader !== undefined) await reader.close();
});

describe("assertBackupCanReadFiscal checks backup read privileges", () => {
  it("accepts the superuser owner", async () => {
    await expect(assertBackupCanReadFiscal(suite.admin)).resolves.toBeUndefined();
  });

  it("accepts a non-superuser with table and sequence reads, including objects it owns", async () => {
    const facts = await reader.execute<{ rolsuper: boolean }>(sql`
      select rolsuper from pg_roles where rolname = current_user`);
    expect(facts.rows).toEqual([{ rolsuper: false }]);
    const missing = await suite.admin.execute<{ name: string }>(sql`
      select c.relname::text as name from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'S', 'm')
      and not exists (
        select 1 from aclexplode(c.relacl) a
        where a.grantee = (select oid from pg_roles where rolname = 'backup_probe_reader')
        and a.privilege_type = 'SELECT')`);
    expect(missing.rows).toEqual([]);
    await expect(assertBackupCanReadFiscal(reader)).resolves.toBeUndefined();
  });

  it("refuses the app login, which cannot read the migration journals", async () => {
    await expect(assertBackupCanReadFiscal(appDb)).rejects.toMatchObject({
      code: "backup.role_rls_fenced",
    });
  });

  it("refuses a reader missing a table grant", async () => {
    await suite.admin.execute(
      sql`revoke select on public.__drizzle_migrations_db from backup_probe_reader`,
    );
    try {
      await expect(assertBackupCanReadFiscal(reader)).rejects.toMatchObject({
        code: "backup.role_rls_fenced",
      });
    } finally {
      await suite.admin.execute(
        sql`grant select on public.__drizzle_migrations_db to backup_probe_reader`,
      );
    }
  });

  it("refuses a reader missing a sequence grant", async () => {
    await suite.admin.execute(sql`create sequence public.backup_probe_sequence`);
    try {
      await expect(assertBackupCanReadFiscal(reader)).rejects.toMatchObject({
        code: "backup.role_rls_fenced",
      });
    } finally {
      await suite.admin.execute(sql`drop sequence public.backup_probe_sequence`);
    }
  });

  it("refuses a reader missing schema access even with a table grant", async () => {
    await suite.admin.execute(sql`create schema backup_probe_private`);
    await suite.admin.execute(sql`create table backup_probe_private.receipt (id integer)`);
    await suite.admin.execute(
      sql`grant select on backup_probe_private.receipt to backup_probe_reader`,
    );
    try {
      await expect(assertBackupCanReadFiscal(reader)).rejects.toMatchObject({
        code: "backup.role_rls_fenced",
      });
    } finally {
      await suite.admin.execute(sql`drop schema backup_probe_private cascade`);
    }
  });

  it("dumps the migrated database through the accepted non-superuser connection", async () => {
    await assertBackupCanReadFiscal(reader);
    const uri = new URL(suite.pg.uri);
    const containerId = await locateSharedContainer(uri, {
      tag: "backup reader",
      unproven: "Non-superuser pg_dump is unproven.",
    });
    expect(containerId).toBeDefined();
    const connection = `postgresql://backup_probe_reader:reader@localhost:5432${uri.pathname}`;
    const { stdout } = await execFileAsync(
      "docker",
      ["exec", containerId!, "pg_dump", "--format=custom", connection],
      { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 },
    );
    expect(stdout.subarray(0, 5).toString()).toBe("PGDMP");
  });
});
