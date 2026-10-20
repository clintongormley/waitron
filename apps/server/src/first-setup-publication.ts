import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { openVenueDatabase } from "@waitron/db";
import { loadKeyRing } from "@waitron/credentials";
import { AppError } from "@waitron/shared";
import { loadBoxEnv } from "./box-env.js";
import { loadConfig } from "./config.js";
import { resolveAccountKey } from "./account-key.js";
import { establishNodeIdentity } from "./node-identity.js";
import { seedTermZeroMembership } from "./membership-seed.js";
import { recoverProvisionedVenue } from "./provision.js";
import { writeTradingEnv } from "./trading-config.js";
import { clearStagedConfigurationImport } from "./configuration-import.js";
import type { FirstSetupRoots } from "./first-setup-resolution-inspection.js";
import type { FirstFiscalHost } from "./setup-first-fiscal-api.js";
import type { SetupDeps } from "./setup-api.js";
import "./errors.js";

// The caller holds anchor/target exclusion and the setup coordinator for the entire callback.
export async function withFirstSetupPublication<T>(
  roots: FirstSetupRoots,
  environment: Readonly<Record<string, string | undefined>>,
  host: FirstFiscalHost,
  body: (deps: SetupDeps) => Promise<T>,
): Promise<T> {
  const state = await host.store.read();
  if (state === null || !["activation-started", "committed", "publication"].includes(state.status))
    throw new AppError("setup.attempt_uncertain", {});
  const inspection = await host.resolution.inspectFirstSetupResolution();
  if (inspection.pair !== "valid" || inspection.database !== "occupied")
    throw new AppError("setup.attempt_uncertain", {});
  const file = await lstat(join(roots.venueDir, "venue.db")).catch(() => null);
  if (file === null || !file.isFile() || file.isSymbolicLink())
    throw new AppError("setup.attempt_uncertain", {});
  const nodeFile = await lstat(join(roots.venueDir, "node.db")).catch((error: unknown) => {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw new AppError("setup.attempt_uncertain", {});
    return null;
  });
  if (nodeFile !== null && (!nodeFile.isFile() || nodeFile.isSymbolicLink()))
    throw new AppError("setup.attempt_uncertain", {});
  const env = await loadBoxEnv({ ...environment }, roots.stateDir);
  const config = loadConfig(
    { ...env, WAITRON_STATE_DIR: roots.stateDir, WAITRON_VENUE_DIR: roots.venueDir },
    roots.stateDir,
    roots.stateDir,
  );
  if (config.environment !== state.frozen.environment)
    throw new AppError("setup.attempt_conflict", {});
  const ring = loadKeyRing(env);
  const accountKey = resolveAccountKey({}, ring);
  const opened = await openVenueDatabase(roots.venueDir);
  try {
    const db = opened.venue;
    return await body({
      environment: state.frozen.environment,
      devMode: config.devMode,
      db,
      ring,
      recoverProvision: (request) => recoverProvisionedVenue(db, request, host.modules),
      establishIdentity: (nodeId) => establishNodeIdentity({ ownerDb: db, ring }, nodeId),
      seedMembership: (nodeId) =>
        seedTermZeroMembership({ db, ring }, nodeId, config.advertisedOrigin),
      persistTrading: async (settings) => {
        await writeTradingEnv(roots.stateDir, {
          ...settings,
          accountKey: accountKey.toString("base64"),
        });
      },
      clearConfiguration: () => clearStagedConfigurationImport(roots.stateDir),
    });
  } finally {
    await opened.close();
  }
}
