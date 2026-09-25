// Idempotent local-dev bootstrap: provision ONE preproduction venue into a local venue directory and
// write its identity to `apps/server/.env`. Run from the repo root via `pnpm dev:setup`; never
// against a production directory — it chains real fiscal records under `preproduction`, and it
// refuses `WAITRON_ENV=production` before touching the directory.
//
// The `.env` carries `WAITRON_ENV=dev`, which `deploymentEnvironment` (src/config.ts) maps to
// `preproduction`: the dev device switcher turns on, the fiscal side does not change. Note this is a
// runtime mapping, not a stored stamp: `devSetup` here never calls `stampDeployment` at all (unlike
// the `/setup-api/provision` HTTP route), so the database's `deployment` singleton is left UNSTAMPED
// by this flow, and `assertDeploymentMatches` (`src/deployment-guard.ts`) treats an unstamped
// database as matching any host environment.
//
// Re-registering a till starts a new hash chain (CLAUDE.md §5), so this reuses a venue the `.env`
// names and refuses when the directory holds one it cannot account for. The only "start over" is
// `pnpm dev:reset`, which removes the venue directory.
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
import { demoSeedEnvironment } from "./demo-seed/seed-sales.js";
import { DEMO_ADMIN_EMAIL, DEMO_DASHBOARD_PASSWORD } from "./demo-seed/staff.js";
import { SEED_INVOICE_LOCALE, type SeedLocale } from "./demo-seed/menu.js";

export { parseEnvFile };

/**
 * The venue directory a dev box uses when nothing names one: the same `<stateDir>/venue` default
 * `apps/server/src/config.ts` resolves. The tool and the server must agree on ONE directory, or a
 * venue is stood up somewhere the server never opens.
 */
export function defaultDevVenueDir(stateDir: string): string {
  return join(stateDir, "venue");
}

/** Named once so the venue plan and the fiscal-slot `modules.json` select the same regime, and boot
 * does not refuse `module.fiscal_slot_ambiguous`. */
export const DEV_VENUE_TERRITORY = "ES-common";

/** The one demo PIN, shared by the provisioned admin and every seeded staff member. */
export const ADMIN_PIN = "5555";
const ADMIN_PASSWORD = DEMO_DASHBOARD_PASSWORD;

/**
 * The demo's bare content locale: English unless `WAITRON_SEED_LOCALE=es-ES`. Read at call time so a
 * one-shot `WAITRON_SEED_LOCALE=es-ES pnpm dev:reset` takes effect.
 */
export function resolveSeedLocale(): SeedLocale {
  return process.env.WAITRON_SEED_LOCALE === "es-ES" ? "es" : "en";
}

/**
 * Days of back-dated preproduction sales (`WAITRON_SEED_SALES_DAYS`, default 28, 0 skips sales). A
 * non-numeric value falls back to the default rather than propagating `NaN`.
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

export function renderEnvFileLines<K extends string>(
  header: string,
  keys: readonly K[],
  env: Record<K, string>,
): string {
  const lines = keys.map((key) => `${key}=${env[key]}`);
  return [header, ...lines].join("\n") + "\n";
}

export function renderEnvFile(env: DevEnv): string {
  const header =
    "# Generated by `pnpm dev:setup` — do not edit by hand. Regenerate: `pnpm dev:reset`.";
  return renderEnvFileLines(header, ENV_KEYS, env);
}

export interface DevSetupOptions {
  venueDir: string;
  envPath: string;
  /** Must be the same dir the server resolves at boot, or boot never reads the fiscal-slot
   * `modules.json` written here. */
  stateDir: string;
  log?: (line: string) => void;
}

export interface DevSetupResult {
  /** True when an already-provisioned venue was reused (no new fiscal chain). */
  reused: boolean;
  env: DevEnv;
}

export interface DevVenueIds {
  tillId: string;
  nodeId: string;
  seriesId: string;
  locationId: string;
}

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

function isCompleteDevEnv(rec: Record<string, string>): rec is Record<string, string> & DevEnv {
  return ENV_KEYS.every((key) => {
    const value = rec[key];
    return value !== undefined && value !== "";
  });
}

