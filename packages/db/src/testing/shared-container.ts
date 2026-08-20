import { sql } from "drizzle-orm";
import { createPostgresDb } from "../client.js";
import { assertSafeIdentifier, probeRoleStatement, type ProbeRole } from "./identifiers.js";
import { databaseUrl, startPostgresContainer, type StartedContainer } from "./postgres.js";

/**
 * One shared PostgreSQL container per PACKAGE test run, in place of one container per test FILE.
 *
 * The saving comes from where the fixed cost lands. Measured 2026-08-19 on `postgres:18-alpine`,
 * booting a container is ~1118ms and a full migration ~387ms, so ~130 real-PG files paid ~1.5s of
 * setup each; cloning a migrated database with `CREATE DATABASE … TEMPLATE` is ~26ms. This helper
 * pays the boot-and-migrate ONCE and hands every suite a clone (see {@link useTemplateDb}).
 *
 * It is meant to be called from a package's vitest `globalSetup`, which is REQUIRED for the sharing
 * to work at all: vitest's default `isolate: true` gives each test file a fresh module context, so
 * a module-level container singleton is re-created per file and shares nothing. globalSetup runs
 * once in the main process; it `provide("sharedPg", handle)`s the returned handle across the worker
 * boundary, and each worker reads it with `inject("sharedPg")` (typed by the `ProvidedContext`
 * augmentation below). A globalSetup's return value is its globalTeardown, so a package wires it as:
 *
 *     export default async function ({ provide }: GlobalSetupContext) {
 *       const { handle, teardown } = await startSharedContainer({ templates: { … }, roles: [ … ] });
 *       provide("sharedPg", handle);
 *       return teardown;
 *     }
 *
 * The handle carries only plain, structured-cloneable data (`uri` and a name→name record), because
 * `provide` serialises it across the worker boundary — a live `Database` could not cross it.
 */

/**
 * Names each template DB to migrate and how to migrate it.
 *
 * A key names the template (`useTemplateDb({ template: "<key>" })` clones it); its function migrates
 * ONE database — the URI it is handed already points at that template's own database, so the
 * function is just `(uri) => runMigrationSets(uri, [ … ])` or apps/server's advisory-locked
 * `applyMigrations(uri)`, whichever the package's migration path is. The function MUST close every
 * connection it opens before it resolves: a template with an open connection cannot be used as a
 * `CREATE DATABASE … TEMPLATE` source. `runMigrationSets` and `applyMigrations` already do.
 */
export interface SharedContainerOptions {
  /** name → migrate-that-template. Each is migrated into its own fresh database, in insertion order. */
  templates: Record<string, (uri: string) => Promise<void>>;
  /**
   * Extra CLUSTER-global roles to create ONCE, idempotently, AFTER the templates migrate.
   *
   * `ProbeRole` rather than a raw `CREATE ROLE` string, deliberately: it reuses
   * {@link probeRoleStatement}'s validation (so a role's name/password/inRole cannot smuggle SQL
   * into the utility statement they build), and it is the SAME shape as `useRealPostgres`'s
   * `probeRole` option, so a suite converting off per-file containers lifts its existing role
   * object here unchanged. Created after the templates because the common case — a probe with
   * `inRole: "app_user"` — needs a role that a template's CORE migration created; run first, that
   * membership would fail with "role app_user does not exist".
   */
  roles?: readonly ProbeRole[];
  /**
   * Why a globalSetup that cannot reach Docker fails loudly, thrown verbatim in place of the raw
   * testcontainers error when `start()` rejects. Optional — the foundation's own tests do not need
   * a friendly message — but a package globalSetup should pass one: without it a Docker-absent run
   * dies at globalSetup with a bare daemon error and no guidance, and because globalSetup precedes
   * every worker, the WHOLE package suite dies, hermetic files included. Mirrors
   * {@link startMigratedPostgres}'s required `dockerRequired`, for the same reason.
   */
  dockerRequired?: string;
  /**
   * Seam — see `postgres.ts`'s `StartedContainer`. Defaults to a real Testcontainers PostgreSQL;
   * a test overrides it to prove the container-lifecycle paths (stop-on-failure, teardown) without
   * a daemon.
   */
  start?: () => Promise<StartedContainer>;
}

