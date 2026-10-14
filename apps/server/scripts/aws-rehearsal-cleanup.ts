// Removes a bucket an Amazon S3 rehearsal left behind, working only from that run's receipt and only
// once the bucket's ownership marker names the receipt's run. The rehearsal's receipt carries the exact
// command (`cleanupCommandFor`, `src/testing/aws-rehearsal-receipt.ts`).
//
// Usage: pnpm --filter @waitron/server exec tsx scripts/aws-rehearsal-cleanup.ts --receipt <path>
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanupFromReceipt } from "../src/testing/aws-rehearsal.js";

const USAGE =
  "usage: pnpm --filter @waitron/server exec tsx scripts/aws-rehearsal-cleanup.ts --receipt <path>";

export function parseCleanupArgs(argv: readonly string[]): { receipt: string } | null {
  if (argv.length !== 2 || argv[0] !== "--receipt" || argv[1] === "") return null;
  return { receipt: argv[1]! };
}

export interface CleanupScriptDeps {
  cleanup(receiptPath: string): Promise<{ ok: boolean }>;
  error(line: string): void;
}

/** Returns the exit status: 0 cleaned, 1 refused or failed, 2 bad arguments. */
export async function runCleanup(
  argv: readonly string[],
  deps: CleanupScriptDeps,
): Promise<number> {
  const args = parseCleanupArgs(argv);
  if (args === null) {
    deps.error(USAGE);
    return 2;
  }
  try {
    return (await deps.cleanup(args.receipt)).ok ? 0 : 1;
  } catch (error) {
    // The message alone: a stack or an SDK error's properties could carry values.
    deps.error(error instanceof Error ? error.message : "the cleanup failed");
    return 1;
  }
}

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  process.exitCode = await runCleanup(process.argv.slice(2), {
    cleanup: (path) => cleanupFromReceipt(path, {}),
    error: (line) => console.error(line),
  });
}
