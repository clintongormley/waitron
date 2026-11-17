import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  KEY_RING_VARIABLES,
  keyRingEnv,
  loadKeyRing,
  readNodeSigningKey,
  sealNodeSigningKeyTx,
} from "@waitron/credentials";
import {
  deploymentEnvironmentFor,
  lockVenueDatabase,
  openVenueDatabase,
  withNodeTransaction,
  type DeploymentEnvironment,
} from "@waitron/db";
import { generateNodeKeyPair } from "@waitron/membership";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { WaitronModule } from "@waitron/module";
import { appendHandoverEventTx, setNodeModeTx } from "@waitron/node-db";
import { generateKeyRing, inTurn } from "@waitron/provisioning";
import { AppError, isAppError } from "@waitron/shared";
import {
  INCOMING_SUFFIX,
  NODE_FILE,
  SCRATCH_DIR,
  SECRETS_ENV_FILE,
  TRADING_ENV_FILE,
  VENUE_FILE,
} from "@waitron/store";
import { keyRingVariables } from "./box-env.js";
import { writeCredentialsRing } from "./box-secrets.js";
import {
  assertEmergencyCopyBindingUnexpired,
  type EmergencyCopyBinding,
} from "./emergency-copy-binding.js";
import { checkPlacedEmergencyCopy, PLACED, readImmutableNodeDb } from "./emergency-copy-check.js";
import { parseEnvFile } from "./env-file.js";
import { errnoOf } from "./errno.js";
import { VENUE_FILE_MODE } from "./restore.js";
import { reachDisk } from "./sync-path.js";
import { writeTradingEnv } from "./trading-config.js";
import "./errors.js";

/** An existing `trading.env`'s variables, or `null` with no file. */
async function keptTradingEnv(stateDir: string): Promise<Record<string, string> | null> {
  let text: string;
  try {
    text = await readFile(join(stateDir, TRADING_ENV_FILE), "utf8");
  } catch (error) {
    if (errnoOf(error) === "ENOENT") return null;
    throw error;
  }
  return parseEnvFile(text);
}

/** Refuses a kept `trading.env` that names another node or environment, or sets a vault key variable. */
function assertKeptTradingEnv(trading: Record<string, string>, binding: EmergencyCopyBinding) {
  if (trading.WAITRON_NODE_ID !== binding.copyNodeId)
    throw new AppError("emergency_copy.trading_node_differs", {});
  if (deploymentEnvironmentFor(trading.WAITRON_ENV) !== binding.environment)
    throw new AppError("emergency_copy.trading_environment_differs", {});
  // Present, not non-empty: `loadBoxEnv` copies an empty file value over `secrets.env`'s too.
  const variables = KEY_RING_VARIABLES.filter((name) => Object.hasOwn(trading, name));
  if (variables.length > 0)
    throw new AppError("emergency_copy.vault_key_in_trading_env", { variables });
}

/** Refuses unless the ring in this state folder's `secrets.env` opens the copy's sealed key. */
async function assertSavedRingOpensKey(stateDir: string, nodePath: string, nodeId: string) {
  let text: string;
  try {
    text = await readFile(join(stateDir, SECRETS_ENV_FILE), "utf8");
  } catch (error) {
    if (errnoOf(error) === "ENOENT") throw new AppError("emergency_copy.placed_key_unopenable", {});
    throw error;
  }
  try {
    const key = await readImmutableNodeDb(nodePath, (node) =>
      readNodeSigningKey(node, loadKeyRing(parseEnvFile(text)), nodeId),
    );
    if (key === null) throw new AppError("emergency_copy.placed_key_unopenable", {});
  } catch (error) {
    if (isAppError(error) && error.code.startsWith("credentials."))
      throw new AppError("emergency_copy.placed_key_unopenable", {});
    throw error;
  }
}

/**
 * Moves the finished `staged` file in as `venueDir`'s `node.db`. The copy goes under another name
 * in `venueDir` first, since the state folder may sit on another filesystem, so a `node.db` there is
 * only ever whole.
 */
