import { readFile } from "node:fs/promises";
import { decryptBundle } from "./recovery-bundle.js";
import { unpackBundleToDir } from "./state-secrets.js";

type Env = Record<string, string | undefined>;

/**
 * `waitron-recovery unpack <envelope-file> <dest-dir>` — decrypt a downloaded recovery bundle and
 * write its files under `dest-dir`. The passphrase comes from `WAITRON_RECOVERY_PASSPHRASE` (never an
 * argv, which leaks into the process table). Exported so the flow is unit-tested without a subprocess;
 * `bin-recovery.ts` is a thin wrapper that supplies `process.argv`/`process.env` and exits on the
 * returned code. The full "re-provision a fresh box from these files" procedure is the 4b-iii runbook —
 * this only recovers the files. Returns a process exit code: 0 on success, 2 on a usage/config error.
 */
export async function runRecoveryUnpack(deps: {
  argv: string[];
  env: Env;
  out: (line: string) => void;
}): Promise<number> {
  const [cmd, envelopePath, destDir] = deps.argv;
  if (cmd !== "unpack" || envelopePath === undefined || destDir === undefined) {
    deps.out("usage: waitron-recovery unpack <envelope-file> <dest-dir>");
    return 2;
  }
  const passphrase = deps.env.WAITRON_RECOVERY_PASSPHRASE;
  if (passphrase === undefined || passphrase === "") {
    deps.out("WAITRON_RECOVERY_PASSPHRASE must be set to the bundle's passphrase");
    return 2;
  }
  const files = decryptBundle(await readFile(envelopePath, "utf8"), passphrase);
  await unpackBundleToDir(files, destDir);
  deps.out(`unpacked ${Object.keys(files).length} file(s) to ${destDir}`);
  return 0;
}
