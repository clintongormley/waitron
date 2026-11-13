import * as fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createUpgradeHost, recoverInstalledUpgrade } from "./host.mjs";
import { applyUpgrade, upgradeStatus } from "./transaction.mjs";
import { checkUpgradeCandidate, removeUpgradeCheckContainers } from "./candidate.mjs";

const execute = promisify(execFile);
const command = (file, args, input) => {
  const result = execute(file, args, { maxBuffer: 4 * 1024 * 1024 });
  if (input !== undefined) result.child.stdin.end(input);
  return result;
};

async function pending(boxDirectory) {
  let entries;
  try {
    entries = await fs.readdir(`${boxDirectory}.upgrades`);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (entries.length > 1) throw new Error("multiple upgrade attempts; inspect host status");
  if (entries.length === 0) return null;
  const directory = join(`${boxDirectory}.upgrades`, entries[0]);
  const marker = await upgradeStatus(directory);
  if (marker === null && (await fs.readdir(directory)).length > 0)
    throw new Error("upgrade attempt has no readable marker; retain it for inspection");
  return { directory, marker };
}

// Mutating callers hold <box>.upgrade.lock; status takes no lock and writes nothing.
export async function runUpgradeCli([verb, boxDirectory, ...prepare], { run = command } = {}) {
  if (
    !["apply", "status", "restore", "keep", "recover", "offline-recovery"].includes(verb) ||
    !boxDirectory?.startsWith("/")
  )
    throw new Error(
      "Expected apply, status, restore, keep or offline-recovery and an absolute box directory",
    );
  let current = await pending(boxDirectory);
  if (verb === "status") return current?.marker ?? null;
  if (current?.marker === null) {
    await recoverInstalledUpgrade({ boxDirectory, run });
    current = null;
  }
  if (verb === "apply") {
    if (current)
      throw new Error("resolve the upgrade attempt with restore or keep before installing");
    if (prepare.length === 0) throw new Error("apply requires the candidate preparation command");
    await fs.mkdir(`${boxDirectory}.upgrades`, { recursive: true, mode: 0o700 });
    const directory = join(`${boxDirectory}.upgrades`, `${Date.now()}-${randomUUID()}`);
    const candidate = await createUpgradeHost({
      boxDirectory,
      directory,
      run,
      prepareCandidate: async () => JSON.parse((await run(prepare[0], prepare.slice(1))).stdout),
      checkCandidate: () => checkUpgradeCandidate({ boxDirectory, directory, run }),
    });
    return applyUpgrade({
      directory,
      paths: candidate.paths,
      mode: "manual",
      host: candidate.host,
    });
  }
  if (!current) return null;
  const offline = verb === "offline-recovery";
  if (offline) {
    const result = await recoverInstalledUpgrade({ boxDirectory, offline, run });
    await fs.rm(join(current.directory, "check"), { recursive: true, force: true });
    return result;
  }
  if (!offline) await removeUpgradeCheckContainers(current.directory, run);
  await fs.rm(join(current.directory, "check"), { recursive: true, force: true });
  return recoverInstalledUpgrade({
    boxDirectory,
    offline,
    run,
    choice: offline || verb === "recover" ? undefined : verb,
  });
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(JSON.stringify(await runUpgradeCli(process.argv.slice(2))) + "\n");
  } catch (error) {
    process.stderr.write(String(error instanceof Error ? error.message : error) + "\n");
    process.exitCode = 1;
  }
}
