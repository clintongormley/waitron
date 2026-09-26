import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AppError } from "@waitron/shared";
import { decryptBundle, type BundleFiles } from "./recovery-bundle.js";
import { unpackBundleToDir } from "./state-secrets.js";

type Env = Record<string, string | undefined>;

const REFUSALS = {
  symlink: (dest: string) =>
    `recovery refused: ${dest} is a symbolic link. Give the folder it points to, or a new folder.`,
  not_a_folder: (dest: string) =>
    `recovery refused: ${dest} is not a folder. Give a folder, or a new one.`,
  not_owned: (dest: string) =>
    `recovery refused: ${dest} belongs to another user. Give a folder you own, or a new folder inside this one.`,
};

/**
 * The unpack makes an existing destination 0700: through a link it would tighten the folder the
 * link points to, and on a folder another user owns it would change their folder or, short of root,
 * stop on a raw `EPERM`; anything else that is not a folder stops it on a raw `EEXIST`. A
 * destination that does not exist yet is created by the unpack.
 */
async function destinationRefusal(
  destDir: string,
  uid: number | undefined,
): Promise<keyof typeof REFUSALS | undefined> {
  let st;
  try {
    st = await lstat(resolve(destDir));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  if (st.isSymbolicLink()) return "symlink";
  if (!st.isDirectory()) return "not_a_folder";
  if (uid !== undefined && st.uid !== uid) return "not_owned";
  return undefined;
}

/**
 * `waitron-recovery unpack <envelope-file> <dest-dir>`. The passphrase comes from the environment,
 * never argv, which leaks into the process table. Returns an exit code: 1 for a wrong passphrase, a
 * corrupt bundle, an unreadable file or a refused destination, 2 for a usage error. `uid` defaults
 * to this process's.
 */
export async function runRecoveryUnpack(deps: {
  argv: string[];
  env: Env;
  out: (line: string) => void;
  uid?: number;
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
  const refusal = await destinationRefusal(destDir, deps.uid ?? process.getuid?.());
  if (refusal !== undefined) {
    deps.out(REFUSALS[refusal](destDir));
    return 1;
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
