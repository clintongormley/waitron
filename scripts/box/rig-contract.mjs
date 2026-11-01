import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { randomBytes } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";

/**
 * @typedef {{ runDir: string, rootId: string, runId: string }} RigRun
 *   rootId is the run folder's device and inode; runId is drawn at random by createRun and kept in
 *   the ledger, because a file system may give a new folder a removed folder's inode.
 * @typedef {{kind:'image', path:string}
 *   | {kind:'loop', image:string}
 *   | {kind:'mount', target:string}
 *   | {kind:'vm', pidFile:string}} RigResource
 * @typedef {{action:'stop-vm', pidFile:string}|{action:'unmount', target:string}
 *   |{action:'detach-loops', image:string}|{action:'remove-file', path:string}} CleanupStep
 * @typedef {CleanupStep & { reason: string }} FailedStep
 * @typedef {{ stopVm(pidFile:string):Promise<void>, unmount(target:string):Promise<void>,
 *   detachLoops(image:string):Promise<void>, removeFile(path:string):Promise<void> }} CleanupAdapter
 *   The checks here go by path, so a folder swapped after them is not seen. That holds for this
 *   library's own ledger write too: a run folder swapped for a symlink after the checks sends the
 *   staging file into the symlink's target and, when the target holds a copy of this run's ledger,
 *   the rename as well; only the final no-follow flush of the run folder then refuses, after the
 *   write. A real adapter (Linux; none is built in this pull request) must therefore open every
 *   path beneath the run folder without following a symlink: openat2 from a handle on the run
 *   folder with RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS. It must also check that a VM's process is
 *   the one this run started before stopping it.
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

/** @param {string} runDir @param {string} runId @param {readonly RigResource[]} resources */
function ledgerBytes(runDir, runId, resources) {
  return JSON.stringify({ version: 1, runDir, runId, resources }) + "\n";
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
  const runId = randomBytes(16).toString("hex");
  const ledger = join(runDir, "ledger.json");
  await fs.writeFile(ledger, ledgerBytes(runDir, runId, []), { flag: "wx", mode: 0o600 });
  await syncPath(ledger);
  await syncPath(runDir);
  const stat = await fs.lstat(runDir, { bigint: true });
  return { runDir, rootId: `${stat.dev}:${stat.ino}`, runId };
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

const RESERVED = Object.freeze(["ledger.json", "ledger.json.next"]);

/**
 * Text only; checkBeneath looks at the file system. Reserved names are compared lower-cased because
 * a case-insensitive file system opens LEDGER.JSON as the ledger.
 * @param {string} runDir @param {string} path
 */
function insideRun(runDir, path) {
  return (
    isAbsolute(path) &&
    !path.includes("\0") &&
    resolve(path) === path &&
    path.startsWith(runDir + "/") &&
    !path
      .slice(runDir.length + 1)
      .split("/")
      .some((part) => RESERVED.includes(part.toLowerCase()))
  );
}

/** @param {unknown} run @returns {asserts run is RigRun} */
function checkRun(run) {
  if (
    !exactRecord(run, ["runDir", "rootId", "runId"]) ||
    typeof (/** @type {RigRun} */ (run).runDir) !== "string" ||
    typeof (/** @type {RigRun} */ (run).rootId) !== "string" ||
    typeof (/** @type {RigRun} */ (run).runId) !== "string"
  )
    throw rigError("run-invalid");
  checkRunDir(/** @type {RigRun} */ (run).runDir);
}

/** The run folder must still have the device and inode createRun saw; readLedger checks the run id. @param {RigRun} run */
async function checkRoot(run) {
  let stat;
  try {
    stat = await fs.lstat(run.runDir, { bigint: true });
  } catch (error) {
    if (error.code === "ENOENT") throw rigError("run-dir-replaced");
    throw error;
  }
  if (`${stat.dev}:${stat.ino}` !== run.rootId) throw rigError("run-dir-replaced");
}

/**
 * Refuses a path reached through a symlink, or through a file (resource-through-symlink for both).
 * Parts not made yet are fine: nothing beneath them exists.
 * @param {string} runDir @param {string} path
 */
async function checkBeneath(runDir, path) {
  let current = runDir;
  for (const part of path.slice(runDir.length + 1).split("/")) {
    current = join(current, part);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error.code === "ENOENT") return;
      if (error.code === "ENOTDIR") throw rigError("resource-through-symlink");
      throw error;
    }
    if (stat.isSymbolicLink()) throw rigError("resource-through-symlink");
  }
}

