// Idempotent local-dev bootstrap: provision ONE preproduction venue into a local Postgres and
// persist its identity to `apps/server/.env`, so `pnpm dev` boots the server against a real,
// migrated, seeded venue. A trimmed `till-demo.ts` that stops after provisioning + seeding and
// writes the ids down, plus a reuse guard that never re-provisions a live dev database.
//
// The generated `.env` carries `WAITRON_ENV=dev` (SP-C), so `pnpm dev` boots with the dev per-tab
// device switcher ON (`config.devMode`, Task 1). This does NOT touch the fiscal side: `dev` is a
// dev-only input that `deploymentEnvironment` (apps/server/src/config.ts) maps to `preproduction` —
// same AEAT endpoints, same Stripe mode, same per-record `entorno` — so the venue this script
// provisions still BEHAVES AS `preproduction` throughout. Note this is a runtime mapping, not a
// stored stamp: `devSetup` here never calls `stampDeployment` at all (unlike the `/setup-api/provision`
// HTTP route or `waitron-provision instance`), so the database's `deployment` singleton is left
// UNSTAMPED by this flow, and `assertDeploymentMatches` (boot.ts) treats an unstamped database as
// matching any host environment.
//
// FISCAL NOTE (CLAUDE.md §5): re-registering a till starts a NEW hash chain and mints a fresh
// installation number. So this REUSES an already-provisioned venue (an existing `.env` naming a
// tenant the database still holds) and REFUSES to provision when the database already holds a venue
// this `.env` cannot account for — it never mints a second one into a live database. The only
// sanctioned "start over" is `pnpm dev:reset`, which wipes the Docker volume (throwaway
// preproduction data); this script never deletes data itself.
//
// REPLICATION-READY SHAPE (swap step 4): a fresh dev DB is bootstrapped to the SAME migrator-owned
// shape `waitron-provision instance` produces, so a dev boot exercises the real native-replication
// provisioning rather than hiding it behind the superuser. The migrations run AS `waitron_migrator`
// (a session `role=` option, probe A) so every table is migrator-owned — the ownership boot's
// `ensureReplicationShape` needs for its owner-only `CREATE PUBLICATION … FOR TABLE`. The shared dev
// `postgres` database is not a migrator-owned database like production, so the migrator is granted the
// `CREATE` privileges db ownership would otherwise confer, and the SUPERUSER `waitron_repl` bootstrap
// (`replicationBootstrapStatements`, the box image's one-time step in production) runs here when the
// role is absent. The generated `.env` names the migrator connection and the dev replication
// credential so `pnpm dev` boots replication-ready.
//
// Run from the repo root via `pnpm dev:setup` (which brings the container up first); this script
// only polls the connection and provisions. Never against a production database — it creates a
// tenant and chains real fiscal records under `preproduction`.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { and, eq } from "drizzle-orm";
import { asAppUser, createPostgresDb, tills, withTenant, type Database } from "@waitron/db";
import { hashPassword, hashPin } from "@waitron/identity";
import { listDeviceProfiles } from "@waitron/layouts";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  applyVenue,
  planVenue,
  quoteIdent,
  withRole,
  INSTANCE_MIGRATOR_ROLE,
  REPLICATION_ROLE,
  replicationBootstrapStatements,
} from "@waitron/provisioning";
import { parseModuleConfig } from "@waitron/module";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import { ALL_MODULES } from "../src/modules.js";
import { venueModuleConfig } from "../src/provision.js";
import { writeModuleConfig } from "../src/module-config.js";
import { resolveConfigDir } from "../src/config.js";
import { listStations } from "../src/kitchen.js";
import { enrolDeviceForTest } from "../src/testing/enrol.js";
import type { TillConfig } from "../src/till-config.js";
import { parseEnvFile } from "../src/env-file.js";
import { seedDemoRestaurant } from "./demo-seed/seed.js";
import { DEMO_ADMIN_EMAIL, DEMO_DASHBOARD_PASSWORD } from "./demo-seed/staff.js";
import { SEED_INVOICE_LOCALE, type SeedLocale } from "./demo-seed/menu.js";

// Re-exported so `dev-setup.test.ts`'s round-trip assertion keeps importing it from here; the parser
// itself is the shared, dependency-free `env-file.ts` one (split on the first `=`, skip blank/`#`).
export { parseEnvFile };

/** The container superuser + default database every demo uses — one place so the scripts agree. */
export const DEV_DATABASE_URL = "postgres://postgres:pg@localhost:5432/postgres";

