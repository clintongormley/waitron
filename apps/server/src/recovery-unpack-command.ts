import { readFile } from "node:fs/promises";
import { AppError } from "@waitron/shared";
import { decryptBundle, type BundleFiles } from "./recovery-bundle.js";
import { unpackBundleToDir } from "./state-secrets.js";

type Env = Record<string, string | undefined>;

/**
 * `waitron-recovery unpack <envelope-file> <dest-dir>`. The passphrase comes from the environment,
 * never argv, which leaks into the process table. Returns an exit code: 1 for a wrong passphrase, a
 * corrupt bundle or an unreadable file, 2 for a usage error.
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
    deps.out(`cannot read bundle file: ${envelopePath}`);
    return 1;
  }
  let files: BundleFiles;
  try {
    files = decryptBundle(envelopeJson, passphrase);
    await unpackBundleToDir(files, destDir);
  } catch (err) {
    // One message for both: revealing which would help an attacker.
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
