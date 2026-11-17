import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { asc, eq, sql } from "drizzle-orm";
import { encodeKeyRing, loadKeyRing, sealNodeSigningKeyTx } from "@waitron/credentials";
import {
  lockVenueDatabase,
  openVenueDatabase,
  withNodeTransaction,
  type DeploymentEnvironment,
  type NodeDatabase,
  type NodeTransaction,
} from "@waitron/db";
import { generateNodeKeyPair } from "@waitron/membership";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { WaitronModule } from "@waitron/module";
import { appendHandoverEventTx, nodeHandoverEvents, setNodeModeTx } from "@waitron/node-db";
import { generateKeyRing } from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import { NODE_FILE, SCRATCH_DIR, TRADING_ENV_FILE, VENUE_FILE } from "@waitron/store";
import { keyRingVariables } from "./box-env.js";
import { writeCredentialsRing } from "./box-secrets.js";
import type { EmergencyCopyBinding } from "./emergency-copy-binding.js";
import { checkPlacedEmergencyCopy } from "./emergency-copy-check.js";
import { parseEnvFile } from "./env-file.js";
import { errnoOf } from "./errno.js";
import { reachDisk } from "./sync-path.js";
import { writeTradingEnv } from "./trading-config.js";
import "./errors.js";

const PLACED = "emergency_copy.placed";

/** The node id an existing `trading.env` names, `""` when it names none, or `null` with no file. */
async function configuredNodeId(stateDir: string): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(join(stateDir, TRADING_ENV_FILE), "utf8");
  } catch (error) {
    if (errnoOf(error) === "ENOENT") return null;
    throw error;
  }
  return parseEnvFile(text).WAITRON_NODE_ID ?? "";
}

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
  signal?: AbortSignal;
}): Promise<void> {
  const { binding } = deps;
  const hold = await lockVenueDatabase(deps.venueDir);
  try {
    // `loadBoxEnv`, which every start reads the ring through, lets each of these win over
    // `secrets.env`, so the next start would not read the ring saved below as it was written.
    const inEnvironment = Object.keys(keyRingVariables(deps.processEnv));
    if (inEnvironment.length > 0)
      throw new AppError("emergency_copy.vault_key_in_environment", { variables: inEnvironment });
    const configured = await configuredNodeId(deps.stateDir);
    if (configured !== null && configured !== binding.copyNodeId)
      throw new AppError("emergency_copy.trading_node_differs", {});
    await checkPlacedEmergencyCopy({
      binding,
      venuePath: join(deps.venueDir, VENUE_FILE),
      environment: deps.environment,
      migrationsRoot: deps.migrationsRoot,
      modules: deps.modules,
      signal: deps.signal,
    });

    const parent = join(deps.stateDir, SCRATCH_DIR);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const scratch = await mkdtemp(join(parent, "emergency-copy-"));
    try {
      const generated = generateKeyRing();
      const ring = loadKeyRing({
        WAITRON_CREDENTIALS_KEY: generated.key,
        WAITRON_CREDENTIALS_KEY_VERSION: String(generated.version),
      });
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
          await sealNodeSigningKeyTx(
            tx,
            ring,
            binding.copyNodeId,
            generateNodeKeyPair().privateKey,
          );
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
      await writeCredentialsRing(deps.stateDir, encodeKeyRing(ring));
      if (configured === null)
        await writeTradingEnv(deps.stateDir, {
          nodeId: binding.copyNodeId,
          environment: binding.environment,
        });
      // Last, so `venue.db` never sits beside a `node.db` that is not whole.
      const staged = join(scratch, NODE_FILE);
      await reachDisk(staged);
      await rename(staged, join(deps.venueDir, NODE_FILE));
      await reachDisk(deps.venueDir);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  } finally {
    hold.release();
  }
}

/** The binding a placed emergency copy recorded, or `null` when this `node.db` holds none. */
export async function readPlacedEmergencyCopy(
  node: NodeDatabase | NodeTransaction,
): Promise<EmergencyCopyBinding | null> {
  const [row] = await node
    .select({ detail: nodeHandoverEvents.detail })
    .from(nodeHandoverEvents)
    .where(eq(nodeHandoverEvents.kind, PLACED))
    .orderBy(asc(sql`rowid`))
    .limit(1);
  return (row?.detail.binding as EmergencyCopyBinding | undefined) ?? null;
}