/** The dev `waitron_repl` password. A fixed dev secret; production mints a real one in the box image /
 * operator step. Written to `.env` as `WAITRON_REPLICATION_PASSWORD` so `pnpm dev` boots replication-ready. */
export const DEV_REPLICATION_PASSWORD = "dev-repl";

/** The migrations connection: the dev superuser url with a `role=waitron_migrator` session option
 * (probe A), so `applyMigrations` runs AS the migrator and every table is migrator-owned — the shape
 * `waitron-provision instance` produces, which boot's `ensureReplicationShape` needs for its owner-only
 * `CREATE PUBLICATION … FOR TABLE`. Pure. */
export function devMigrationsUrl(databaseUrl: string): string {
  return withRole(databaseUrl, INSTANCE_MIGRATOR_ROLE);
}

/** The dev venue's fiscal territory. Named once so the venue plan and the fiscal-slot `modules.json`
 * `devSetup` writes select the SAME regime (ES-common → Veri*Factu); the boot then resolves the slot
 * to exactly that member rather than refusing `module.fiscal_slot_ambiguous` under the default-on set. */
export const DEV_VENUE_TERRITORY = "ES-common";

/** The one demo PIN. Every login — the provisioned admin and every seeded staff member (seedStaff's
 * `DEMO_PIN`) — shares it, so the demo hands out a single number. */
export const ADMIN_PIN = "5555";
/** The provisioned admin's ("Administradora") dashboard password. Single source of truth: the demo
 * dashboard password the seeded manager also gets (`DEMO_DASHBOARD_PASSWORD`, staff.ts), imported here
 * rather than re-spelt so the two cannot drift and silently break the demo login. The admin signs in to
 * the dashboard with `DEMO_ADMIN_EMAIL` (set during provisioning) + this password. */
const ADMIN_PASSWORD = DEMO_DASHBOARD_PASSWORD;

/**
 * The demo's BARE content locale, resolved from the environment at each run: English by default,
 * Spanish only when `WAITRON_SEED_LOCALE=es-ES` is set explicitly (the env var stays the familiar
 * full tag; the returned value is the bare content key). It drives every seeded menu/floor/status/
 * staff string; the full tag it maps to (`SEED_INVOICE_LOCALE`) drives the location's `invoiceLocales`,
 * the historical sales' fiscal locale, and the `WAITRON_TILL_LOCALE` the server boots the till against.
 * Read at call time (not module load) so it is testable and so a one-shot
 * `WAITRON_SEED_LOCALE=es-ES pnpm dev:reset` takes effect.
 */
export function resolveSeedLocale(): SeedLocale {
  return process.env.WAITRON_SEED_LOCALE === "es-ES" ? "es" : "en";
}

/**
 * The historical-sales horizon, resolved from the environment at each run: `WAITRON_SEED_SALES_DAYS`
 * days of back-dated preproduction sales, defaulting to 28 (0 skips sales entirely). Read at call time
 * (not module load) so the default lives in one place and a one-shot `WAITRON_SEED_SALES_DAYS=… pnpm
 * dev:reset` takes effect — mirrors {@link resolveSeedLocale}. Both `devSetup` (the seed horizon) and
 * `main` (the human summary line) read it, so the `"28"` default is not duplicated. A non-numeric
 * value (e.g. a typo) falls back to the same default rather than propagating `NaN` into the seed
 * horizon and the printed summary.
 */
export function resolveSalesDays(): number {
  const n = Number(process.env.WAITRON_SEED_SALES_DAYS ?? "28");
  return Number.isFinite(n) && n >= 0 ? n : 28;
}

/** The exact env contract `apps/server` boots against (config.ts + till-config.ts), in write order. */
export interface DevEnv {
  DATABASE_URL: string;
  WAITRON_MIGRATIONS_DATABASE_URL: string;
  WAITRON_ENV: string;
  WAITRON_ONBOARDING_INTENT: string;
  WAITRON_HTTP_PORT: string;
  WAITRON_CREDENTIALS_KEY: string;
  WAITRON_CREDENTIALS_KEY_VERSION: string;
  WAITRON_TILL_TENANT_ID: string;
  WAITRON_TILL_TILL_ID: string;
  WAITRON_TILL_NODE_ID: string;
  WAITRON_TILL_SERIES_ID: string;
  WAITRON_TILL_LOCATION_ID: string;
  WAITRON_TILL_LOCALE: string;
  WAITRON_REPLICATION_HOST: string;
  WAITRON_REPLICATION_PASSWORD: string;
}

