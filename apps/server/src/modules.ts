import { CORE_ENROLMENT } from "@waitron/db";
import { FISCAL_ENROLMENT, FISCAL_VOCABULARY } from "@waitron/fiscal-verifactu";
import { IDENTITY_ENROLMENT } from "@waitron/identity";
import type { WaitronModule } from "@waitron/module";
import { PAYMENTS_ENROLMENT } from "@waitron/payments";
import type { EnrolledTable } from "@waitron/sync";
import { WORKFORCE_ES_VOCABULARY } from "@waitron/workforce-es";

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
 * `name`/`version`/`tier`/`migrations` and now `requires` are populated. `requires` carries the
 * verified cross-set dependency graph (spec §3): every non-core module depends on `core`. Cross-set
 * dependencies arrive via BOTH foreign-key references AND `CREATE TRIGGER … ON <table>` targets — a
 * module that installs a capture trigger on another module's table needs that table migrated first.
 * There are four inter-module edges: `workforce → identity` (workforce FKs `persons`, which
 * identity owns), `sync → identity` + `sync → payments` (sync's capture triggers attach to
 * identity's `persons`/`webauthn_credentials` and payments' `payments`/`payment_refunds`/
 * `payment_policy`), and `fiscal → sync` (SP-3a: fiscal's capture triggers call sync's
 * `sync_capture()` SPI, so sync's set must migrate first). All ranges are `"*"` because every module
 * is workspace-locked at version `0.0.0`.
 *
 * The `sync` seat is POPULATED on `core`/`identity`/`payments`/`fiscal` (SP-2a, SP-3a): each owning
 * package declares its own enrolment array and the composition root injects it here, so
 * `@waitron/sync` imports no domain schema. The `vocabulary` seat is POPULATED on `fiscal` and
 * `workforce-es` (SP-3b): each Spanish-by-design package exports the terms it owns
 * (`FISCAL_VOCABULARY`/`WORKFORCE_ES_VOCABULARY`) and the root english-only suite assembles the
 * forbidden set from these declarations, deriving each owner's package dir from `migrations.from`.
 * Every OTHER descriptor carries neither — nothing else enrols, and the generic modules are English.
 * `cards` and the remaining seats are still declared on the contract but stay empty until their own
 * slices land.
 */
export const ALL_MODULES: readonly WaitronModule[] = [
  {
    name: "core",
    version: "0.0.0",
    tier: "mandatory",
    migrations: { name: "core", table: "__drizzle_migrations_db", from: "../db/drizzle" },
    sync: CORE_ENROLMENT,
    // BR-2: the content-addressed media store is core's non-DB state; a backup must capture it
    // alongside the DB. `restore` is a later slice's seat (BR-3/BR-4) — unpopulated here.
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
  },
];

/** The composition root's assembled sync-enrolment set — every module's declared enrolment, in
 * ALL_MODULES order (SP-2a inversion). `@waitron/sync` no longer owns this; boot injects it into
 * mountSyncApi/runSyncPull/readDrainProgress, and the tests use the same reference. Assembled from
 * ALL_MODULES (not the enabled set) — the enabled-set-aware pull is DEFERRED (spec §2/§7), built
 * with the first genuinely-toggleable module. */
export const ALL_SYNC_ENROLMENTS: readonly EnrolledTable[] = ALL_MODULES.flatMap(
  (m) => m.sync ?? [],
);

/** table → owning-module name, built at the composition root (SP-2b). The apply gate resolves a
 * sync_log row's module by table name; it is a side map rather than a field on EnrolledTable so
 * SP-2a's enrolment type and its threading stay untouched (spec §5). */
export const MODULE_BY_TABLE: ReadonlyMap<string, string> = new Map(
  ALL_MODULES.flatMap((m) => (m.sync ?? []).map((e) => [e.table, m.name] as const)),
);
