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

/** Loop devices are named by their recorded backing image, never by device id. */
const RESOURCE_FIELDS = Object.freeze({
  image: "path",
  loop: "image",
  mount: "target",
  vm: "pidFile",
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

/** @param {unknown} value @returns {{resource: RigResource, path: string} | null} */
function resourceShape(value) {
  const kind = /** @type {{kind?: unknown}} */ (value)?.kind;
  if (typeof kind !== "string" || !Object.hasOwn(RESOURCE_FIELDS, kind)) return null;
  const field = RESOURCE_FIELDS[/** @type {keyof typeof RESOURCE_FIELDS} */ (kind)];
  if (!exactRecord(value, ["kind", field])) return null;
  const path = /** @type {Record<string, unknown>} */ (value)[field];
  if (typeof path !== "string") return null;
  return { resource: /** @type {RigResource} */ ({ kind, [field]: path }), path };
}

/** @param {string} runDir @param {string} path */
function insideRun(runDir, path) {
  return (
    isAbsolute(path) &&
    !path.includes("\0") &&
    resolve(path) === path &&
    !path.startsWith("/dev/") &&
    path.startsWith(runDir + "/") &&
    path !== join(runDir, "ledger.json")
  );
}

/** @param {string} path */
async function readNoFollow(path) {
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

/** Reads and strictly validates runDir/ledger.json; refuses any resource outside runDir. @param {string} runDir @returns {Promise<readonly RigResource[]>} */
export async function loadLedger(runDir) {
  const text = await readNoFollow(join(runDir, "ledger.json"));
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw rigError("ledger-invalid");
  }
  if (
    !exactRecord(value, ["version", "runDir", "resources"]) ||
    value.version !== 1 ||
    value.runDir !== runDir ||
    !Array.isArray(value.resources)
  )
    throw rigError("ledger-invalid");
  const resources = value.resources.map((/** @type {unknown} */ item) => {
    const shape = resourceShape(item);
    if (shape === null || !insideRun(runDir, shape.path)) throw rigError("ledger-invalid");
    return shape.resource;
  });
  if (ledgerBytes(runDir, resources) !== text) throw rigError("ledger-invalid");
  return resources;
}

/** @param {string} runDir @param {RigResource} resource */
async function appendToLedger(runDir, resource) {
  const resources = await loadLedger(runDir);
  const next = join(runDir, "ledger.json.next");
  await fs.writeFile(next, ledgerBytes(runDir, [...resources, resource]), {
    flag: "wx",
    mode: 0o600,
  });
  await syncPath(next);
  await fs.rename(next, join(runDir, "ledger.json"));
  await syncPath(runDir);
}

/** @type {WeakMap<RigRun, Promise<void>>} */
const turns = new WeakMap();

/**
 * Durably records the resource, then runs step. step never runs if recording fails. Calls on one RigRun take turns.
 * step runs after the turn ends, so it may record its own sub-resources.
 * @template T @param {RigRun} run @param {RigResource} resource @param {() => T | Promise<T>} step @returns {Promise<T>}
 */
export async function withRecorded(run, resource, step) {
  const shape = resourceShape(resource);
  if (shape === null) throw rigError("resource-invalid");
  if (!insideRun(run.runDir, shape.path)) throw rigError("resource-outside-run");
  const turn = (turns.get(run) ?? Promise.resolve()).then(() =>
    appendToLedger(run.runDir, shape.resource),
  );
  turns.set(
    run,
    turn.catch(() => {}),
  );
  await turn;
  return step();
}

const CLEANUP = Object.freeze({
  image: (/** @type {{path: string}} */ r) => ({ action: "remove-file", path: r.path }),
  loop: (/** @type {{image: string}} */ r) => ({ action: "detach-loops", image: r.image }),
  mount: (/** @type {{target: string}} */ r) => ({ action: "unmount", target: r.target }),
  vm: (/** @type {{pidFile: string}} */ r) => ({ action: "stop-vm", pidFile: r.pidFile }),
});

/** Pure: reverse recording order; image → remove-file, loop → detach-loops, mount → unmount, vm → stop-vm. @param {readonly RigResource[]} resources @returns {CleanupStep[]} */
export function planCleanup(resources) {
  return [...resources]
    .reverse()
    .map(
      (resource) =>
        /** @type {CleanupStep} */ (CLEANUP[resource.kind](/** @type {any} */ (resource))),
    );
}

const RUNNERS = Object.freeze({
  "stop-vm": (/** @type {CleanupAdapter} */ a, /** @type {any} */ s) => a.stopVm(s.pidFile),
  unmount: (/** @type {CleanupAdapter} */ a, /** @type {any} */ s) => a.unmount(s.target),
  "detach-loops": (/** @type {CleanupAdapter} */ a, /** @type {any} */ s) => a.detachLoops(s.image),
  "remove-file": (/** @type {CleanupAdapter} */ a, /** @type {any} */ s) => a.removeFile(s.path),
});

/** Runs every step even after failures. @param {readonly CleanupStep[]} plan @param {CleanupAdapter} adapter @returns {Promise<{status:'clean'|'incomplete', failed: readonly CleanupStep[]}>} */
export async function runCleanup(plan, adapter) {
  /** @type {CleanupStep[]} */
  const failed = [];
  for (const step of plan) {
    try {
      await RUNNERS[step.action](adapter, step);
    } catch {
      failed.push(step);
    }
  }
  return { status: failed.length === 0 ? "clean" : "incomplete", failed };
}
