import * as fs from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { copyStoppedTree, restoreStoppedTree } from "./copy.mjs";

// The Node-only host uses the default layout; the nested-lock test reads the store constants.
const RETAINED_LOCK_PATHS = ["recovery.lock", "venue/venue.lock"];

async function syncDirectory(path) {
  const handle = await fs.open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

// The host runtime is installed without workspace packages; this writer stays Node-only.
async function writeFileDurable(path, value) {
  const temporary = `${path}.tmp`;
  const handle = await fs.open(temporary, "w", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, path);
  await syncDirectory(dirname(path));
}

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const failureText = (error) => String(error?.message ?? error);

function validateInputs({ mode, paths }) {
  if (
    !["manual", "automatic"].includes(mode) ||
    !Array.isArray(paths) ||
    paths.length === 0 ||
    !paths.every((path) => typeof path === "string" && isAbsolute(path))
  )
    throw new Error("invalid upgrade marker");
}

function validateMarker(marker) {
  if (!object(marker)) throw new Error("invalid upgrade marker");
  validateInputs(marker);
  if (
    !["copying", "candidate", "awaiting-choice", "restoring", "committed"].includes(marker.phase) ||
    typeof marker.copied !== "boolean" ||
    !["old", "candidate"].every(
      (key) =>
        object(marker.images?.[key]) &&
        Object.keys(marker.images[key]).length > 0 &&
        Object.values(marker.images[key]).every((id) => typeof id === "string" && id.length > 0),
    ) ||
    (marker.phase === "candidate" && !marker.copied) ||
    (marker.phase === "committed" && !["old", "candidate"].includes(marker.target))
  )
    throw new Error("invalid upgrade marker");
}

export async function upgradeStatus(directory) {
  let marker;
  try {
    marker = JSON.parse(await fs.readFile(join(directory, "attempt.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  validateMarker(marker);
  return marker;
}

async function record(directory, marker) {
  validateMarker(marker);
  await writeFileDurable(join(directory, "attempt.json"), marker);
  return marker;
}

async function reopen(directory, host, marker) {
  await host.resume(marker.images[marker.target]);
  await fs.rm(join(directory, "copies"), { recursive: true, force: true });
  await syncDirectory(directory);
  await host.cleanup(marker.images);
  return marker;
}

async function commit(directory, host, marker, target) {
  const completed = await record(directory, { ...marker, phase: "committed", target });
  return reopen(directory, host, completed);
}

async function restore(directory, host, marker) {
  await host.stop();
  marker = await record(directory, { ...marker, phase: "restoring" });
  if (marker.copied) {
    for (const [index, path] of marker.paths.entries()) {
      await restoreStoppedTree(join(directory, "copies", String(index)), path, RETAINED_LOCK_PATHS);
    }
  }
  return commit(directory, host, marker, "old");
}

/**
 * The caller holds the host upgrade lock for apply/recovery. prepareImages pins old images
 * before pulling and returns exact old/candidate IDs; stop verifies every writer drained.
 * installCandidate/checkCandidate stay contained; resume uses ordinary boot's fiscal guards
 * and tolerates repetition after an interrupted cleanup.
 * The host owns the fixed volume/config inventory and its free-space check before this call.
 * It supplies a fresh attempt directory and the default state-volume layout.
 */
export async function applyUpgrade({ directory, paths, mode, host }) {
  if (!["manual", "automatic"].includes(mode)) throw new Error("invalid upgrade mode");
  validateInputs({ mode, paths });
  await fs.mkdir(directory, { mode: 0o700 });
  await syncDirectory(dirname(directory));
  let images;
  try {
    images = await host.prepareImages();
    validateMarker({ mode, paths, images, phase: "copying", copied: false });
  } catch (error) {
    await fs.rmdir(directory);
    await syncDirectory(dirname(directory));
    throw error;
  }
  let marker = await record(directory, {
    mode,
    phase: "copying",
    copied: false,
    paths,
    images,
    checks: null,
    failure: null,
  });
  try {
    await host.stop();
  } catch (error) {
    return commit(directory, host, { ...marker, failure: failureText(error) }, "old");
  }
  try {
    await fs.mkdir(join(directory, "copies"), { mode: 0o700 });
    for (const [index, path] of paths.entries()) {
      await copyStoppedTree(path, join(directory, "copies", String(index)));
    }
    marker = await record(directory, { ...marker, phase: "candidate", copied: true });
    await host.installCandidate(images.candidate);
    const checks = await host.checkCandidate();
    marker = { ...marker, checks };
    if (
      !Array.isArray(checks) ||
      checks.length === 0 ||
      checks.some((check) => check.ok !== true)
    ) {
      throw new Error("candidate checks failed");
    }
  } catch (error) {
    marker = await record(directory, {
      ...marker,
      phase: "awaiting-choice",
      failure: failureText(error),
    });
    return mode === "automatic" ? restore(directory, host, marker) : marker;
  }
  return commit(directory, host, marker, "candidate");
}

/** A new process resumes the recorded decision; committed attempts never restore a snapshot. */
export async function recoverUpgrade({ directory, host, choice }) {
  let marker = await upgradeStatus(directory);
  if (marker === null) {
    try {
      await fs.rmdir(directory);
      await syncDirectory(dirname(directory));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return null;
  }
  if (marker.phase === "committed") return reopen(directory, host, marker);
  if (["copying", "candidate"].includes(marker.phase)) {
    marker = await record(directory, {
      ...marker,
      phase: "awaiting-choice",
      failure: "checks interrupted",
    });
  }
  if (marker.phase === "restoring" || choice === "restore" || marker.mode === "automatic") {
    return restore(directory, host, marker);
  }
  if (choice === "keep") {
    if (!marker.copied) throw new Error("candidate was not installed");
    await host.stop();
    await host.installCandidate(marker.images.candidate);
    return commit(directory, host, marker, "candidate");
  }
  if (choice !== undefined) throw new Error("invalid upgrade choice");
  await host.stop();
  return marker;
}
