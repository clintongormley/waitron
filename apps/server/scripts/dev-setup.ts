// Idempotent local-dev bootstrap: provision ONE preproduction venue into a local venue DIRECTORY and
// persist its identity to `apps/server/.env`, so `pnpm dev` boots the server against a real,
// migrated, seeded venue. It provisions, seeds, writes the ids down, and carries a reuse guard that
// never re-provisions a live dev venue.
//
// The generated `.env` carries `WAITRON_ENV=dev` (SP-C), so `pnpm dev` boots with the dev per-tab
// device switcher ON (`config.devMode`, Task 1). This does NOT touch the fiscal side: `dev` is a
// dev-only input that `deploymentEnvironment` (apps/server/src/config.ts) maps to `preproduction` —
// same AEAT endpoints, same Stripe mode, same per-record `entorno` — so the venue this script
// provisions still BEHAVES AS `preproduction` throughout. Note this is a runtime mapping, not a
// stored stamp: `devSetup` here never calls `stampDeployment` at all (unlike the `/setup-api/provision`
// HTTP route), so the database's `deployment` singleton is left UNSTAMPED by this flow, and
// `assertDeploymentMatches` (boot.ts) treats an unstamped database as matching any host environment.
//
// FISCAL NOTE (CLAUDE.md §5): re-registering a till starts a NEW hash chain and mints a fresh
// installation number. So this REUSES an already-provisioned venue (an existing `.env` naming a
// till the venue still holds) and REFUSES to provision when the venue directory already holds a
// venue this `.env` cannot account for — it never mints a second one into a live database. The only
// sanctioned "start over" is `pnpm dev:reset`, which REMOVES the venue directory (throwaway
// preproduction data); nothing else here deletes data.
//
// Run from the repo root via `pnpm dev:setup`; it opens the venue directory, migrates it and
// provisions. Never against a production directory — it creates a tenant and chains real fiscal
// records under `preproduction`.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { openVenueDatabase, tills, withTransaction, type Database } from "@waitron/db";
import { hashPassword, hashPin } from "@waitron/identity";
import { listDeviceProfiles } from "@waitron/layouts";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { parseModuleConfig } from "@waitron/module";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
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

/**
 * The venue directory a dev box uses when nothing names one: the same `<stateDir>/venue` default
 * `apps/server/src/config.ts` resolves. Named here as a function of the state dir rather than as a
 * constant path, because the state dir is itself resolved per run (`WAITRON_STATE_DIR`), and the
 * tool and the server have to agree on ONE directory — a second spelling stands a venue up
 * somewhere the server never opens. Pure.
 */
export function defaultDevVenueDir(stateDir: string): string {
  return join(stateDir, "venue");
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
  WAITRON_VENUE_DIR: string;
  WAITRON_ENV: string;
  WAITRON_ONBOARDING_INTENT: string;
  WAITRON_HTTP_PORT: string;
  WAITRON_CREDENTIALS_KEY: string;
  WAITRON_CREDENTIALS_KEY_VERSION: string;
  WAITRON_TILL_TILL_ID: string;
  WAITRON_TILL_NODE_ID: string;
  WAITRON_TILL_SERIES_ID: string;
  WAITRON_TILL_LOCATION_ID: string;
  WAITRON_TILL_LOCALE: string;
}

