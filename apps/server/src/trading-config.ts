import { join } from "node:path";
import { rm } from "node:fs/promises";
import { writeFileAtomic } from "./fs-atomic.js";
import { formatEnvFile } from "./env-file.js";

/** Why this fresh primary was created. Demo and Prepare share the preproduction fiscal environment,
 * but only Demo receives sample content. */
export type OnboardingIntent = "demo" | "prepare" | "live";

/**
 * The provisioned identity of a single till, written out as the env the supervisor sources on the
 * next boot so the box enters TRADING mode.
 *
 * Nothing here names the venue directory: boot derives it from the state root, and an absolute path
 * written here would pin one that a moved state root could not correct.
 */
export interface TradingConfig {
  tillId: string;
  nodeId: string;
  seriesId: string;
  locationId: string;
  environment: "production" | "preproduction";
  /** Persist WAITRON_ENV=dev while exercising a Live-shaped onboarding in development. */
  developmentMode?: boolean;
  /** Absent for a mirror or a restored configuration which did not create a fresh primary. */
  onboardingIntent?: OnboardingIntent;
  /** Venue-wide account key, shared with mirrors while each node keeps its own vault key. */
  accountKey?: string;
}

/** Atomically write `<stateDir>/trading.env` (0600). Returns the path written. */
export async function writeTradingEnv(stateDir: string, cfg: TradingConfig): Promise<string> {
  const path = join(stateDir, "trading.env");
  const body = formatEnvFile({
    WAITRON_TILL_TILL_ID: cfg.tillId,
    WAITRON_TILL_NODE_ID: cfg.nodeId,
    WAITRON_TILL_SERIES_ID: cfg.seriesId,
    WAITRON_TILL_LOCATION_ID: cfg.locationId,
    WAITRON_ENV: cfg.developmentMode === true ? "dev" : cfg.environment,
    ...(cfg.onboardingIntent === undefined
      ? {}
      : { WAITRON_ONBOARDING_INTENT: cfg.onboardingIntent }),
    ...(cfg.accountKey === undefined ? {} : { WAITRON_ACCOUNT_KEY: cfg.accountKey }),
  });
  await writeFileAtomic(path, body, 0o600);
  return path;
}

/** Remove `<stateDir>/trading.env` so the next boot comes up in SETUP mode. */
export async function clearTradingEnv(stateDir: string): Promise<void> {
  await rm(join(stateDir, "trading.env"), { force: true });
}
