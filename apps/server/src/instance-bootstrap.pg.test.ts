import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb, readDeploymentEnvironment, stampDeployment } from "@waitron/db";
import { startPostgresContainer } from "@waitron/db/testing/postgres.js";
import { parseEnvFile } from "./env-file.js";
import { ensureInstance } from "./instance-bootstrap.js";

const noopLog = () => {};

describe("ensureInstance", () => {
  let container: Awaited<ReturnType<typeof startPostgresContainer>>;
  let bootstrapUrl: string;
  let stateDir: string;

  beforeAll(async () => {
    container = await startPostgresContainer();
    bootstrapUrl = container.uri;
    stateDir = await mkdtemp(join(tmpdir(), "wt-inst-"));
  }, 180_000);

  afterAll(async () => {
    await container?.stop();
  });

  it("creates the database migrator-owned, both logins, and the replication role", async () => {
    const urls = await ensureInstance({
      bootstrapUrl,
      database: "waitron",
      stateDir,
      log: noopLog,
    });
    const admin = await createPostgresDb(bootstrapUrl);
    try {
      const owner = await admin.execute<{ owner: string }>(
        sql`select pg_get_userbyid(datdba) as owner from pg_database where datname = 'waitron'`,
      );
      expect(owner.rows[0]?.owner).toBe("waitron_migrator");
      const repl = await admin.execute<{ n: number }>(
        sql`select count(*)::int as n from pg_roles where rolname = 'waitron_repl' and rolreplication`,
      );
      expect(repl.rows[0]?.n).toBe(1);
    } finally {
      await admin.close();
    }
    // Roles are CLUSTER-global, so the pg_roles count above passes even if the bootstrap ran
    // against the WRONG database — both answers look alike (CLAUDE.md §1). The schema-local half is
    // what distinguishes them, so assert it IN THE TARGET database: a default-privileges entry for
    // the migrator granting SELECT to waitron_repl.
    const target = await createPostgresDb(urls.migrationsDatabaseUrl);
    try {
      const acl = await target.execute<{ n: number }>(
        sql`select count(*)::int as n
              from pg_default_acl d
              join pg_roles owner on owner.oid = d.defaclrole
             where owner.rolname = 'waitron_migrator'
               and array_to_string(d.defaclacl, ',') like '%waitron_repl%'`,
      );
      expect(acl.rows[0]?.n).toBe(1);
    } finally {
      await target.close();
    }
    expect(urls.databaseUrl).toContain("/waitron");
    // The app login must actually be able to connect with the password we persisted.
    const app = await createPostgresDb(urls.databaseUrl);
    await app.close();
  });

  it("does NOT stamp — the wizard's choice of production must remain open", async () => {
    const target = await createPostgresDb(
      (await ensureInstance({ bootstrapUrl, database: "waitron", stateDir, log: noopLog }))
        .migrationsDatabaseUrl,
    );
    try {
      // The `deployment` TABLE exists — the core migration creates it
      // (packages/db/drizzle/0001_db_baseline_sql.sql), and on a virgin cluster this entrypoint
      // ran that migration to mint `app_user`. What must NOT exist is a ROW: stamping is the
      // wizard's, and an unstamped database is what keeps `production` reachable.
      const present = await target.execute<{ exists: boolean }>(
        sql`select to_regclass('public.deployment') is not null as exists`,
      );
      expect(present.rows[0]?.exists).toBe(true);
      const stamped = await target.execute<{ n: number }>(
        sql`select count(*)::int as n from deployment`,
      );
      expect(stamped.rows[0]?.n).toBe(0);
    } finally {
      await target.close();
    }
  });

  it("is idempotent: a second run plans nothing and leaves instance.env byte-identical", async () => {
    const before = await readFile(join(stateDir, "instance.env"), "utf8");
    await ensureInstance({ bootstrapUrl, database: "waitron", stateDir, log: noopLog });
    expect(await readFile(join(stateDir, "instance.env"), "utf8")).toBe(before);
  });

  it("applies no migrate once app_user exists — a bogus migrations root is never reached", async () => {
    // The observable proof of the migrate gate in its second direction. `applyInstance`'s migrate
    // case resolves `migrationsRoot` before it touches the database and throws `migrations.set_missing`
    // for a folder with no journal, so a run that SUCCEEDS with a root that cannot resolve applied no
    // `migrate` — which is what keeps a disabled module's migrations behind `boot.ts`'s filter.
    await expect(
      ensureInstance({
        bootstrapUrl,
        database: "waitron",
        stateDir,
        log: noopLog,
        migrationsRoot: "/waitron-no-such-migrations-root",
      }),
    ).resolves.toBeDefined();
  });

  it("refuses rather than inventing a password it cannot recover", async () => {
    // The roles are cluster-global and already exist, so no `create-role` action carries a password
    // and an empty state dir has none saved. Guessing here would hand the server a URL that cannot
    // authenticate.
    const emptyState = await mkdtemp(join(tmpdir(), "wt-inst-empty-"));
    await expect(
      ensureInstance({ bootstrapUrl, database: "waitron", stateDir: emptyState, log: noopLog }),
    ).rejects.toMatchObject({ code: "server.config_invalid" });

    // The same refusal for the replication credential, which is a bare password rather than a URL:
    // both logins are recoverable from a saved file that predates `WAITRON_REPLICATION_PASSWORD`.
    const partialState = await mkdtemp(join(tmpdir(), "wt-inst-partial-"));
    const saved = await readFile(join(stateDir, "instance.env"), "utf8");
    await writeFile(
      join(partialState, "instance.env"),
      saved
        .split("\n")
        .filter((line) => !line.startsWith("WAITRON_REPLICATION_PASSWORD="))
        .join("\n"),
      { mode: 0o600 },
    );
    await expect(
      ensureInstance({ bootstrapUrl, database: "waitron", stateDir: partialState, log: noopLog }),
    ).rejects.toMatchObject({ code: "server.config_invalid" });
  });

  it("reads the environment from the database's own stamp, so a production box still boots", async () => {
    const urls = await ensureInstance({
      bootstrapUrl,
      database: "waitron",
      stateDir,
      log: noopLog,
    });
    const target = await createPostgresDb(urls.migrationsDatabaseUrl);
    try {
      await stampDeployment(target, "production");
    } finally {
      await target.close();
    }
    // `planInstance` refuses BEFORE emitting any action when the requested environment disagrees
    // with the stamp, so a hardcoded `preproduction` here would brick every boot of a production
    // box, not just the first — and the stamp it already carries must survive untouched.
    await expect(
      ensureInstance({ bootstrapUrl, database: "waitron", stateDir, log: noopLog }),
    ).resolves.toBeDefined();
    const after = await createPostgresDb(urls.migrationsDatabaseUrl);
    try {
      expect(await readDeploymentEnvironment(after)).toBe("production");
    } finally {
      await after.close();
    }
  });

  it("recreates a dropped database using the saved passwords (the rejoin shape)", async () => {
    const admin = await createPostgresDb(bootstrapUrl);
    try {
      await admin.execute(sql.raw(`drop database if exists waitron with (force)`));
    } finally {
      await admin.close();
    }
    const urls = await ensureInstance({
      bootstrapUrl,
      database: "waitron",
      stateDir,
      log: noopLog,
    });
    const app = await createPostgresDb(urls.databaseUrl);
    await app.close();
  });

  it("withholds the statement and the password when the replication bootstrap fails", async () => {
    // The bootstrap's first statement embeds the generated password, and both Drizzle's wrapped
    // failure and PostgreSQL's own message quote the failing statement back verbatim — so a caller
    // that logs the caught value would put a credential in a log file. Reproduced rather than
    // reasoned about: a CREATEDB/CREATEROLE admin that is NOT a superuser may not create a
    // REPLICATION role.
    const password = parseEnvFile(
      await readFile(join(stateDir, "instance.env"), "utf8"),
    ).WAITRON_REPLICATION_PASSWORD;
    expect(password).toBeTruthy();

    const admin = await createPostgresDb(bootstrapUrl);
    try {
      await admin.execute(sql.raw(`drop role if exists waitron_repl`));
      await admin.execute(
        sql.raw(`create role probe_admin login createdb createrole password 'probe_pw'`),
      );
      await admin.execute(sql.raw(`grant waitron_migrator to probe_admin with set true`));
    } finally {
      await admin.close();
    }
    const probeUrl = new URL(bootstrapUrl);
    probeUrl.username = "probe_admin";
    probeUrl.password = "probe_pw";

    const error = await ensureInstance({
      bootstrapUrl: probeUrl.toString(),
      database: "waitron",
      stateDir,
      log: noopLog,
    }).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({
      code: "server.replication_bootstrap_failed",
      params: { sqlState: "42501" },
    });
    const rendered = `${String(error)} ${JSON.stringify(error)} ${(error as Error).stack ?? ""}`;
    expect(rendered).not.toContain(password);
  });
});
