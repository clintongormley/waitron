// Runs every module's per-node provisioning seed for one existing NODE, then exits — for the fiscal
// module that means registering the node as a Veri*Factu SIF (the SIF is the compute node, not the
// till). `waitron-provision venue` seeds a fresh venue's first node as it stands the venue up, so
// this script is the STANDALONE path: a node with no fiscal identity — against which `recordSale`
// refuses with `sif.not_registered` — or a reimaged node getting a fresh chain (see the note below).
//
// A shim: everything beyond reading argv and opening the venue lives in `src/provision-till.ts`,
// whose header explains why it is there and what it guarantees.
//
// The venue is a DIRECTORY of two SQLite files, not a connection string. Which directory is not an
// argument: it comes from `WAITRON_VENUE_DIR`, else `venue` under `WAITRON_STATE_DIR`, else the
// bundle's own default state root — the same three steps, through the same resolver, that the
// server beside it uses to pick the directory it serves (`scripts/venue-dir.ts`). A script that
// took a path instead could write a fiscal record into a database nothing on the box ever reads.
//
// Usage — build first, exactly like `dist/server.js`, for the reason `record-one-sale.ts`'s header
// records:
//   pnpm --filter @waitron/server build
//   node apps/server/dist/register-till.js <nodeId>
// Stop the server first: while another process (usually the server) holds the venue folder, this
// is refused with provisioning.database_in_use.
//
// Re-running this against an already-registered node is how a REIMAGED node is re-provisioned. It
// closes the previous chain either way, so do not run it to "check" anything.
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

/**
 * Open the venue directory `env` names, run every module's per-node seed for `nodeArg`, and close
 * both files. Exported so a test can run the whole thing — the argv shim below adds nothing but the
 * arity check and stdout.
 *
 * `store.venue` is the handle, not `store.node`: every migration set is applied to the venue file
 * (`packages/migrations/src/apply.ts`), so the tables a seed writes — `registro_sif`, the chain
 * head, the node's own row — are there, and none is applied to the node file.
 */
export async function registerTill(
  nodeArg: string,
  env: NodeJS.ProcessEnv,
): Promise<readonly SeedReport[]> {
  const store = await openVenueDatabase(await resolveScriptVenueDir(env));
  try {
    return await provisionNode(store.venue, { nodeId: brandNodeId(nodeArg) }, ALL_MODULES);
  } finally {
    // Two open SQLite files; leaking them keeps the process alive after `main` returns.
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

// Run only when invoked directly, never when imported by a test — `registerTill` above re-registers
// a SIF and starts a new hash chain (CLAUDE.md §5), so an import that ran it would be destructive.
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
