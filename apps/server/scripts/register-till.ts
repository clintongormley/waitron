// The venue path follows the server's resolver; an independent path could activate a database
// the box never serves. Stop the server before running this command: it opens the venue exclusively.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openVenueDatabase } from "@waitron/db";
import type { SeedReport } from "@waitron/module";
import { createFirstSetupCoordinator } from "@waitron/provisioning";
import { locationId as brandLocationId, nodeId as brandNodeId } from "@waitron/shared";
import { ALL_MODULES } from "../src/modules.js";
import { nodeLocation, provisionNode } from "../src/provision-till.js";
import { createNodeOperationPreparation } from "../src/node-operation-preparation.js";
import { resolveConfigDir } from "../src/config.js";
import { readRecoveryOperationFile } from "../src/recovery-module-operation.js";
import { isUnset } from "../src/env-value.js";
import { resolveScriptVenueDir } from "./venue-dir.js";

const USAGE =
  "usage: node apps/server/dist/register-till.js <nodeId> [--confirm-old-box-gone --confirm-sole-recovery]";

/** `store.venue`, not `store.node`: every migration set is applied to the venue file. */
export async function registerTill(
  nodeArg: string,
  env: NodeJS.ProcessEnv,
  context?: { oldNodeNeutralised?: unknown; noParallelRecovery?: unknown },
): Promise<readonly SeedReport[]> {
  const path = env.WAITRON_RECOVERY_OPERATION_FILE;
  const recovery = isUnset(path)
    ? undefined
    : {
        ...(await readRecoveryOperationFile(path)),
        secret: env.WAITRON_NODE_RECOVERY_KEY,
      };
  const venueDir = await resolveScriptVenueDir(env);
  const store = await openVenueDatabase(venueDir);
  try {
    if (recovery !== undefined && context !== undefined) {
      const { DEFAULT_STATE_ROOT } = await import("../src/boot.js");
      const node = {
        nodeId: brandNodeId(nodeArg),
        locationId: brandLocationId(await nodeLocation(store.venue, brandNodeId(nodeArg))),
      };
      const preparation = createNodeOperationPreparation({
        db: store.venue,
        node,
        venueDir,
        stateDir: resolveConfigDir(env.WAITRON_STATE_DIR, DEFAULT_STATE_ROOT),
        modules: ALL_MODULES,
        coordinator: createFirstSetupCoordinator(),
        environment: env,
      });
      return await preparation.withOperation(
        recovery,
        { breakGlass: recovery.secret },
        context,
        async (modules, operations) => {
          const contribution = modules.find(
            (module) => module.name === recovery.binding.module,
          )?.operations;
          const operation = operations.get(recovery.binding.module)!;
          await contribution?.resumeRecovery?.(operation);
          return provisionNode(store.venue, { nodeId: node.nodeId, recovery }, modules);
        },
      );
    }
    return await provisionNode(
      store.venue,
      {
        nodeId: brandNodeId(nodeArg),
        ...(recovery === undefined ? {} : { recovery }),
      },
      ALL_MODULES,
    );
  } finally {
    await store.close();
  }
}

export function registerTillFromArgs(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<readonly SeedReport[]> {
  const [nodeArg, ...flags] = args;
  if (
    nodeArg === undefined ||
    (flags.length !== 0 &&
      !(
        flags.length === 2 &&
        flags.includes("--confirm-old-box-gone") &&
        flags.includes("--confirm-sole-recovery")
      ))
  )
    throw new Error(USAGE);
  return registerTill(
    nodeArg,
    env,
    flags.length === 0 ? undefined : { oldNodeNeutralised: true, noParallelRecovery: true },
  );
}

async function main(): Promise<void> {
  const seeded = await registerTillFromArgs(process.argv.slice(2), process.env);
  for (const s of seeded) console.log(`${s.module}: ${s.report}`);
}

// Importing the command must not activate an identity.
if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  main().catch((error: unknown) => {
    console.error("register-till: failed");
    console.error(error);
    process.exit(1);
  });
}