/** Ordered so `renderEnvFile` emits a stable, reviewable `.env`. */
const ENV_KEYS: readonly (keyof DevEnv)[] = [
  "DATABASE_URL",
  "WAITRON_MIGRATIONS_DATABASE_URL",
  "WAITRON_ENV",
  "WAITRON_ONBOARDING_INTENT",
  "WAITRON_HTTP_PORT",
  "WAITRON_CREDENTIALS_KEY",
  "WAITRON_CREDENTIALS_KEY_VERSION",
  "WAITRON_TILL_TENANT_ID",
  "WAITRON_TILL_TILL_ID",
  "WAITRON_TILL_NODE_ID",
  "WAITRON_TILL_SERIES_ID",
  "WAITRON_TILL_LOCATION_ID",
  "WAITRON_TILL_LOCALE",
  "WAITRON_REPLICATION_HOST",
  "WAITRON_REPLICATION_PASSWORD",
];

/**
 * Render a keyed `.env`: a generated-by `header`, then one `KEY=value` line per key in `keys` (in
 * that order), terminated by a single trailing newline. The shared body of both dev bootstrap
 * scripts' renderers — `renderEnvFile` here and `dev-onboard`'s `renderSetupEnvFile` differ only in
 * their header text and their key list, so the line-building lives in exactly one place. Pure.
 */
export function renderEnvFileLines<K extends string>(
  header: string,
  keys: readonly K[],
  env: Record<K, string>,
): string {
  const lines = keys.map((key) => `${key}=${env[key]}`);
  return [header, ...lines].join("\n") + "\n";
}

/** The `.env` text: a generated-by header, then one `KEY=value` line per contract key. Pure. */
export function renderEnvFile(env: DevEnv): string {
  const header =
    "# Generated by `pnpm dev:setup` — do not edit by hand. Regenerate: `pnpm dev:reset`.";
  return renderEnvFileLines(header, ENV_KEYS, env);
}

export interface DevSetupOptions {
  /** The database to provision into and to write as `DATABASE_URL`. */
  databaseUrl: string;
  /** Where to read/write the `.env`. */
  envPath: string;
  /** The box's state directory — where the fiscal-slot `modules.json` is written so the next `pnpm dev`
   * boot reads a slot that resolves. Must be the SAME dir the server resolves at boot
   * (`WAITRON_STATE_DIR` or `DEFAULT_STATE_ROOT`); `main` resolves it that way. */
  stateDir: string;
  log?: (line: string) => void;
}

export interface DevSetupResult {
  /** True when an already-provisioned venue was reused (no new fiscal chain). */
  reused: boolean;
  env: DevEnv;
}

/** The five fiscal ids `provisionVenue` returns, in the shape `buildDevEnv` maps to the env contract. */
export interface DevVenueIds {
  tenantId: string;
  tillId: string;
  nodeId: string;
  seriesId: string;
  locationId: string;
}

/**
 * Assemble the server's `.env` contract from a run's varying inputs — the database url, the generated
 * credentials key, the provisioned venue's ids, and the resolved seed locale. Pure (no I/O, no env
 * reads), so the bare-`seedLocale` → full-tag `WAITRON_TILL_LOCALE` mapping (`SEED_INVOICE_LOCALE`) is
 * proven for BOTH locales in a unit test without a container — the container-backed `devSetup` suite
 * then proves this env is what reaches disk (CLAUDE.md §1/§4: the es-ES value must reach `.env` through
 * the real flow, not only via `resolveSeedLocale`, and `devSetup` builds its env here).
 */
