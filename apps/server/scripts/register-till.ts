// Runs every module's per-node provisioning seed for one existing node, then exits — for the fiscal
// module, registering the node as a Veri*Factu SIF. The logic lives in `src/provision-till.ts`.
//
// The venue directory is not an argument: it is resolved as the server resolves it
// (`scripts/venue-dir.ts`). A script that took a path instead could write a fiscal record into a
// database nothing on the box ever reads.
//
// Usage — build first, for the reason `record-one-sale.ts`'s header records:
//   pnpm --filter @waitron/server build
//   node apps/server/dist/register-till.js <nodeId>
// Stop the server first: while another process holds the venue folder, this is refused with
// provisioning.database_in_use.
//
// Re-running this against a registered node closes its previous chain, so do not run it to "check"
// anything.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openVenueDatabase } from "@waitron/db";
import type { SeedReport } from "@waitron/module";
import { nodeId as brandNodeId } from "@waitron/shared";
import { ALL_MODULES } from "../src/modules.js";
import { provisionNode } from "../src/provision-till.js";
import { resolveScriptVenueDir } from "./venue-dir.js";

function usageError(message: string): never {
  console.error(`register-till: ${message}`);
  console.error("usage: node apps/server/dist/register-till.js <nodeId>");
  process.exit(1);
}

/** `store.venue`, not `store.node`: every migration set is applied to the venue file. */
export async function registerTill(
  nodeArg: string,
  env: NodeJS.ProcessEnv,
): Promise<readonly SeedReport[]> {
  const store = await openVenueDatabase(await resolveScriptVenueDir(env));
  try {
    return await provisionNode(store.venue, { nodeId: brandNodeId(nodeArg) }, ALL_MODULES);
  } finally {
    await store.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    usageError(`expected 1 argument, got ${args.length}`);
  }
  const [nodeArg] = args;

  const seeded = await registerTill(nodeArg, process.env);
  for (const s of seeded) console.log(`${s.module}: ${s.report}`);
}

// Run only when invoked directly: `registerTill` starts a new hash chain (CLAUDE.md §5).
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
