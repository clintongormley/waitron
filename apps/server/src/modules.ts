import type { WaitronModule } from "@waitron/module";

/**
 * Every Waitron module, in the composition list's order — which IS the migration order for this
 * slice (spec §4). This list is the source of truth Task 4 hands to boot in place of the hand-kept
 * `migrations.manifest.json`; `modules.test.ts` pins each descriptor's `migrations` field to the
 * manifest byte-for-byte, so the two cannot drift while both exist.
 *
 * Each `migrations` object carries the exact `{ name, table, from }` from
 * `packages/migrations/migrations.manifest.json`. The `from` folder strings are the domain packages'
 * own directory names (e.g. `../fiscal-verifactu/drizzle`) — Spanish-ish tokens are fine here because
 * `apps/server` is the composition root and is exempt from the english-only guard (spec §4).
 *
 * Only `name`/`version`/`tier`/`migrations` are populated in this slice; `requires`, `sync`, `cards`
 * and the other seats are declared on the contract but stay empty until their own slices land.
 */
export const ALL_MODULES: readonly WaitronModule[] = [
  {
    name: "core",
    version: "0.0.0",
    tier: "mandatory",
    migrations: { name: "core", table: "__drizzle_migrations_db", from: "../db/drizzle" },
  },
  {
    name: "identity",
    version: "0.0.0",
    tier: "toggleable",
    migrations: {
      name: "identity",
      table: "__drizzle_migrations_identity",
      from: "../identity/drizzle",
    },
  },
  {
    name: "workforce",
    version: "0.0.0",
    tier: "toggleable",
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
    migrations: {
      name: "workforce-es",
      table: "__drizzle_migrations_workforce_es",
      from: "../workforce-es/drizzle",
    },
  },
  {
    name: "fiscal",
    version: "0.0.0",
    tier: "provision-only",
    migrations: {
      name: "fiscal",
      table: "__drizzle_migrations_fiscal",
      from: "../fiscal-verifactu/drizzle",
    },
  },
  {
    name: "payments",
    version: "0.0.0",
    tier: "toggleable",
    migrations: {
      name: "payments",
      table: "__drizzle_migrations_payments",
      from: "../payments/drizzle",
    },
  },
  {
    name: "scheduler",
    version: "0.0.0",
    tier: "toggleable",
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
    migrations: { name: "sync", table: "__drizzle_migrations_sync", from: "../sync/drizzle" },
  },
];
