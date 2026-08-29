import { readFile } from "node:fs/promises";
import { AppError } from "@waitron/shared";
import { decryptBundle, type BundleFiles } from "./recovery-bundle.js";
import { unpackBundleToDir } from "./state-secrets.js";

type Env = Record<string, string | undefined>;

/**
 * `waitron-recovery unpack <envelope-file> <dest-dir>` — decrypt a downloaded recovery bundle and
 * write its files under `dest-dir`. The passphrase comes from `WAITRON_RECOVERY_PASSPHRASE` (never an
 * argv, which leaks into the process table). Exported so the flow is unit-tested without a subprocess;
 * `bin-recovery.ts` is a thin wrapper that supplies `process.argv`/`process.env` and exits on the
 * returned code. The full "re-provision a fresh box from these files" procedure is the 4b-iii runbook —
 * this only recovers the files. Returns a process exit code: 0 on success, 1 on the expected
 * disaster-recovery errors (wrong passphrase / corrupt bundle / unreadable envelope file), 2 on a
 * usage/config error.
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
  let envelopeJson: string;
  try {
    envelopeJson = await readFile(envelopePath, "utf8");
  } catch {
    // The envelope file is missing/unreadable (ENOENT etc.) — the operator gave a bad path. Name
    // the path so they can fix it; no secret is in a filename.
    deps.out(`cannot read bundle file: ${envelopePath}`);
    return 1;
  }
  let files: BundleFiles;
  try {
    files = decryptBundle(envelopeJson, passphrase);
    await unpackBundleToDir(files, destDir);
  } catch (err) {
    // The two expected disaster-recovery failures: a mistyped passphrase (recovery.passphrase_invalid)
    // or a corrupt/hostile bundle (recovery.bundle_invalid, incl. an unsafe unpack path). One message
    // for both — revealing which would help an attacker, and neither leaks a secret. Anything else
    // (an unexpected bug) propagates so it is not silently swallowed.
    if (
      err instanceof AppError &&
      (err.code === "recovery.passphrase_invalid" || err.code === "recovery.bundle_invalid")
    ) {
      deps.out("recovery failed: wrong passphrase or corrupt bundle");
      return 1;
    }
    throw err;
  }
  deps.out(`unpacked ${Object.keys(files).length} file(s) to ${destDir}`);
  return 0;
}