export function buildDevEnv(input: {
  databaseUrl: string;
  credentialsKey: string;
  ids: DevVenueIds;
  seedLocale: SeedLocale;
}): DevEnv {
  const { databaseUrl, credentialsKey, ids, seedLocale } = input;
  return {
    DATABASE_URL: databaseUrl,
    // The migrator connection (role=waitron_migrator session option) so a dev boot migrates and
    // reconciles its replication shape AS the table owner, exactly as production does.
    WAITRON_MIGRATIONS_DATABASE_URL: devMigrationsUrl(databaseUrl),
    WAITRON_ENV: "dev",
    WAITRON_ONBOARDING_INTENT: "demo",
    WAITRON_HTTP_PORT: "8080",
    WAITRON_CREDENTIALS_KEY: credentialsKey,
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
    WAITRON_TILL_TENANT_ID: ids.tenantId,
    WAITRON_TILL_TILL_ID: ids.tillId,
    WAITRON_TILL_NODE_ID: ids.nodeId,
    WAITRON_TILL_SERIES_ID: ids.seriesId,
    WAITRON_TILL_LOCATION_ID: ids.locationId,
    WAITRON_TILL_LOCALE: SEED_INVOICE_LOCALE[seedLocale],
    // Native replication: the advertise host a peer dials and the `waitron_repl` credential. `pnpm dev`
    // is single-node, so nothing subscribes; setting them makes boot's `ensureReplicationShape` run
    // (the publisher side), so the dev boot IS the replication-provisioning smoke.
    WAITRON_REPLICATION_HOST: "localhost",
    WAITRON_REPLICATION_PASSWORD: DEV_REPLICATION_PASSWORD,
  };
}

/** True once every env-contract key is present and non-empty in a parsed `.env`. */
function isCompleteDevEnv(rec: Record<string, string>): rec is Record<string, string> & DevEnv {
  return ENV_KEYS.every((key) => {
    const value = rec[key];
    return value !== undefined && value !== "";
  });
}

/** Poll until Postgres accepts a connection. The root `dev:setup`/`dev:reset` scripts already pass
 * `docker compose up -d --wait db` (so Docker blocks on the healthcheck), but a direct
 * `pnpm --filter @waitron/server dev:setup` skips that gate, so this is the readiness net for the
 * standalone path — one immediate connect on the warm path. */
export async function waitForPostgres(uri: string, log: (line: string) => void): Promise<void> {
  const attempts = 60;
  const delayMs = 1000;
  for (let i = 1; i <= attempts; i++) {
    const client = new pg.Client({ connectionString: uri });
    try {
      await client.connect();
      await client.query("select 1");
      return;
    } catch (error) {
      if (i === attempts) {
        throw new Error(
          `dev-setup: Postgres at the configured DATABASE_URL did not accept connections after ${attempts} attempts — is \`docker compose up -d db\` running?`,
          { cause: error },
        );
      }
      if (i === 1) log("dev-setup: waiting for Postgres…");
      await delay(delayMs);
    } finally {
      await client.end().catch(() => {});
    }
  }
}

/**
 * Read whether the database contains the expected tenant and whether any tenant
 * exists. The connection needs SELECT on tenants; the query enforces that privilege.
 * Only an absent tenants table means no venue; propagate other query failures so
 * a failed inspection cannot trigger provisioning over an existing venue.
 */
export async function inspectVenues(
  uri: string,
  expectedTenantId: string | null,
): Promise<{ hasExpected: boolean; hasAny: boolean }> {
  const client = new pg.Client({ connectionString: uri });
  try {
    await client.connect();

    const { rows } = await client.query<{ has_expected: boolean; has_any: boolean }>(
      "select exists(select 1 from tenants where id = $1) as has_expected, exists(select 1 from tenants) as has_any",
      [expectedTenantId],
    );
    return { hasExpected: rows[0]?.has_expected ?? false, hasAny: rows[0]?.has_any ?? false };
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "42P01") {
      return { hasExpected: false, hasAny: false };
    }
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

/** Provision one preproduction venue + SIF, then seed the full demo restaurant (two menus, floor,
 * staff, media, and `salesDays` of back-dated preproduction sales) via `seedDemoRestaurant`. Returns
 * the five fiscal ids the server boots against. The bare `seedLocale` drives every seeded string; the
 * full tag it maps to (`SEED_INVOICE_LOCALE`) drives the location's `invoiceLocales`; `salesDays` is
 * the historical-sales horizon (0 skips sales). */
async function provisionVenue(
  db: Database,
  seedLocale: SeedLocale,
  salesDays: number,
): Promise<{
  tenantId: string;
  tillId: string;
  nodeId: string;
  seriesId: string;
  locationId: string;
}> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: "50000000K",
        legalName: "Waitron Dev SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: DEV_VENUE_TERRITORY,
          invoiceLocales: [SEED_INVOICE_LOCALE[seedLocale]],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        tillName: "Caja 1",
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin(ADMIN_PIN),
          passwordHash: hashPassword(ADMIN_PASSWORD),
          email: DEMO_ADMIN_EMAIL,
        },
      },
      ALL_MODULES,
    ),
    { db, modules: ALL_MODULES },
  );

  // planVenue emits the standard series first, then the rectificative one — seriesIds[0] is the
  // ordinary sale's series (the same index `till-demo.ts` reads).
  const ids = {
    tenantId: venue.tenantId,
    tillId: venue.tillId,
    nodeId: venue.nodeId,
    seriesId: venue.seriesIds[0]!,
    locationId: venue.locationId,
  };

  // Stand up the whole demo restaurant on the fresh venue: catalogues/floor/staff/media in one
  // tenant/app_user tx, then the back-dated preproduction sales (its own per-sale tx). This replaces
  // the former inline "Delicatessen + one Cajera" stub — the demo now seeds real menus and staff.
  await seedDemoRestaurant(db, { venue: ids, locale: seedLocale, salesDays });

  // Enrol the three demo devices through the SHIPPING enrol path — after the demo restaurant seeds
  // its "Cocina" station and "Barra" (the kds binds one).
  await seedDemoDevices(db, ids, seedLocale);

  return ids;
}