/**
 * Whether the venue directory holds the till this `.env` names, and whether it holds a venue at all
 * (the taxpayer row, which provisioning always writes).
 *
 * A virgin directory opens, so "no venue" is the absence of the tables, probed rather than caught:
 * every other failure propagates, so an incomplete read never reports "empty" and never lets a
 * second venue be provisioned over a live one (CLAUDE.md §5).
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

  await seedDemoRestaurant(db, { venue: ids, locale: seedLocale, salesDays });

  // After the seed: the kitchen display binds the default preparation station it creates.
  await seedDemoDevices(db, ids, seedLocale);

  return ids;
}

/**
 * Enrol a till, a handheld and a kitchen display through `enrolDeviceForTest`, which bypasses the
 * pairing window and number match, so `?dev`'s chooser lists them on first run. Each device is its own
 * transaction: a failure partway leaves the earlier devices enrolled.
 *
 * The till auto-creates a register named after the device, so it is "Mostrador", not "Caja 1" (which
 * provisioning already made and would be refused `device.register_name_taken`). The handheld rings
 * into that same register. The kitchen display binds the default station by `isDefault`, since the
 * demo may rename it.
 */
async function seedDemoDevices(
  db: Database,
  ids: DevVenueIds,
  seedLocale: SeedLocale,
): Promise<void> {
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

  await enrolDeviceForTest(db, cfg, { name: "Mostrador", profileId: profileFor("till") });

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

  await enrolDeviceForTest(db, cfg, {
    name: "Camarero 1",
    profileId: profileFor("phone-portrait"),
    registerId: counter.id,
  });

  await enrolDeviceForTest(db, cfg, {
    name: "Pantalla Cocina",
    profileId: profileFor("kds"),
    stationId: kitchen.id,
  });
}

/**
 * Write the fiscal-slot `modules.json` so boot resolves the slot to one member: with no file, every
 * fiscal-slot member is on and boot refuses `module.fiscal_slot_ambiguous`. `mkdirSync` first because
 * `writeFileAtomic` does not create the parent dir.
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
 * Provisions a venue ONLY into a directory that holds none — a second venue is a second SIF and a
 * second hash chain (CLAUDE.md §5). Reuses the venue the `.env` names; refuses a venue it does not
 * name; never deletes data itself.
 */
export async function devSetup(opts: DevSetupOptions): Promise<DevSetupResult> {
  const { venueDir, envPath, stateDir, log = () => {} } = opts;

  // Before the directory is read or migrated: the seed's own guard fires only after `applyVenue`
  // has committed, which leaves a directory only `pnpm dev:reset` recovers.
  demoSeedEnvironment(process.env);

  const existing = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, "utf8")) : undefined;
  const expectedTillId =
    existing !== undefined && isCompleteDevEnv(existing) ? existing.WAITRON_TILL_TILL_ID : null;
  const { hasExpected, hasAny } = await inspectVenues(venueDir, expectedTillId);

  if (existing !== undefined && isCompleteDevEnv(existing) && hasExpected) {
    log("dev-setup: reusing the already-provisioned venue (no new fiscal chain)");
    await writeFiscalModulesJson(stateDir, log);
    return { reused: true, env: existing };
  }

  if (hasAny) {
    throw new Error(
      "dev-setup: the venue directory already holds a venue, but this apps/server/.env does not name " +
        "it (missing, stale, or mismatched). Refusing to provision a second venue — it would start a " +
        "new fiscal chain. Run `pnpm dev:reset` to remove the venue directory and re-provision from " +
        "scratch.",
    );
  }

  // `null` migrates from source: each package's own `drizzle` dir.
  log("dev-setup: migrating…");
  await applyMigrations(venueDir, migrationOptionsFor(manifestSets(), null));

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
  await writeFiscalModulesJson(stateDir, log);
  return { reused: false, env };
}

/**
 * `pnpm dev:reset`'s whole wipe. The whole directory rather than `venue.db`, because the engine keeps
 * write-ahead sidecars beside each file and a file removed without its `-wal` reopens wrong.
 */
export function resetVenueDir(venueDir: string): void {
  rmSync(venueDir, { recursive: true, force: true });
}

/** `--reset` removes the venue directory first. */
async function main(): Promise<void> {
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));

  // Resolved exactly as boot does. Imported dynamically so a test importing this module does not
  // pull the whole `boot.ts` graph.
  const { DEFAULT_STATE_ROOT } = await import("../src/boot.js");
  const stateDir = resolveConfigDir(process.env.WAITRON_STATE_DIR, DEFAULT_STATE_ROOT);
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
  // A provisioned box boots in trading mode, which mounts no `/setup-api` route, so the wizard `pnpm
  // dev` starts does nothing.
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

// Run only when invoked directly, never when imported by a test.
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
