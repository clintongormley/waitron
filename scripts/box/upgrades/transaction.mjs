import * as fs from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { copyStoppedTree, restoreStoppedTree } from "./copy.mjs";

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

export async function upgradeStatus(directory) {
  let marker;
  try {
    marker = JSON.parse(await fs.readFile(join(directory, "attempt.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (
    marker === null ||
    !["manual", "automatic"].includes(marker.mode) ||
    !["copying", "candidate", "awaiting-choice", "restoring", "committed"].includes(marker.phase) ||
    typeof marker.copied !== "boolean" ||
    !Array.isArray(marker.paths) ||
    marker.paths.length === 0 ||
    !marker.paths.every((path) => typeof path === "string" && isAbsolute(path)) ||
    !["old", "candidate"].every(
      (key) =>
        marker.images?.[key] &&
        Object.keys(marker.images[key]).length > 0 &&
        Object.values(marker.images[key]).every((id) => typeof id === "string" && id.length > 0),
    ) ||
    (marker.phase === "candidate" && !marker.copied) ||
    (marker.phase === "committed" && !["old", "candidate"].includes(marker.target))
  )
    throw new Error("invalid upgrade marker");
  return marker;
}

async function record(directory, marker) {
  await writeFileDurable(join(directory, "attempt.json"), marker);
  return marker;
}

async function reopen(directory, host, marker) {
  await fs.rm(join(directory, "copies"), { recursive: true, force: true });
  await syncDirectory(directory);
  await host.cleanup(marker.images);
  await host.resume(marker.images[marker.target]);
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
      await restoreStoppedTree(join(directory, "copies", String(index)), path);
    }
  }
  return commit(directory, host, marker, "old");
}

/**
 * The caller holds the host upgrade lock for apply/recovery. prepareImages pins old images
 * before pulling and returns exact old/candidate IDs; stop verifies every writer drained.
 * installCandidate/checkCandidate stay contained; resume uses ordinary boot's fiscal guards.
 * The host owns the fixed volume/config inventory and its free-space check before this call.
 */
export async function applyUpgrade({ directory, paths, mode, host }) {
  if (!["manual", "automatic"].includes(mode)) throw new Error("invalid upgrade mode");
  await fs.mkdir(directory, { mode: 0o700 });
  await syncDirectory(dirname(directory));
  let images;
  try {
    images = await host.prepareImages();
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
    return commit(directory, host, { ...marker, failure: error.message }, "old");
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
      failure: error.message,
    });
    return mode === "automatic" ? restore(directory, host, marker) : marker;
  }
  return commit(directory, host, marker, "candidate");
}

/** A new process resumes the recorded decision; committed attempts never restore a snapshot. */
export async function recoverUpgrade({ directory, host, choice }) {
  let marker = await upgradeStatus(directory);
  if (marker === null) return null;
  if (marker.phase === "committed") return reopen(directory, host, marker);
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
  if (marker.phase !== "awaiting-choice") {
    marker = await record(directory, {
      ...marker,
      phase: "awaiting-choice",
      failure: "checks interrupted",
    });
  }
  return marker;
}