/**
 * Enrol three demo devices via `enrolDeviceForTest` (`src/testing/enrol.ts`, the fixture every
 * join-and-accept suite shares) so `?dev`'s chooser lists a real till, handheld and kitchen display on
 * first run. This runs the store body — `createJoinRequest` then `acceptDeviceJoinRequest`'s
 * profile-resolve → bind → `devices` insert — NOT the admin-facing pairing window or numeric
 * challenge/match gate, which the fixture deliberately bypasses (it is not a production verb). So the
 * seed exercises the accept store logic, not the shipping window-and-match flow, and stops short of
 * direct-inserting `devices` rows. Each device is its own transaction now that join-and-accept replaces the
 * pairing code's single mint→redeem pair with a knock and a separate accept — there is no longer one
 * shared tenant transaction to roll the three back together, so a failure partway leaves the earlier
 * device(s) enrolled; devSetup's own idempotency check (a venue already provisioned refuses a second
 * run) is what a partial seed falls back on, not a rollback.
 *
 * The bindings mirror `resolveDeviceBinding`'s form-factor rules (device.ts):
 *  - the TILL profile AUTO-CREATES its own register named after the device, so the till device is
 *    "Mostrador" — NOT "Caja 1", the register provisioning already made, which would trip the
 *    `tills (tenant, location, name)` unique index → `device.register_name_taken`;
 *  - the HANDHELD binds to the counter till device's OWN register ("Mostrador") — the deli shape where
 *    the waiter's phone rings into the same drawer as the counter, adding no third register;
 *  - the KITCHEN display binds to the provisioned default "Cocina" station (looked up by name, the same
 *    key `seed-catalogue.ts` resolves it by; the name is not localized).
 */
async function seedDemoDevices(
  db: Database,
  ids: DevVenueIds,
  seedLocale: SeedLocale,
): Promise<void> {
  // The enrol verbs are typed `cfg: TillConfig`; they read only `tenantId`/`locationId` (and the join
  // request carries the venue), so the sale-side fields carry inert-but-valid placeholders (no card,
  // no tips, `prepay`) — the enrol path never persists them.
  const cfg: TillConfig = {
    tenantId: brandTenantId(ids.tenantId),
    tillId: brandTillId(ids.tillId),
    nodeId: brandNodeId(ids.nodeId),
    seriesId: brandSeriesId(ids.seriesId),
    locationId: brandLocationId(ids.locationId),
    locale: SEED_INVOICE_LOCALE[seedLocale],
    invoiceLocales: [SEED_INVOICE_LOCALE[seedLocale]],
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };

  // The profiles + stations the devices bind to — provisioning seeds one profile per form factor
  // (till/kds/phone-portrait) and the default "Cocina" station.
  const { profiles, stations } = await withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return {
      profiles: await listDeviceProfiles(tx, cfg.tenantId),
      stations: await listStations(tx, cfg),
    };
  });
  const profileFor = (formFactor: "till" | "kds" | "phone-portrait"): string => {
    const profile = profiles.find((p) => p.formFactor === formFactor);
    if (profile === undefined) {
      throw new Error(`dev-setup: no seeded device profile for form factor "${formFactor}"`);
    }
    return profile.id;
  };
  const kitchen = stations.find((s) => s.name === "Cocina");
  if (kitchen === undefined) {
    throw new Error('dev-setup: no "Cocina" kitchen station to bind the kitchen display to');
  }

  // 1. Till — auto-creates its register "Mostrador".
  await enrolDeviceForTest(db, cfg, { name: "Mostrador", profileId: profileFor("till") });

  // The register the till device just minted, re-read fresh — `enrolDeviceForTest` returns the
  // device, not its register, and the counter's register is the one the handheld rings into.
  const counter = (
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx
        .select({ id: tills.id })
        .from(tills)
        .where(
          and(
            eq(tills.tenantId, cfg.tenantId),
            eq(tills.locationId, cfg.locationId),
            eq(tills.name, "Mostrador"),
          ),
        );
    })
  )[0];
  if (counter === undefined) {
    throw new Error('dev-setup: the till enrol did not create its "Mostrador" register');
  }

  // 2. Handheld — bound to the counter's register.
  await enrolDeviceForTest(db, cfg, {
    name: "Camarero 1",
    profileId: profileFor("phone-portrait"),
    registerId: counter.id,
  });

  // 3. Kitchen display — bound to the "Cocina" station.
  await enrolDeviceForTest(db, cfg, {
    name: "Pantalla Cocina",
    profileId: profileFor("kds"),
    stationId: kitchen.id,
  });
}