async function publishNodeDb(staged: string, venueDir: string): Promise<void> {
  const live = join(venueDir, NODE_FILE);
  const incoming = `${live}${INCOMING_SUFFIX}`;
  try {
    await copyFile(staged, incoming);
    await chmod(incoming, VENUE_FILE_MODE);
    await reachDisk(incoming);
    await rename(incoming, live);
  } catch (error) {
    await rm(incoming, { force: true }).catch(() => {});
    throw error;
  }
  await reachDisk(venueDir);
}

type PlacementDeps = Parameters<typeof placeEmergencyCopy>[0];

/** Overlapping placements in this process share the folder's lock, so they take turns here. */
const placementTurns = {};

/**
 * Makes the venue database Cloud placed in `venueDir` a machine of its own: a `node.db` holding a
 * fresh signing key for `binding.copyNodeId`, sealed on a fresh vault ring saved as this state
 * folder's `secrets.env`, the role `mirror`, and the binding; and `trading.env` naming the copy.
 * `venue.db` is never written.
 */
export async function placeEmergencyCopy(deps: {
  binding: EmergencyCopyBinding;
  venueDir: string;
  stateDir: string;
  environment: DeploymentEnvironment;
  processEnv: Readonly<Record<string, string | undefined>>;
  migrationsRoot: string | null;
  modules: readonly WaitronModule[];
  /** This machine's clock. */
  now: () => Date;
  signal?: AbortSignal;
}): Promise<void> {
  const hold = await lockVenueDatabase(deps.venueDir);
  try {
    await inTurn(placementTurns, await realpath(deps.venueDir), () => placeHeld(deps));
  } finally {
    hold.release();
  }
}

async function placeHeld(deps: PlacementDeps): Promise<void> {
  const { binding } = deps;
  // `loadBoxEnv`, which every start reads the ring through, lets a vault key variable set in this
  // process's environment, or present in `trading.env`, win over `secrets.env`: either way the
  // next start would not read the copy's ring as `secrets.env` holds it.
  const inEnvironment = Object.keys(keyRingVariables(deps.processEnv));
  if (inEnvironment.length > 0)
    throw new AppError("emergency_copy.vault_key_in_environment", { variables: inEnvironment });
  const trading = await keptTradingEnv(deps.stateDir);
  if (trading !== null) assertKeptTradingEnv(trading, binding);
  const placed = await checkPlacedEmergencyCopy({
    binding,
    venuePath: join(deps.venueDir, VENUE_FILE),
    environment: deps.environment,
    migrationsRoot: deps.migrationsRoot,
    modules: deps.modules,
    signal: deps.signal,
  });
  // The binding was in date when it was read, but the checks can take many minutes.
  assertEmergencyCopyBindingUnexpired(binding, deps.now());
  deps.signal?.throwIfAborted();
  // A repeat passes only when the files beside the placed `node.db` already make the copy start
  // as placed.
  if (placed) {
    if (trading === null) throw new AppError("emergency_copy.trading_env_missing", {});
    await assertSavedRingOpensKey(
      deps.stateDir,
      join(deps.venueDir, NODE_FILE),
      binding.copyNodeId,
    );
    return;
  }

  const parent = join(deps.stateDir, SCRATCH_DIR);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(join(parent, "emergency-copy-"));
  try {
    const encoded = generateKeyRing();
    const ring = loadKeyRing(keyRingEnv(encoded));
    await applyMigrations(
      scratch,
      migrationOptionsFor(
        manifestSets().filter((set) => set.database === "node"),
        deps.migrationsRoot,
      ),
    );
    const store = await openVenueDatabase(scratch);
    try {
      await withNodeTransaction(store.node, async (tx) => {
        await sealNodeSigningKeyTx(tx, ring, binding.copyNodeId, generateNodeKeyPair().privateKey);
        await setNodeModeTx(tx, binding.copyNodeId, "mirror", "emergency_copy");
        await appendHandoverEventTx(tx, {
          nodeId: binding.copyNodeId,
          operationId: null,
          kind: PLACED,
          detail: { binding },
          envelope: null,
        });
      });
    } finally {
      await store.close();
    }
    await writeCredentialsRing(deps.stateDir, encoded);
    if (trading === null)
      await writeTradingEnv(deps.stateDir, {
        nodeId: binding.copyNodeId,
        environment: binding.environment,
      });
    // Last, so `venue.db` never sits beside a `node.db` whose key `secrets.env` cannot open.
    await publishNodeDb(join(scratch, NODE_FILE), deps.venueDir);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
