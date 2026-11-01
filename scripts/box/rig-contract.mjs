import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

/**
 * @typedef {{ runDir: string, rootId: string }} RigRun
 * @typedef {{kind:'image', path:string}
 *   | {kind:'loop', image:string}
 *   | {kind:'mount', target:string}
 *   | {kind:'vm', pidFile:string}} RigResource
 * @typedef {{action:'stop-vm', pidFile:string}|{action:'unmount', target:string}
 *   |{action:'detach-loops', image:string}|{action:'remove-file', path:string}} CleanupStep
 * @typedef {{ stopVm(pidFile:string):Promise<void>, unmount(target:string):Promise<void>,
 *   detachLoops(image:string):Promise<void>, removeFile(path:string):Promise<void> }} CleanupAdapter
 *   The checks here go by path, so a folder swapped after them is not seen. A real adapter (Linux;
 *   none is built in this pull request) must therefore open every path beneath the run folder
 *   without following a symlink: openat2 from a handle on the run folder with
 *   RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS. It must also check that a VM's process is the one this
 *   run started before stopping it.
 */

/** Case names the argument parser recognises. None is runnable yet: each needs the Linux recipe and rig adapter. */
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
  if (
    runDir.includes("\0") ||
    runDir === "/" ||
    resolve(runDir) !== runDir ||
    runDir === "/dev" ||
    runDir.startsWith("/dev/")
  )
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

/** @param {string} runDir @param {readonly RigResource[]} resources */
function ledgerBytes(runDir, resources) {
  return JSON.stringify({ version: 1, runDir, resources }) + "\n";
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
  await fs.writeFile(ledger, ledgerBytes(runDir, []), { flag: "wx", mode: 0o600 });
  await syncPath(ledger);
  await syncPath(runDir);
  const stat = await fs.lstat(runDir, { bigint: true });
  return { runDir, rootId: `${stat.dev}:${stat.ino}` };
}

/** Loop devices are named by their recorded backing image, never by device id. A cleanup step names its path with its resource's field. */
const KINDS = Object.freeze({
  image: {
    field: "path",
    action: "remove-file",
    call: (/** @type {CleanupAdapter} */ a, /** @type {string} */ p) => a.removeFile(p),
  },
  loop: {
    field: "image",
    action: "detach-loops",
    call: (/** @type {CleanupAdapter} */ a, /** @type {string} */ p) => a.detachLoops(p),
  },
  mount: {
    field: "target",
    action: "unmount",
    call: (/** @type {CleanupAdapter} */ a, /** @type {string} */ p) => a.unmount(p),
  },
  vm: {
    field: "pidFile",
    action: "stop-vm",
    call: (/** @type {CleanupAdapter} */ a, /** @type {string} */ p) => a.stopVm(p),
  },
});

/** @param {unknown} value @param {string[]} keys */
function exactRecord(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

/** @param {unknown} value @returns {{resource: RigResource, path: string, kind: (typeof KINDS)[keyof typeof KINDS]} | null} */
function resourceShape(value) {
  const name = /** @type {{kind?: unknown}} */ (value)?.kind;
  if (typeof name !== "string" || !Object.hasOwn(KINDS, name)) return null;
  const kind = KINDS[/** @type {keyof typeof KINDS} */ (name)];
  if (!exactRecord(value, ["kind", kind.field])) return null;
  const path = /** @type {Record<string, unknown>} */ (value)[kind.field];
  if (typeof path !== "string") return null;
  return { resource: /** @type {RigResource} */ ({ kind: name, [kind.field]: path }), path, kind };
}

/** Text only; checkBeneath looks at the file system. @param {string} runDir @param {string} path */
function insideRun(runDir, path) {
  return (
    isAbsolute(path) &&
    !path.includes("\0") &&
    resolve(path) === path &&
    path.startsWith(runDir + "/") &&
    path !== join(runDir, "ledger.json") &&
    path !== join(runDir, "ledger.json.next")
  );
}

/** @param {unknown} run @returns {asserts run is RigRun} */
function checkRun(run) {
  if (
    !exactRecord(run, ["runDir", "rootId"]) ||
    typeof (/** @type {RigRun} */ (run).runDir) !== "string" ||
    typeof (/** @type {RigRun} */ (run).rootId) !== "string"
  )
    throw rigError("run-invalid");
  checkRunDir(/** @type {RigRun} */ (run).runDir);
}

/** The run folder must still be the real folder createRun made, not a symlink or a replacement. @param {RigRun} run */
async function checkRoot(run) {
  const stat = await fs.lstat(run.runDir, { bigint: true });
  if (!stat.isDirectory() || `${stat.dev}:${stat.ino}` !== run.rootId)
    throw rigError("run-dir-replaced");
}

/** Refuses a path reached through a symlink. Parts not made yet are fine: nothing beneath them exists. @param {string} runDir @param {string} path */
async function checkBeneath(runDir, path) {
  let current = runDir;
  for (const part of path.slice(runDir.length + 1).split("/")) {
    current = join(current, part);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink()) throw rigError("resource-through-symlink");
  }
}