/**
 * The idempotent bootstrap, with a fiscal safety property: it provisions a venue ONLY into a database
 * that holds none. Three cases (CLAUDE.md §5 — a second venue is a second SIF and a second hash
 * chain):
 *
 *  - the `.env` names a tenant the database still holds → REUSE it, provision nothing;
 *  - the database already holds a venue the `.env` does NOT name (a lost/stale/mismatched `.env`
 *    against a live volume) → REFUSE, directing the operator to `pnpm dev:reset`;
 *  - the database holds no venue (first run, or a freshly wiped volume) → migrate, provision one
 *    preproduction venue, seed it, and write the `.env`.
 *
 * The only sanctioned "start over" is `pnpm dev:reset`, which wipes the Docker volume (throwaway
 * preproduction data); this function never deletes data itself.
 */
/**
 * Persist the fiscal-slot `modules.json` into the box's state dir so the next `pnpm dev` boot resolves
 * the slot to exactly one member. `ALL_MODULES` now carries TWO fiscal-slot members, so the default-on
 * set (an absent file) enables both and boot refuses `module.fiscal_slot_ambiguous`. Same mechanism the
 * boot wizard binding and the `waitron-provision` CLI use: `venueModuleConfig` selects the module the
 * venue's territory (ES-common → `verifactu`) names and disables every other slot member. Written on
 * BOTH the reuse and fresh paths (idempotent), so a dev DB provisioned before this fix gets the file the
 * next time `dev:setup` runs. `mkdirSync` first — `writeFileAtomic` does not create the parent dir, and
 * a trading dev boot never materialises the state dir itself.
 */
async function writeFiscalModulesJson(
  stateDir: string,
  log: (line: string) => void,
): Promise<void> {
  const config = venueModuleConfig(parseModuleConfig({}, ALL_MODULES), DEV_VENUE_TERRITORY);
  mkdirSync(stateDir, { recursive: true });
  const path = await writeModuleConfig(stateDir, config);
  log(`dev-setup: wrote ${path} (fiscal slot → verifactu; fiscal-none disabled)`);
}

/**
 * Bootstrap the migrator-owned + replication-ready shape on a FRESH dev database, idempotently. Run as
 * the container superuser (the dev `DATABASE_URL`), which pg exposes as a full superuser — enough for
 * `create role`, `alter system`, and the `waitron_repl` replication login the bootstrap mints. The
 * shared dev `postgres` database is superuser-owned (unlike production's per-instance migrator-owned
 * database), so the migrator is granted the `CREATE` privileges db ownership would confer. Idempotent:
 * the migrator role and the `waitron_repl` bootstrap are each guarded on the role's absence, so a
 * re-run is a no-op.
 */
