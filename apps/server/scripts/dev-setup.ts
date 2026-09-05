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
// Run from the repo root via `pnpm dev:setup` (which brings the container up first); this script
// only polls the connection and provisions. Never against a production database — it creates a
// tenant and chains real fiscal records under `preproduction`.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import {
  asAppUser,
  createPostgresDb,
  withTenant,
  type Database,
  type Transaction,
} from "@waitron/db";
import { hashPassword, hashPin } from "@waitron/identity";
import { DEFAULT_DEVICE_PROFILES, defaultProfileName, listDeviceProfiles } from "@waitron/layouts";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyVenue, planVenue } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import { generatePairingCode } from "../src/device.js";
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

/** The one demo PIN. Every login — the provisioned admin and every seeded staff member (seedStaff's
 * `DEMO_PIN`) — shares it, so the demo hands out a single number. */
export const ADMIN_PIN = "5555";
/** The provisioned admin's ("Administradora") dashboard password. Single source of truth: the demo
 * dashboard password the seeded manager also gets (`DEMO_DASHBOARD_PASSWORD`, staff.ts), imported here
 * rather than re-spelt so the two cannot drift and silently break the demo login. The admin signs in to
 * the dashboard with `DEMO_ADMIN_EMAIL` (set by `seedStaff`) + this password. */
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
  WAITRON_ENV: string;
  WAITRON_HTTP_PORT: string;
  WAITRON_CREDENTIALS_KEY: string;
  WAITRON_CREDENTIALS_KEY_VERSION: string;
  WAITRON_TILL_TENANT_ID: string;
  WAITRON_TILL_TILL_ID: string;
  WAITRON_TILL_NODE_ID: string;
  WAITRON_TILL_SERIES_ID: string;
  WAITRON_TILL_LOCATION_ID: string;
  WAITRON_TILL_LOCALE: string;
}