/**
 * What a package's globalSetup `provide`s and every suite `inject`s.
 *
 * `templates` maps the caller's template KEY to the actual template DATABASE name to clone from —
 * the caller passes `{ template: "core" }` to {@link useTemplateDb} and never sees `template_core`.
 */
export interface SharedContainerHandle {
  /** The container's admin (superuser) connection URI, pointed at its default database. */
  uri: string;
  /** template key → the migrated database name to clone from. */
  templates: Record<string, string>;
}

declare module "vitest" {
  interface ProvidedContext {
    sharedPg: SharedContainerHandle;
  }
}

/**
 * Wraps {@link probeRoleStatement}'s `CREATE ROLE` in a `DO` block that swallows `duplicate_object`,
 * so creating the same cluster role twice is a no-op rather than a `role … already exists` error.
 *
 * Proven idempotent against a real container in `shared-container.test.ts`'s real block — the
 * statement is run a second time and does not throw — which is the property that lets one cluster
 * back many suites: `describeEachTarget` and the probe role both need cluster roles created more
 * than once (harness.ts:26-42). Safe to interpolate because `probeRoleStatement` has already
 * rejected anything in the role's fields that would need escaping.
 */
export function idempotentRoleStatement(role: ProbeRole): string {
  return `do $$ begin ${probeRoleStatement(role)}; exception when duplicate_object then null; end $$`;
}

/**
 * Boots ONE container, migrates each template into its own fresh database, creates `roles`
 * idempotently, and returns the handle to `provide` plus the teardown that stops the container.
 *
 * Never leaks a container on a mid-setup throw: everything after the container starts is wrapped so
 * a failing migration, role, or identifier check stops the container before rethrowing — the same
 * stop-on-failure `startMigratedPostgres` uses, and it matters for the same reason (with
 * `TESTCONTAINERS_RYUK_DISABLED=true`, mandatory for this repo's local runs, nothing else reaps a
 * leaked container). A failure of `start()` itself leaves no container to stop; it rethrows
 * `dockerRequired` when the caller gave one, else the raw error.
 */
export async function startSharedContainer(options: SharedContainerOptions): Promise<{
  handle: SharedContainerHandle;
  teardown: () => Promise<void>;
}> {
  const start = options.start ?? startPostgresContainer;
  let container: StartedContainer;
  try {
    container = await start();
  } catch (cause) {
    // A start() failure leaves no container to stop; rethrow the caller's guidance if it gave any,
    // rather than the raw testcontainers "cannot connect to the Docker daemon" that a globalSetup
    // would otherwise surface with no hint.
    if (options.dockerRequired !== undefined) throw new Error(options.dockerRequired, { cause });
    throw cause;
  }
  try {
    const templates: Record<string, string> = {};
    for (const [name, migrate] of Object.entries(options.templates)) {
      // Validate the KEY, not just the derived name: a key that clears SAFE_TOKEN makes
      // `template_<key>` safe too, and the message then names exactly what the caller passed.
      assertSafeIdentifier("template name", name);
      const dbName = `template_${name}`;
      const admin = await createPostgresDb(container.uri);
      try {
        await admin.execute(sql.raw(`create database ${dbName}`));
      } finally {
        await admin.close();
      }
      // The migrator connects to the template's OWN database and closes before this resolves, so
      // nothing holds a connection to it and it can serve as a CREATE DATABASE … TEMPLATE source.
      await migrate(databaseUrl(container.uri, dbName));
      templates[name] = dbName;
    }

    if (options.roles !== undefined && options.roles.length > 0) {
      const admin = await createPostgresDb(container.uri);
      try {
        for (const role of options.roles) {
          await admin.execute(sql.raw(idempotentRoleStatement(role)));
        }
      } finally {
        await admin.close();
      }
    }

    return {
      handle: { uri: container.uri, templates },
      teardown: () => container.stop(),
    };
  } catch (error) {
    // Best-effort: a rejecting stop() (wedged daemon, container already gone) must not replace the
    // setup error the caller needs to see.
    await container.stop().catch(() => {});
    throw error;
  }
}
