import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

/**
 * @typedef {{ runDir: string, rootId: string }} RigRun
 */

/** Case names the argument parser recognises. None is runnable yet: each needs the Linux recipe and rig adapter, and a later PR wires it. */
export const RIG_CASES = Object.freeze([
  "layout",
  "seal-a",
  "seal-b",
  "seal-d",
  "seal-f",
  "seal-g",
  "seal-i",
  "preboot-local",
  "preboot-headless",
  "preboot-two-boxes",
  "preboot-tamper",
]);

const OPTIONS = /** @type {const} */ ({ "--case": "caseName", "--run-dir": "runDir" });

/** @param {string} reason */
function rigError(reason) {
  return Object.assign(new Error("rig.refused"), { code: "rig.refused", reason });
}

/** @param {string} runDir */
function checkRunDir(runDir) {
  if (!isAbsolute(runDir)) throw rigError("run-dir-relative");
  if (runDir.includes("\0") || runDir === "/" || resolve(runDir) !== runDir)
    throw rigError("run-dir-unsafe");
}

/** @param {readonly string[]} argv  arguments after the script name @returns {{caseName: string, runDir: string}} */
export function parseRigArgs(argv) {
  if (argv.some((arg) => arg.startsWith("/dev/"))) throw rigError("device-argument");
  /** @type {{caseName?: string, runDir?: string}} */
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = Object.hasOwn(OPTIONS, argv[index])
      ? OPTIONS[/** @type {keyof typeof OPTIONS} */ (argv[index])]
      : undefined;
    if (key === undefined) throw rigError("argument-unknown");
    if (Object.hasOwn(parsed, key)) throw rigError("argument-repeated");
    if (index + 1 >= argv.length) throw rigError("argument-missing");
    parsed[key] = argv[index + 1];
  }
  const { caseName, runDir } = parsed;
  if (caseName === undefined || runDir === undefined) throw rigError("argument-missing");
  if (!RIG_CASES.includes(caseName)) throw rigError("case-unknown");
  checkRunDir(runDir);
  return { caseName, runDir };
}

/** @param {string} runDir */
function ledgerBytes(runDir) {
  return JSON.stringify({ version: 1, runDir, resources: [] }) + "\n";
}

/** @param {string} path */
async function syncPath(path) {
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Creates runDir (mode 0700, parent must exist, never recursive) and an empty ledger. @param {string} runDir @returns {Promise<RigRun>} */
export async function createRun(runDir) {
  checkRunDir(runDir);
  try {
    await fs.mkdir(runDir, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST") throw rigError("run-dir-exists");
    if (error.code === "ENOENT") throw rigError("run-dir-parent-missing");
    throw error;
  }
  const ledger = join(runDir, "ledger.json");
  await fs.writeFile(ledger, ledgerBytes(runDir), { flag: "wx", mode: 0o600 });
  await syncPath(ledger);
  await syncPath(runDir);
  const stat = await fs.lstat(runDir, { bigint: true });
  return { runDir, rootId: `${stat.dev}:${stat.ino}` };
}