/** Ordered so `renderEnvFile` emits a stable, reviewable `.env`. */
const ENV_KEYS: readonly (keyof DevEnv)[] = [
  "WAITRON_VENUE_DIR",
  "WAITRON_ENV",
  "WAITRON_ONBOARDING_INTENT",
  "WAITRON_HTTP_PORT",
  "WAITRON_CREDENTIALS_KEY",
  "WAITRON_CREDENTIALS_KEY_VERSION",
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
  /** The venue directory to migrate and provision into, and to write as `WAITRON_VENUE_DIR`. */
  venueDir: string;
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

/** The four fiscal ids `provisionVenue` returns, in the shape `buildDevEnv` maps to the env contract. */
export interface DevVenueIds {
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
  venueDir: string;
  credentialsKey: string;
  ids: DevVenueIds;
  seedLocale: SeedLocale;
}): DevEnv {
  const { venueDir, credentialsKey, ids, seedLocale } = input;
  return {
    WAITRON_VENUE_DIR: venueDir,
    WAITRON_ENV: "dev",
    WAITRON_ONBOARDING_INTENT: "demo",
    WAITRON_HTTP_PORT: "8080",
    WAITRON_CREDENTIALS_KEY: credentialsKey,
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
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

/**
 * Read whether the venue directory contains the till this `.env` names, and whether it holds a venue
 * at all. The taxpayer row is the "any venue" signal because provisioning always writes it; the till
 * is what the `.env` can still name now that there is no tenant id to name.
 *
 * **A virgin directory OPENS** — `openVenueStore` creates it — so "there is no venue here" cannot be
 * an open failure. It is the absence of the two TABLES, read off `sqlite_master` the way
 * `packages/db/src/deployment.ts` reads its own, and that is what lets a fresh laptop fall through
 * to the migrate rather than refuse. Probing, rather than running the select and catching the
 * refusal, is also what keeps the other half honest: every other failure propagates, so a read this
 * function could not complete never reports "empty" and never lets a second venue be provisioned
 * over a live one (CLAUDE.md §5).
 */
export async function inspectVenues(
  venueDir: string,
  expectedTillId: string | null,
): Promise<{ hasExpected: boolean; hasAny: boolean }> {
  const store = await openVenueDatabase(venueDir);
  try {
    const present = await store.venue.execute<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name in (${"tills"}, ${"tenants"})`,
    );
    if (present.rows.length < 2) return { hasExpected: false, hasAny: false };

    // `exists(...)` answers 0 or 1 on this engine, not a boolean, so each is compared rather than
    // returned: handing a caller `0` where it expects `false` would make every `if` read true.
    const { rows } = await store.venue.execute<{ has_expected: number; has_any: number }>(
      sql`select exists(select 1 from tills where id = ${expectedTillId}) as has_expected,
                 exists(select 1 from tenants) as has_any`,
    );
    return { hasExpected: rows[0]?.has_expected === 1, hasAny: rows[0]?.has_any === 1 };
  } finally {
    await store.close();
  }
}

/** Provision one preproduction venue + SIF, then seed the full demo restaurant (three menus, floor,
 * staff, media, and `salesDays` of back-dated preproduction sales) via `seedDemoRestaurant`. Returns
 * the four fiscal ids the server boots against. The bare `seedLocale` drives every seeded string; the
 * full tag it maps to (`SEED_INVOICE_LOCALE`) drives the location's `invoiceLocales`; `salesDays` is
 * the historical-sales horizon (0 skips sales). */
async function provisionVenue(
  db: Database,
  seedLocale: SeedLocale,
  salesDays: number,
): Promise<{
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
  // ordinary sale's series.
  const ids = {
    tillId: venue.tillId,
    nodeId: venue.nodeId,
    seriesId: venue.seriesIds[0]!,
    locationId: venue.locationId,
  };

  // Stand up the whole demo restaurant on the fresh venue: catalogues/floor/staff/media in one
  // transaction, then the back-dated preproduction sales (its own per-sale tx). This replaces
  // the former inline "Delicatessen + one Cajera" stub — the demo now seeds real menus and staff.
  await seedDemoRestaurant(db, { venue: ids, locale: seedLocale, salesDays });

  // Enrol the three demo devices through the SHIPPING enrol path — after the demo restaurant seeds
  // its default preparation station and bars (the KDS binds the default).
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
 *    `tills (location, name)` unique index → `device.register_name_taken`;
 *  - the HANDHELD binds to the counter till device's OWN register ("Mostrador") — the deli shape where
 *    the waiter's phone rings into the same drawer as the counter, adding no third register;
 *  - the KITCHEN display binds to the venue's default preparation station. The demo may rename that
 *    station, so the stable `isDefault` identity is used rather than presentation text.
 */
async function seedDemoDevices(
  db: Database,
  ids: DevVenueIds,
  seedLocale: SeedLocale,
): Promise<void> {
  // The enrol verbs are typed `cfg: TillConfig`; they read only `locationId` (and the join
  // request carries the venue), so the sale-side fields carry inert-but-valid placeholders (no card,
  // no tips, `prepay`) — the enrol path never persists them.
  const cfg: TillConfig = {
    tillId: brandTillId(ids.tillId),
    nodeId: brandNodeId(ids.nodeId),
    seriesId: brandSeriesId(ids.seriesId),
    locationId: brandLocationId(ids.locationId),
    locale: SEED_INVOICE_LOCALE[seedLocale],
    invoiceLocales: [SEED_INVOICE_LOCALE[seedLocale]],
    tipsEnabled: false,
    orderFlow: "prepay",
  };

  // The profiles + stations the devices bind to — provisioning seeds one profile per form factor
  // (till/kds/phone-portrait) and one default preparation station.
  const { profiles, stations } = await withTransaction(db, async (tx) => {
    return {
      profiles: await listDeviceProfiles(tx),
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
  const kitchen = stations.find((station) => station.isDefault);
  if (kitchen === undefined) {
    throw new Error("dev-setup: no default preparation station to bind the kitchen display to");
  }

  // 1. Till — auto-creates its register "Mostrador".
  await enrolDeviceForTest(db, cfg, { name: "Mostrador", profileId: profileFor("till") });

  // The register the till device just minted, re-read fresh — `enrolDeviceForTest` returns the
  // device, not its register, and the counter's register is the one the handheld rings into.
  const counter = (
    await withTransaction(db, async (tx) => {
      return tx
        .select({ id: tills.id })
        .from(tills)
        .where(and(eq(tills.locationId, cfg.locationId), eq(tills.name, "Mostrador")));
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

  // 3. Kitchen display — bound to the venue's default preparation station.
  await enrolDeviceForTest(db, cfg, {
    name: "Pantalla Cocina",
    profileId: profileFor("kds"),
    stationId: kitchen.id,
  });
}

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
 * The idempotent bootstrap, with a fiscal safety property: it provisions a venue ONLY into a venue
 * directory that holds none. Three cases (CLAUDE.md §5 — a second venue is a second SIF and a second
 * hash chain):
 *
 *  - the `.env` names a till the venue still holds → REUSE it, provision nothing;
 *  - the venue already holds a venue the `.env` does NOT name (a lost/stale/mismatched `.env`
 *    against a live directory) → REFUSE, directing the operator to `pnpm dev:reset`;
 *  - the directory holds no venue (first run, or a freshly removed one) → migrate, provision one
 *    preproduction venue, seed it, and write the `.env`.
 *
 * The only sanctioned "start over" is `pnpm dev:reset`, which removes the venue directory (throwaway
 * preproduction data); this function never deletes data itself.
 */
export async function devSetup(opts: DevSetupOptions): Promise<DevSetupResult> {
  const { venueDir, envPath, stateDir, log = () => {} } = opts;

  // Read the existing `.env` (if any) and ask the venue directory whether it holds the till that
  // `.env` names and whether it holds any venue at all.
  const existing = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, "utf8")) : undefined;
  const expectedTillId =
    existing !== undefined && isCompleteDevEnv(existing) ? existing.WAITRON_TILL_TILL_ID : null;
  const { hasExpected, hasAny } = await inspectVenues(venueDir, expectedTillId);

  // Reuse: the `.env` names a venue the directory still holds.
  if (existing !== undefined && isCompleteDevEnv(existing) && hasExpected) {
    log("dev-setup: reusing the already-provisioned venue (no new fiscal chain)");
    // Still (re)write the fiscal-slot modules.json: a dev venue provisioned before this file wrote one
    // has no modules.json, and without it the reused venue's next boot would refuse fiscal_slot_ambiguous.
    await writeFiscalModulesJson(stateDir, log);
    return { reused: true, env: existing };
  }

  // Refuse: the directory already holds a venue this `.env` cannot account for. Provisioning would
  // start a second fiscal chain, so fail loud rather than do it (CLAUDE.md §5).
  if (hasAny) {
    throw new Error(
      "dev-setup: the venue directory already holds a venue, but this apps/server/.env does not name " +
        "it (missing, stale, or mismatched). Refusing to provision a second venue — it would start a " +
        "new fiscal chain. Run `pnpm dev:reset` to remove the venue directory and re-provision from " +
        "scratch.",
    );
  }

  // Fresh provision: migrate the full manifest from source (the same sets the server migrates at
  // boot — `boot.ts` uses `migrationOptionsFor(manifestSets(), config.migrationsRoot)`; `null` is
  // the from-source root, resolved to each package's own `drizzle` dir).
  log("dev-setup: migrating…");
  await applyMigrations(venueDir, migrationOptionsFor(manifestSets(), null));

  // Resolve the seed shape ONCE per run: the locale (English default, Spanish via WAITRON_SEED_LOCALE)
  // and the historical-sales horizon (WAITRON_SEED_SALES_DAYS, default 28; 0 skips sales entirely).
  const seedLocale = resolveSeedLocale();
  const salesDays = resolveSalesDays();

  const store = await openVenueDatabase(venueDir);
  let ids;
  try {
    log("dev-setup: provisioning a preproduction venue + seeding the demo restaurant…");
    ids = await provisionVenue(store.venue, seedLocale, salesDays);
  } finally {
    await store.close();
  }

  const env = buildDevEnv({
    venueDir,
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

/**
 * Remove the dev venue directory, so the next run provisions from scratch.
 *
 * This is the whole of `pnpm dev:reset`'s wipe: the throwaway preproduction data lives in this
 * directory and nowhere else. Without it, `devSetup` meets its own "already holds a venue" refusal
 * forever and the developer has no sanctioned way to start over.
 *
 * `rm -rf` of the whole directory rather than of `venue.db`: the engine keeps write-ahead sidecars
 * beside each file, and a venue file removed while its `-wal` stays behind is the shape
 * `packages/db`'s restore surgery measured as a SILENT wrong answer (the reopen returns the old
 * tail). `force` so a first-ever run, with no directory yet, is a no-op rather than an `ENOENT`.
 */
export function resetVenueDir(venueDir: string): void {
  rmSync(venueDir, { recursive: true, force: true });
}

/**
 * The CLI entrypoint: resolve `apps/server/.env` and the venue directory, run `devSetup`, print a
 * human summary. `--reset` removes the venue directory first — see {@link resetVenueDir}.
 */
async function main(): Promise<void> {
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));

  // Resolve the state dir EXACTLY as boot does (`WAITRON_STATE_DIR` else `DEFAULT_STATE_ROOT`), so the
  // fiscal-slot modules.json lands where `pnpm dev` will read it. `DEFAULT_STATE_ROOT` is imported
  // dynamically so importing this module in tests does not pull the whole `boot.ts` graph.
  const { DEFAULT_STATE_ROOT } = await import("../src/boot.js");
  const stateDir = resolveConfigDir(process.env.WAITRON_STATE_DIR, DEFAULT_STATE_ROOT);
  // And the venue dir exactly as `config.ts` does, off that same state dir — so the directory this
  // run provisions is the one `pnpm dev` opens, by construction rather than by two settings agreeing.
  const venueDir = resolveConfigDir(process.env.WAITRON_VENUE_DIR, defaultDevVenueDir(stateDir));

  if (process.argv.includes("--reset")) {
    resetVenueDir(venueDir);
    console.log(`dev-setup: removed ${venueDir}`);
  }

  const result = await devSetup({
    venueDir,
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
  console.log("  server     localhost:8080   (HTTP fresh; HTTPS with a preserved box leaf)");
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
