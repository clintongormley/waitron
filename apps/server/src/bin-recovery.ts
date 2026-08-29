#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { decryptBundle } from "./recovery-bundle.js";
import { unpackBundleToDir } from "./state-secrets.js";

/**
 * `waitron-recovery unpack <envelope-file> <dest-dir>` — decrypt a downloaded recovery bundle and
 * write its files under `dest-dir`. The passphrase comes from `WAITRON_RECOVERY_PASSPHRASE` (never an
 * argv, which leaks into the process table). Exported so the flow is unit-tested without a subprocess;
 * the module's bottom invokes it only when run as the entry point. The full "re-provision a fresh box
 * from these files" procedure is the 4b-iii runbook — this only recovers the files.
 */
export async function runRecoveryUnpack(argv: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const [cmd, envelopePath, destDir] = argv;
  if (cmd !== "unpack" || envelopePath === undefined || destDir === undefined) {
    throw new Error("usage: waitron-recovery unpack <envelope-file> <dest-dir>");
  }
  const passphrase = env.WAITRON_RECOVERY_PASSPHRASE;
  if (passphrase === undefined || passphrase === "") {
    throw new Error("WAITRON_RECOVERY_PASSPHRASE must be set to the bundle's passphrase");
  }
  const files = decryptBundle(await readFile(envelopePath, "utf8"), passphrase);
  await unpackBundleToDir(files, destDir);
}

// Invoked as the bin entry point (not when imported by a test). `import.meta.url` ends with this
// module's path only when it is the process entry; the guard keeps the test import side-effect-free.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  runRecoveryUnpack(process.argv.slice(2), process.env).catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
