import { CREDENTIALS_CLASSIFICATION } from "@waitron/credentials";
import { CORE_CLASSIFICATION } from "@waitron/db";
import { FISCAL_NONE_SLOT } from "@waitron/fiscal-none";
import {
  FISCAL_CLASSIFICATION,
  FISCAL_PROVISIONING,
  FISCAL_RESTORE,
  FISCAL_SLOT,
  FISCAL_VOCABULARY,
} from "@waitron/fiscal-verifactu";
import {
  BOOKINGS_CLASSIFICATION,
  BOOKINGS_FLOOR_ANNOTATIONS,
  BOOKINGS_PERMISSIONS,
  BOOKINGS_ROUTES,
} from "@waitron/bookings";
import { IDENTITY_CLASSIFICATION } from "@waitron/identity";
import type { WaitronModule } from "@waitron/module";
import { PAYMENTS_CLASSIFICATION } from "@waitron/payments";
import { SCHEDULER_CLASSIFICATION } from "@waitron/scheduler";
import { WORKFORCE_CLASSIFICATION } from "@waitron/workforce";
import { WORKFORCE_ES_CLASSIFICATION, WORKFORCE_ES_VOCABULARY } from "@waitron/workforce-es";

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
 * while both exist. `requires` names every cross-set edge the SQL creates — FK `REFERENCES` and
 * `CREATE TRIGGER … ON <table>` — which the root `module-graph-honesty` guard cross-checks against the
 * migrations. Populated seats today: `vocabulary` on the Spanish-by-design modules (SP-3b),
 * `classification` on every table-owning module (swap S1 — `fiscal-none` owns no tables and has none),
 * `backup.nonDbState` on `core`, and `provisioning`, `fiscal` + `backup.restore` on `fiscal-verifactu`.
 * Two modules fill the `fiscal` slot — `fiscal-verifactu` and the no-regime `fiscal-none` — so exactly
 * one is enabled per deployment (`fiscalSlot`); provisioning selects it from the venue's territory. The
 * remaining seats stay declared on the contract and empty until their slices land.
 */
export const ALL_MODULES: readonly WaitronModule[] = [
  {
    name: "core",
    version: "0.0.0",
    tier: "mandatory",
    migrations: { name: "core", table: "__drizzle_migrations_db", from: "../db/drizzle" },
    classification: CORE_CLASSIFICATION,
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
    classification: IDENTITY_CLASSIFICATION,
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
    classification: WORKFORCE_CLASSIFICATION,
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
    classification: WORKFORCE_ES_CLASSIFICATION,
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
    classification: PAYMENTS_CLASSIFICATION,
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
    classification: SCHEDULER_CLASSIFICATION,
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
    classification: CREDENTIALS_CLASSIFICATION,
  },
  {
    name: "fiscal-verifactu",
    version: "0.0.0",
    tier: "provision-only",
    requires: { core: "*" },
    migrations: {
      name: "fiscal-verifactu",
      table: "__drizzle_migrations_fiscal",
      from: "../fiscal-verifactu/drizzle",
    },
    classification: FISCAL_CLASSIFICATION,
    vocabulary: FISCAL_VOCABULARY,
    provisioning: FISCAL_PROVISIONING,
    fiscal: FISCAL_SLOT,
    backup: { restore: FISCAL_RESTORE },
  },
  {
    // The no-regime fiscal-slot member (after `fiscal-verifactu`). It owns no tables (an empty
    // migration set), enrols nothing and contributes only `fiscal` — the sale path records nothing and
    // `drain` has no authority to reach. A core-only dep, so Kahn emits it right after fiscal-verifactu
    // and `orderedMigrationSets(ALL_MODULES)` still equals `manifestSets()` (composition.test.ts pins it).
    name: "fiscal-none",
    version: "0.0.0",
    tier: "provision-only",
    requires: { core: "*" },
    migrations: {
      name: "fiscal-none",
      table: "__drizzle_migrations_fiscal_none",
      from: "../fiscal-none/drizzle",
    },
    fiscal: FISCAL_NONE_SLOT,
  },
  {
    // Bookings — the first UI-bearing AND first genuinely-toggleable module (SP1: server + data). It
    // FKs into `core`, so it requires it; `routes` are the seven booking routes boot mounts
    // generically. The descriptor is the only place bookings is named.
    name: "bookings",
    version: "0.0.0",
    tier: "toggleable",
    requires: { core: "*" },
    migrations: {
      name: "bookings",
      table: "__drizzle_migrations_bookings",
      from: "../bookings/drizzle",
    },
    classification: BOOKINGS_CLASSIFICATION,
    routes: BOOKINGS_ROUTES,
    permissions: BOOKINGS_PERMISSIONS,
    floorAnnotations: BOOKINGS_FLOOR_ANNOTATIONS,
  },
];