/** @param {string} runDir */
async function readLedger(runDir) {
  const handle = await fs.open(
    join(runDir, "ledger.json"),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  let text;
  try {
    text = await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw rigError("ledger-invalid");
  }
  // Another version, another run's folder, missing or extra keys, key order and spacing are all
  // refused by the canonical-bytes comparison below.
  if (!Array.isArray(value?.resources)) throw rigError("ledger-invalid");
  const resources = value.resources.map((/** @type {unknown} */ item) => {
    const shape = resourceShape(item);
    if (shape === null || !insideRun(runDir, shape.path)) throw rigError("ledger-invalid");
    return shape.resource;
  });
  if (ledgerBytes(runDir, resources) !== text) throw rigError("ledger-invalid");
  return resources;
}

/** Reads and strictly validates the run's ledger.json; refuses any resource outside the run folder. @param {RigRun} run @returns {Promise<readonly RigResource[]>} */
export async function loadLedger(run) {
  checkRun(run);
  await checkRoot(run);
  return readLedger(run.runDir);
}

/**
 * Creating ledger.json.next with wx before reading the ledger makes the staging file a lock
 * across processes: a second writer cannot read the ledger until the first has renamed its copy
 * into place. A staging file left by a crash refuses every later record until someone removes it.
 * @param {RigRun} run @param {RigResource} resource @param {string} path
 */
async function appendToLedger(run, resource, path) {
  await checkRoot(run);
  await checkBeneath(run.runDir, path);
  const next = join(run.runDir, "ledger.json.next");
  const handle = await fs.open(next, "wx", 0o600);
  try {
    const resources = await readLedger(run.runDir);
    await handle.writeFile(ledgerBytes(run.runDir, [...resources, resource]));
    await handle.sync();
  } catch (error) {
    await handle.close();
    await fs.unlink(next);
    throw error;
  }
  await handle.close();
  await fs.rename(next, join(run.runDir, "ledger.json"));
  await syncPath(run.runDir);
}

/** @type {WeakMap<RigRun, Promise<void>>} */
const turns = new WeakMap();

/**
 * Durably records the resource, then runs step. step never runs if recording fails. Calls on one
 * RigRun take turns in this process; the staging file keeps other processes out.
 * step runs after the turn ends, so it may record its own sub-resources.
 * @template T @param {RigRun} run @param {RigResource} resource @param {() => T | Promise<T>} step @returns {Promise<T>}
 */
export async function withRecorded(run, resource, step) {
  checkRun(run);
  const shape = resourceShape(resource);
  if (shape === null) throw rigError("resource-invalid");
  if (!insideRun(run.runDir, shape.path)) throw rigError("resource-outside-run");
  const turn = (turns.get(run) ?? Promise.resolve()).then(() =>
    appendToLedger(run, shape.resource, shape.path),
  );
  turns.set(
    run,
    turn.catch(() => {}),
  );
  await turn;
  return step();
}

/** @param {readonly RigResource[]} resources */
function cleanupSteps(resources) {
  return [...resources].reverse().map((resource) => {
    const shape = resourceShape(resource);
    if (shape === null) throw rigError("resource-invalid");
    const step = /** @type {CleanupStep} */ ({
      action: shape.kind.action,
      [shape.kind.field]: shape.path,
    });
    return { step, path: shape.path, call: shape.kind.call };
  });
}

/** Pure: reverse recording order; image → remove-file, loop → detach-loops, mount → unmount, vm → stop-vm. @param {readonly RigResource[]} resources @returns {CleanupStep[]} */
export function planCleanup(resources) {
  return cleanupSteps(resources).map(({ step }) => step);
}

/**
 * Cleans up exactly what the run's ledger records, in reverse order. Before each step it checks
 * again that the run folder is the one createRun made and that the step's path is reached through
 * no symlink; a step that fails a check is counted as failed and never reaches the adapter.
 * Runs every step even after failures.
 * @param {RigRun} run @param {CleanupAdapter} adapter @returns {Promise<{status:'clean'|'incomplete', failed: readonly CleanupStep[]}>}
 */
export async function runCleanup(run, adapter) {
  const resources = await loadLedger(run);
  /** @type {CleanupStep[]} */
  const failed = [];
  for (const { step, path, call } of cleanupSteps(resources)) {
    try {
      await checkRoot(run);
      await checkBeneath(run.runDir, path);
      await call(adapter, path);
    } catch {
      failed.push(step);
    }
  }
  return { status: failed.length === 0 ? "clean" : "incomplete", failed };
}