export async function ensureDevReplicationShape(
  superuserUrl: string,
  log: (line: string) => void,
): Promise<void> {
  const url = new URL(superuserUrl);
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const adminUser = decodeURIComponent(url.username);
  const migrator = quoteIdent(INSTANCE_MIGRATOR_ROLE);
  const client = new pg.Client({ connectionString: superuserUrl });
  await client.connect();
  try {
    // The migrator role — `login createrole` because the migrate (run AS it) creates `app_user`.
    // Guarded so a re-run does not error on an existing role.
    const hasMigrator = await client.query("select 1 from pg_roles where rolname = $1", [
      INSTANCE_MIGRATOR_ROLE,
    ]);
    if (hasMigrator.rowCount === 0) {
      await client.query(`create role ${migrator} login createrole`);
      log(`dev-setup: created ${INSTANCE_MIGRATOR_ROLE}`);
    }
    // The privileges production gets from db ownership, granted explicitly on the shared dev database:
    // CREATE on schema public so the migrate (AS the migrator) can create its tables; CREATE on the
    // database so boot's `CREATE PUBLICATION` (also the migrator) is permitted; and the SET grant so the
    // superuser can `set role` to the migrator via the `role=` connection option.
    await client.query(`grant create on schema public to ${migrator}`);
    if (dbName !== "") {
      await client.query(`grant create on database ${quoteIdent(dbName)} to ${migrator}`);
    }
    await client.query(`grant ${migrator} to ${quoteIdent(adminUser)} with set true`);
    // The SUPERUSER `waitron_repl` bootstrap (the box image's one-time step in production): create the
    // replication login, grant the migrator `pg_create_subscription`, the SELECT + default-privilege
    // grants, and the WAL cap. Run only when `waitron_repl` is absent, and BEFORE the migrate so its
    // migrator default privileges cover every migrated table (spec §13.3).
    const hasRepl = await client.query("select 1 from pg_roles where rolname = $1", [
      REPLICATION_ROLE,
    ]);
    if (hasRepl.rowCount === 0) {
      for (const statement of replicationBootstrapStatements(DEV_REPLICATION_PASSWORD)) {
        await client.query(statement);
      }
      log(`dev-setup: bootstrapped native replication (${REPLICATION_ROLE})`);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

export async function devSetup(opts: DevSetupOptions): Promise<DevSetupResult> {
  const { databaseUrl, envPath, stateDir, log = () => {} } = opts;

  await waitForPostgres(databaseUrl, log);

  // Read the existing `.env` (if any) and ask the database, in one connection, whether it holds the
  // tenant that `.env` names and whether it holds any tenant at all.
  const existing = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, "utf8")) : undefined;
  const expectedTenantId =
    existing !== undefined && isCompleteDevEnv(existing) ? existing.WAITRON_TILL_TENANT_ID : null;
  const { hasExpected, hasAny } = await inspectVenues(databaseUrl, expectedTenantId);

  // Reuse: the `.env` names a venue the database still holds.
  if (existing !== undefined && isCompleteDevEnv(existing) && hasExpected) {
    log("dev-setup: reusing the already-provisioned venue (no new fiscal chain)");
    // Still (re)write the fiscal-slot modules.json: a dev DB provisioned before this file wrote one has
    // no modules.json, and without it the reused venue's next boot would refuse fiscal_slot_ambiguous.
    await writeFiscalModulesJson(stateDir, log);
    return { reused: true, env: existing };
  }

  // Refuse: the database already holds a venue this `.env` cannot account for. Provisioning would
  // start a second fiscal chain, so fail loud rather than do it (CLAUDE.md §5).
  if (hasAny) {
    throw new Error(
      "dev-setup: the database already holds a venue, but this apps/server/.env does not name it " +
        "(missing, stale, or mismatched). Refusing to provision a second venue — it would start a new " +
        "fiscal chain. Run `pnpm dev:reset` to wipe the dev volume and re-provision from scratch.",
    );
  }

  // Bootstrap the migrator-owned + replication-ready shape BEFORE migrating: the migrator's default
  // privileges (set here) then travel to every table the migrate creates (spec §13.3), so a dev boot
  // reconciles its publications exactly as production does.
  await ensureDevReplicationShape(databaseUrl, log);

  // Fresh provision: migrate the full manifest from source (the same sets the server migrates at
  // boot — `boot.ts` uses `migrationOptionsFor(manifestSets(), config.migrationsRoot)`; `null` is
  // the from-source root, resolved to each package's own `drizzle` dir). Migrate AS the migrator (the
  // `role=` session option) so every table is migrator-owned.
  log("dev-setup: migrating…");
  await applyMigrations(devMigrationsUrl(databaseUrl), migrationOptionsFor(manifestSets(), null));

  // Resolve the seed shape ONCE per run: the locale (English default, Spanish via WAITRON_SEED_LOCALE)
  // and the historical-sales horizon (WAITRON_SEED_SALES_DAYS, default 28; 0 skips sales entirely).
  const seedLocale = resolveSeedLocale();
  const salesDays = resolveSalesDays();

  const db = await createPostgresDb(databaseUrl);
  let ids;
  try {
    log("dev-setup: provisioning a preproduction venue + seeding the demo restaurant…");
    ids = await provisionVenue(db, seedLocale, salesDays);
  } finally {
    await db.close();
  }

  const env = buildDevEnv({
    databaseUrl,
    credentialsKey: randomBytes(32).toString("base64"),
    ids,
    seedLocale,
  });
  writeFileSync(envPath, renderEnvFile(env));
  log(`dev-setup: wrote ${envPath}`);
  // Resolve the fiscal slot for the trading dev boot (ES-common → verifactu, fiscal-none disabled), so
  // `pnpm dev` does not refuse module.fiscal_slot_ambiguous under the default-on two-member set.
  await writeFiscalModulesJson(stateDir, log);
  return { reused: false, env };
}

/** The CLI entrypoint: resolve `apps/server/.env`, run `devSetup`, print a human summary. */
async function main(): Promise<void> {
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));
  const databaseUrl =
    process.env.DATABASE_URL !== undefined && process.env.DATABASE_URL !== ""
      ? process.env.DATABASE_URL
      : DEV_DATABASE_URL;

  // Resolve the state dir EXACTLY as boot does (`WAITRON_STATE_DIR` else `DEFAULT_STATE_ROOT`), so the
  // fiscal-slot modules.json lands where `pnpm dev` will read it. `DEFAULT_STATE_ROOT` is imported
  // dynamically so importing this module in tests does not pull the whole `boot.ts` graph.
  const { DEFAULT_STATE_ROOT } = await import("../src/boot.js");
  const stateDir = resolveConfigDir(process.env.WAITRON_STATE_DIR, DEFAULT_STATE_ROOT);

  const result = await devSetup({
    databaseUrl,
    envPath,
    stateDir,
    log: (line) => void console.log(line),
  });

  console.log("");
  console.log(
    result.reused
      ? "dev-setup: reused the existing venue — nothing re-provisioned."
      : "dev-setup: provisioned a fresh preproduction venue.",
  );
  console.log("");
  console.log("  till       http://localhost:5190");
  console.log("  dashboard  http://localhost:5191");
  console.log("  server     http://localhost:8080");
  // `pnpm dev` starts the setup wizard (apps/setup, Vite 5192) too, but a venue was just
  // provisioned so the box boots in TRADING mode — where `/setup-api` is unrouted: boot.ts registers
  // every `/setup-api` route (via `mountDiscovery` and `mountSetup`) exclusively inside the
  // setup-mode branch gated on `config.till === undefined`, and a provisioned box has `config.till`
  // set, so it takes the trading `else` and mounts none of them. The wizard's proxied calls
  // therefore 404 and it does nothing. Listed as inactive rather than omitted, so its absence from
  // the "open these" set is explained rather than looking like a missing process.
  console.log("  setup      http://localhost:5192   (setup wizard — inactive in trading mode)");
  console.log("");
  console.log(`  demo PIN (every till login):   ${ADMIN_PIN}`);
  console.log(`  dashboard login (owner):       ${DEMO_ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`  locale:                        ${result.env.WAITRON_TILL_LOCALE}`);
  console.log("");
  console.log("  Pick a pre-enrolled device at http://localhost:5190/?dev");
  console.log("    Mostrador (till) · Camarero 1 (handheld) · Pantalla Cocina (kitchen display)");
  console.log("");
  console.log(
    "  Or knock from a FRESH browser at http://localhost:5190 — a manager then switches on",
  );
  console.log("  pairing mode in the dashboard and matches the number the till shows.");
  const salesDays = resolveSalesDays();
  if (!result.reused) {
    console.log(
      salesDays > 0
        ? `  reports carry ~${salesDays} days of back-dated sales history.`
        : "  no historical sales seeded (WAITRON_SEED_SALES_DAYS=0).",
    );
  }
  console.log("");
  console.log("Next: `pnpm dev` (or `wa-wt <worktree>`) to start all four app processes.");
}

// Run only when invoked directly (`tsx scripts/dev-setup.ts`), never when imported by a test —
// the demos run `main()` on import; this must not, or importing it would spin a container.
if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  main().catch((error: unknown) => {
    console.error("dev-setup: failed");
    console.error(error);
    process.exit(1);
  });
}