/** @param {string} path */
async function lstatIfPresent(path) {
  try {
    return await fs.lstat(path, { bigint: true });
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * A hard link, or a name whose letters fold in a way the lower-casing misses, still reaches the
 * ledger or its staging file; the device and inode do not lie.
 * @param {string} runDir @param {string} path
 */
async function checkNotLedger(runDir, path) {
  const target = await lstatIfPresent(path);
  if (target === null) return;
  for (const name of RESERVED) {
    const reserved = await lstatIfPresent(join(runDir, name));
    if (reserved?.dev === target.dev && reserved.ino === target.ino)
      throw rigError("resource-is-ledger");
  }
}

/** A ledger naming another run's id is refused as run-dir-replaced. @param {RigRun} run */
async function readLedger(run) {
  const { runDir } = run;
  let handle;
  try {
    // Without O_NONBLOCK, opening a FIFO waits for a writer that may never come.
    handle = await fs.open(
      join(runDir, "ledger.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if (error.code === "ELOOP" || error.code === "ENOENT") throw rigError("ledger-invalid");
    throw error;
  }
  let text;
  try {
    if (!(await handle.stat()).isFile()) throw rigError("ledger-invalid");
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
  if (typeof value?.runId !== "string") throw rigError("ledger-invalid");
  if (value.runId !== run.runId) throw rigError("run-dir-replaced");
  if (!Array.isArray(value.resources)) throw rigError("ledger-invalid");
  const resources = value.resources.map((/** @type {unknown} */ item) => {
    const shape = resourceShape(item);
    if (shape === null || !insideRun(runDir, shape.path)) throw rigError("ledger-invalid");
    return shape.resource;
  });
  if (ledgerBytes(runDir, run.runId, resources) !== text) throw rigError("ledger-invalid");
  return resources;
}

/** Reads and strictly validates the run's ledger.json; refuses any resource outside the run folder. @param {RigRun} run @returns {Promise<readonly RigResource[]>} */
export async function loadLedger(run) {
  checkRun(run);
  await checkRoot(run);
  return readLedger(run);
}

/**
 * Creating ledger.json.next with wx before reading the ledger makes the staging file a lock
 * across processes: a second writer cannot read the ledger until the first has renamed its copy
 * into place. ledger-busy means the staging file is there: another process is recording, or a
 * crash left it behind. A left-behind one refuses every later record until a person removes it.
 * @param {RigRun} run @param {RigResource} resource @param {string} path
 */
async function appendToLedger(run, resource, path) {
  await checkRoot(run);
  await checkBeneath(run.runDir, path);
  const next = join(run.runDir, "ledger.json.next");
  let handle;
  try {
    handle = await fs.open(next, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") throw rigError("ledger-busy");
    throw error;
  }
  try {
    const resources = await readLedger(run);
    await handle.writeFile(ledgerBytes(run.runDir, run.runId, [...resources, resource]));
    await handle.sync();
  } catch (error) {
    await handle.close();
    await fs.unlink(next);
    throw error;
  }
  await handle.close();
  await fs.rename(next, join(run.runDir, "ledger.json"));
  try {
    await syncPath(run.runDir);
  } catch (error) {
    if (error.code === "ELOOP") throw rigError("run-dir-replaced");
    throw error;
  }
}

/** Keyed by run folder, so copies of one run record take turns too. @type {Map<string, Promise<void>>} */
const turns = new Map();

/**
 * Durably records the resource, then runs step. step never runs if recording fails. Calls on one
 * run folder take turns in this process; the staging file keeps other processes out.
 * step runs after the turn ends, so it may record its own sub-resources.
 * @template T @param {RigRun} run @param {RigResource} resource @param {() => T | Promise<T>} step @returns {Promise<T>}
 */
export async function withRecorded(run, resource, step) {
  checkRun(run);
  const shape = resourceShape(resource);
  if (shape === null) throw rigError("resource-invalid");
  if (!insideRun(run.runDir, shape.path)) throw rigError("resource-outside-run");
  const turn = (turns.get(run.runDir) ?? Promise.resolve()).then(() =>
    appendToLedger(run, shape.resource, shape.path),
  );
  turns.set(
    run.runDir,
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
 * again that the run folder has createRun's device and inode, that its ledger still names this
 * run's id and reads back, that the step's path is reached through no symlink, and that it is not
 * the ledger or its staging file under another name (resource-is-ledger); a step that
 * fails a check is counted as failed and never reaches the adapter. Runs every step even after
 * failures. Each failed entry's reason is the refusal's reason, or adapter-failed for any other
 * error. A staging file left beside the ledger afterwards, or one whose presence cannot be checked,
 * is reported as a failed remove-file with reason ledger-busy and never removed: a person decides
 * whether it is a crash's leftover.
 * @param {RigRun} run @param {CleanupAdapter} adapter @returns {Promise<{status:'clean'|'incomplete', failed: readonly FailedStep[]}>}
 */
export async function runCleanup(run, adapter) {
  const resources = await loadLedger(run);
  /** @type {FailedStep[]} */
  const failed = [];
  for (const { step, path, call } of cleanupSteps(resources)) {
    try {
      await loadLedger(run);
      await checkBeneath(run.runDir, path);
      await checkNotLedger(run.runDir, path);
      await call(adapter, path);
    } catch (error) {
      const reason = error?.code === "rig.refused" ? error.reason : "adapter-failed";
      failed.push({ ...step, reason });
    }
  }
  const next = join(run.runDir, "ledger.json.next");
  const leftover = await fs.lstat(next).then(
    () => true,
    (error) => error.code !== "ENOENT",
  );
  if (leftover) failed.push({ action: "remove-file", path: next, reason: "ledger-busy" });
  return { status: failed.length === 0 ? "clean" : "incomplete", failed };
}