/** Ordered so `renderEnvFile` emits a stable, reviewable `.env`. */
const ENV_KEYS: readonly (keyof DevEnv)[] = [
  "DATABASE_URL",
  "WAITRON_ENV",
  "WAITRON_HTTP_PORT",
  "WAITRON_CREDENTIALS_KEY",
  "WAITRON_CREDENTIALS_KEY_VERSION",
  "WAITRON_TILL_TENANT_ID",
  "WAITRON_TILL_TILL_ID",
  "WAITRON_TILL_NODE_ID",
  "WAITRON_TILL_SERIES_ID",
  "WAITRON_TILL_LOCATION_ID",
  "WAITRON_TILL_LOCALE",
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
    WAITRON_ENV: "dev",
    WAITRON_HTTP_PORT: "8080",
    WAITRON_CREDENTIALS_KEY: credentialsKey,
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
    WAITRON_TILL_TENANT_ID: ids.tenantId,
    WAITRON_TILL_TILL_ID: ids.tillId,
    WAITRON_TILL_NODE_ID: ids.nodeId,
    WAITRON_TILL_SERIES_ID: ids.seriesId,
    WAITRON_TILL_LOCATION_ID: ids.locationId,
    WAITRON_TILL_LOCALE: SEED_INVOICE_LOCALE[seedLocale],
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
 * Two facts about a database's venues, read in one connection: whether it holds the SPECIFIC tenant
 * the `.env` names (`hasExpected` — reuse this venue), and whether it holds ANY tenant at all
 * (`hasAny` — refuse to provision a second one). `expectedTenantId` is `null` when there is no usable
 * `.env` to match, in which case `hasExpected` is trivially false.
 *
 * REQUIRES a superuser or BYPASSRLS connection. `tenants` is under FORCE ROW LEVEL SECURITY (policy
 * `USING (id = current_tenant_id())`), so on a non-privileged connection with no tenant GUC set, both
 * `exists()` checks below silently return false even when tenants exist — a false negative that would
 * defeat the refuse-to-clobber guard both `dev-setup` and `dev-onboard` rely on to avoid minting a
 * second fiscal chain (CLAUDE.md §5). Rather than risk that silently, this asserts the connection's
 * privilege FIRST (`pg_roles.rolsuper or rolbypassrls` for `current_user`) and throws loudly if it is
 * neither — `pg_roles` always exists, migrated or not, so the assertion runs even against a
 * freshly-wiped volume, before the `tenants` query that needs the table to exist.
 *
 * A missing `tenants` table (an unmigrated database — e.g. a freshly wiped volume) is "no venue at
 * all", so `42P01 undefined_table` returns both-false and the caller provisions fresh. Any OTHER
 * failure (a permission error, a malformed id → `22P02`, a connection blip after `waitForPostgres`
 * already succeeded) must NOT be read as "no venue": that would route a database already holding a
 * chain into a spurious re-provision — a second SIF, a second hash chain (CLAUDE.md §5). Those fail
 * loud.
 */
export async function inspectVenues(
  uri: string,
  expectedTenantId: string | null,
): Promise<{ hasExpected: boolean; hasAny: boolean }> {
  const client = new pg.Client({ connectionString: uri });
  try {
    await client.connect();

    // Must run BEFORE the tenants query, and unconditionally: `pg_roles` is a system catalog, always
    // present whether or not the manifest has migrated, so this check itself never hits 42P01 — an
    // unmigrated database still fails closed here if the connection somehow lacked privilege, rather
    // than falling through to the (in that case, coincidentally correct) undefined_table branch below.
    const { rows: privilegeRows } = await client.query<{ privileged: boolean }>(
      "select rolsuper or rolbypassrls as privileged from pg_roles where rolname = current_user",
    );
    if (privilegeRows[0]?.privileged !== true) {
      throw new Error(
        "dev-setup: inspectVenues requires a superuser or BYPASSRLS connection. `tenants` is under " +
          "FORCE ROW LEVEL SECURITY, so a non-privileged connection's exists() check silently returns " +
          "false even when tenants exist — that would defeat the refuse-to-clobber guard `dev:setup` " +
          "and `dev:onboard` rely on to avoid minting a second fiscal chain (CLAUDE.md §5). " +
          "`dev:onboard`/`dev:setup` are meant to run against the local dev container as its " +
          "`postgres` superuser — check DATABASE_URL.",
      );
    }

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
    planVenue({
      country: "ES",
      taxId: "50000000K",
      legalName: "Waitron Dev SL",
      location: {
        name: "Sala principal",
        fiscalTerritory: "ES-common",
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
      },
    }),
    { db },
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

  return ids;
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
export async function devSetup(opts: DevSetupOptions): Promise<DevSetupResult> {
  const { databaseUrl, envPath, log = () => {} } = opts;

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

  // Fresh provision: migrate the full manifest from source (the same sets the server migrates at
  // boot — `boot.ts` uses `migrationOptionsFor(manifestSets(), config.migrationsRoot)`; `null` is
  // the from-source root, resolved to each package's own `drizzle` dir).
  log("dev-setup: migrating…");
  await applyMigrations(databaseUrl, migrationOptionsFor(manifestSets(), null));

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
  return { reused: false, env };
}

/** The name of the till device profile `applyVenue` seeds for the counter till, resolved to the seeded
 * venue's locale (design §10; task-3 follow-on b). `dev:setup` provisions via `applyVenue`, which seeds
 * the whole starter set (Counter/Kitchen/Handheld) from `DEFAULT_DEVICE_PROFILES`, so this is just the
 * `till` entry's locale-resolved name — English "Counter" for the demo default (en-GB), "Mostrador" for
 * an es-ES seed. */
export function tillDeviceProfileName(locale: string): string {
  const till = DEFAULT_DEVICE_PROFILES.find((profile) => profile.formFactor === "till")!;
  return defaultProfileName(till, locale);
}

/**
 * Find the tenant's till device profile and return its id — the profile `applyVenue` seeded at
 * provisioning (task-3 follow-on b: every new tenant gets the Counter/Kitchen/Handheld starter set), so
 * the minted `till` pairing code can carry it and the enrolled counter till resolves its canvas +
 * capabilities through it (design §5.3/§10). Without a bound profile an enrolled device gets
 * `capabilities: []` and the /api/pay + /api/drawer firewall refuses pay/drawer while the render axis
 * hides the capability cards — so the dev till would be unable to sell.
 *
 * Since `dev:setup` provisions through `applyVenue`, the profile already exists on both the fresh and
 * the reuse path; this LOCATES it (by its locale-resolved name) rather than creating it — the seeding
 * moved into provisioning. A missing profile is a provisioning regression, so it throws loudly rather
 * than mint a code with no profile. Runs on the caller's already-tenant-scoped app-role tx.
 */
async function findTillDeviceProfile(
  tx: Transaction,
  tenantId: string,
  locale: string,
): Promise<string> {
  const name = tillDeviceProfileName(locale);
  const profile = (await listDeviceProfiles(tx, tenantId)).find((p) => p.name === name);
  if (profile === undefined) {
    throw new Error(
      `dev-setup: provisioned tenant is missing the seeded "${name}" till device profile — applyVenue should have seeded it`,
    );
  }
  return profile.id;
}

/**
 * Mint a single-use `till`-kind pairing code bound to the provisioned till (SP-A.2 device unification),
 * so the dev can enrol the counter till against the server (its sale routes now require a
 * `waitron_device` cookie carrying the till's id — Task 15a). The code is minted on EVERY `dev:setup`
 * run, fresh venue OR idempotent reuse: a code is single-use and expires in 15 minutes, so a stale
 * unredeemed one simply lapses — always handing the dev a fresh valid code is the point.
 *
 * The minted code carries the tenant's till device profile — the "Counter" (or its locale name) entry
 * `applyVenue` seeded at provisioning (task-3 follow-on b), LOCATED here via `findTillDeviceProfile` —
 * so the enrolled counter till resolves its canvas + capabilities through it and stays sale-capable. The
 * device-profile cutover (Task 10) made the profile the SOLE canvas/capability binding, so a code with
 * no profile would enrol a till the firewall refuses pay/drawer on (design §10).
 *
 * Runs as `app_user` inside a `withTenant` tx, exactly as the device-api enrol-code route does — the
 * running POS mints codes, not the provisioning owner. `generatePairingCode`'s per-kind gate requires a
 * `till` (a sale-capable kind) to carry a non-null `till_id` (else `device.till_required`), so the
 * provisioned till's id is passed; the enrolled device then rings against that real register. The
 * `TillConfig` is assembled from the written `.env` — `generatePairingCode` reads only `tenantId` +
 * `locationId` off it for a `till` mint (no station lookup), but the whole shape is branded for type
 * safety. Returns the plaintext code ONCE for the CLI to print (never stored in plaintext).
 */
export async function mintTillPairingCode(db: Database, env: DevEnv): Promise<{ code: string }> {
  const cfg: TillConfig = {
    tenantId: brandTenantId(env.WAITRON_TILL_TENANT_ID),
    tillId: brandTillId(env.WAITRON_TILL_TILL_ID),
    nodeId: brandNodeId(env.WAITRON_TILL_NODE_ID),
    seriesId: brandSeriesId(env.WAITRON_TILL_SERIES_ID),
    locationId: brandLocationId(env.WAITRON_TILL_LOCATION_ID),
    locale: env.WAITRON_TILL_LOCALE,
    invoiceLocales: [env.WAITRON_TILL_LOCALE],
    // Display-side only; a pairing-code mint reads neither. Fixed to the demo's cash-only defaults.
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const deviceProfileId = await findTillDeviceProfile(tx, cfg.tenantId, cfg.locale);
    return generatePairingCode(tx, cfg, {
      kind: "till",
      stationId: null,
      label: "Caja 1",
      tillId: cfg.tillId,
      deviceProfileId,
    });
  });
}

/** The CLI entrypoint: resolve `apps/server/.env`, run `devSetup`, print a human summary. */
async function main(): Promise<void> {
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));
  const databaseUrl =
    process.env.DATABASE_URL !== undefined && process.env.DATABASE_URL !== ""
      ? process.env.DATABASE_URL
      : DEV_DATABASE_URL;

  const result = await devSetup({
    databaseUrl,
    envPath,
    log: (line) => void console.log(line),
  });

  // Mint a fresh `till` pairing code on EVERY run (fresh venue OR reuse) so the dev can enrol the
  // counter till, whose sale routes now require a device cookie (SP-A.2 Task 15a). Its own connection —
  // `devSetup` has already closed the one it provisioned with — closed in the `finally`.
  const db = await createPostgresDb(result.env.DATABASE_URL);
  let pairing: { code: string };
  try {
    pairing = await mintTillPairingCode(db, result.env);
  } finally {
    await db.close();
  }

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
  console.log(`  Enrol the till at http://localhost:5190 with pairing code: ${pairing.code}`);
  console.log("  (single-use, expires in 15 minutes — re-run `pnpm dev:setup` for a fresh one)");
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
