import { CORE_ENROLMENT } from "@waitron/db";
import {
  FISCAL_ENROLMENT,
  FISCAL_PROVISIONING,
  FISCAL_RESTORE,
  FISCAL_SLOT,
  FISCAL_VOCABULARY,
} from "@waitron/fiscal-verifactu";
import { IDENTITY_ENROLMENT } from "@waitron/identity";
import type { WaitronModule } from "@waitron/module";
import { PAYMENTS_ENROLMENT } from "@waitron/payments";
import { WORKFORCE_ES_VOCABULARY } from "@waitron/workforce-es";

/**
 * Every Waitron module, in composition order. The one place that names every module package: the
 * server, the provisioning CLI and the root guards all read this list. What
 * `scripts/module-seams.test.ts` enforces is narrower than "nothing else imports a module package":
 * the boundary is the swappable fiscal REGIME (`@waitron/fiscal-verifactu`, `@waitron/verifactu`),
 * which nothing under `packages/provisioning/src` may import (its `bin.ts` is the CLI's composition
 * root and imports this list instead) and which no file under `apps/server/src` may import outside
 * the allowlisted deferred runtime pass. `@waitron/identity` and `@waitron/layouts` are ordinary
 * dependencies of the packages that use them, not slots, and the guard says nothing about them.
 *
 * Each `migrations` object carries the exact `{ name, table, from }` from
 * `packages/migrations/migrations.manifest.json`; `composition.test.ts` pins the two byte-for-byte
 * while both exist. `requires` names every cross-set edge the SQL creates — FK `REFERENCES`,
 * `CREATE TRIGGER … ON <table>` and the `sync_capture()` SPI call — which the root
 * `module-graph-honesty` guard cross-checks against the migrations. Populated seats today: `sync` on
 * every enrolling module (SP-2a/3a), `vocabulary` on the Spanish-by-design modules (SP-3b),
 * `backup.nonDbState` on `core`, and `provisioning`, `fiscal` + `backup.restore` on `fiscal`. The
 * remaining seats stay declared on the contract and empty until their slices land.
 */
export const ALL_MODULES: readonly WaitronModule[] = [
  {
    name: "core",
    version: "0.0.0",
    tier: "mandatory",
    migrations: { name: "core", table: "__drizzle_migrations_db", from: "../db/drizzle" },
    sync: CORE_ENROLMENT,
    // The content-addressed media store is core's non-DB state; a backup must capture it
    // alongside the DB.
    backup: { nonDbState: [{ kind: "content-addressed-dir", source: "media" }] },
  },
  {
    name: "identity",
    version: "0.0.0",
    tier: "toggleable",
    requires: { core: "*" },
    migrations: {
      name: "identity",
      table: "__drizzle_migrations_identity",
      from: "../identity/drizzle",
    },
    sync: IDENTITY_ENROLMENT,
  },
  {
    name: "workforce",
    version: "0.0.0",
    tier: "toggleable",
    requires: { core: "*", modules: { identity: "*" } },
    migrations: {
      name: "workforce",
      table: "__drizzle_migrations_workforce",
      from: "../workforce/drizzle",
    },
  },
  {
    name: "workforce-es",
    version: "0.0.0",
    tier: "toggleable",
    requires: { core: "*" },
    migrations: {
      name: "workforce-es",
      table: "__drizzle_migrations_workforce_es",
      from: "../workforce-es/drizzle",
    },
    vocabulary: WORKFORCE_ES_VOCABULARY,
  },
  {
    name: "payments",
    version: "0.0.0",
    tier: "toggleable",
    requires: { core: "*" },
    migrations: {
      name: "payments",
      table: "__drizzle_migrations_payments",
      from: "../payments/drizzle",
    },
    sync: PAYMENTS_ENROLMENT,
  },
  {
    name: "scheduler",
    version: "0.0.0",
    tier: "toggleable",
    requires: { core: "*" },
    migrations: {
      name: "scheduler",
      table: "__drizzle_migrations_scheduler",
      from: "../scheduler/drizzle",
    },
  },
  {
    name: "credentials",
    version: "0.0.0",
    tier: "toggleable",
    requires: { core: "*" },
    migrations: {
      name: "credentials",
      table: "__drizzle_migrations_credentials",
      from: "../credentials/drizzle",
    },
  },
  {
    name: "sync",
    version: "0.0.0",
    tier: "toggleable",
    requires: { core: "*", modules: { identity: "*", payments: "*" } },
    migrations: { name: "sync", table: "__drizzle_migrations_sync", from: "../sync/drizzle" },
  },
  {
    name: "fiscal",
    version: "0.0.0",
    tier: "provision-only",
    requires: { core: "*", modules: { sync: "*" } },
    migrations: {
      name: "fiscal",
      table: "__drizzle_migrations_fiscal",
      from: "../fiscal-verifactu/drizzle",
    },
    sync: FISCAL_ENROLMENT,
    vocabulary: FISCAL_VOCABULARY,
    provisioning: FISCAL_PROVISIONING,
    fiscal: FISCAL_SLOT,
    backup: { restore: FISCAL_RESTORE },
  },
];
