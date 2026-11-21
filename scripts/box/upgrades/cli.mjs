import * as fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createUpgradeHost, installedBoxId, recoverInstalledUpgrade } from "./host.mjs";
import { applyUpgrade, upgradeStatus, writeFileDurable } from "./transaction.mjs";
import { checkUpgradeCandidate, removeUpgradeCheckContainers } from "./candidate.mjs";

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const command = (file, args, input, options = {}) => {
  const result = execute(file, args, { maxBuffer: 4 * 1024 * 1024, ...options });
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

const offerVerb = "check-upgrade-offer";
const downloadOfferVerb = "download-upgrade-offer";
const deferred = (reason) => ({ status: "deferred", reason });
const offerUrl =
  "https://github.com/clintongormley/waitron/releases/download/upgrade-offer/waitron-offer.json";

async function readOfferState(path) {
  let state;
  try {
    state = JSON.parse(await fs.readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (
    !Number.isSafeInteger(state?.serial) ||
    state.serial < 1 ||
    typeof state.digest !== "string" ||
    state.digest.length !== 64 ||
    !/^[a-f0-9]+$/.test(state.digest)
  )
    throw new Error("Invalid saved upgrade offer state");
  return state;
}

async function downloadUpgradeOffer(run) {
  const limit = 16 * 1024;
  try {
    const { stdout } = await run(
      "curl",
      [
        "-q",
        "-fsSL",
        "--proto",
        "=https",
        "--proto-redir",
        "=https",
        "--connect-timeout",
        "15",
        "--max-time",
        "60",
        "--max-filesize",
        String(limit),
        offerUrl,
      ],
      undefined,
      { encoding: "buffer", maxBuffer: limit },
    );
    return stdout;
  } catch {
    return null;
  }
}

async function checkUpgradeOffer(boxDirectory, installedVersion, trustDirectory, stagedOffer, run) {
  try {
    if (await pending(boxDirectory)) return deferred("upgrade-pending");
  } catch {
    return deferred("upgrade-pending");
  }

  let boxId;
  try {
    boxId = await installedBoxId(boxDirectory, run);
  } catch {
    return deferred("box-id-unavailable");
  }
  if (!boxId) return deferred("box-id-unavailable");

  let selector, keys;
  try {
    if (!(await fs.lstat(trustDirectory)).isSymbolicLink()) return deferred("trust-unavailable");
    const trust = await fs.realpath(trustDirectory);
    selector = require(join(trust, "release-list.mjs"));
    keys = await Promise.all(
      ["current.pem", "spare.pem"].map((key) => fs.readFile(join(trust, key), "utf8")),
    );
  } catch {
    return deferred("trust-unavailable");
  }
  if (!selector.isNumberedVersion(installedVersion))
    return deferred("installed-version-unavailable");

  const state = `${boxDirectory}.upgrade-offer.json`;
  let previous;
  try {
    previous = await readOfferState(state);
  } catch {
    return deferred("offer-state-unreadable");
  }

  let selected;
  try {
    selected = selector.selectUpgradeOffer(await fs.readFile(stagedOffer), keys, {
      boxId,
      installedVersion,
      previous,
    });
  } catch {
    return deferred("invalid-offer");
  }
  const { version, serial, digest } = selected;
  if (serial !== previous?.serial) {
    try {
      await writeFileDurable(state, { serial, digest });
    } catch {
      return deferred("offer-state-unwritable");
    }
  }
  return version ? { status: "offered", version } : { status: "none" };
}

// Mutating callers hold <box>.upgrade.lock; status takes no lock and writes nothing.
export async function runUpgradeCli([verb, boxDirectory, ...prepare], { run = command } = {}) {
  if (
    ![
      "apply",
      "status",
      "restore",
      "keep",
      "recover",
      "offline-recovery",
      offerVerb,
      downloadOfferVerb,
    ].includes(verb) ||
    !boxDirectory?.startsWith("/")
  )
    throw new Error(
      "Expected apply, status, restore, keep or offline-recovery, or check-upgrade-offer, and an absolute box directory",
    );
  if (verb === downloadOfferVerb) return downloadUpgradeOffer(run);
  if (verb === offerVerb)
    return checkUpgradeOffer(boxDirectory, prepare[0], prepare[1], prepare[2], run);
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

export async function runUpgradeCliMain(args, { stdout, stderr } = process) {
  try {
    const result = await runUpgradeCli(args);
    if (args[0] === downloadOfferVerb && result === null) return 1;
    stdout.write(args[0] === downloadOfferVerb ? result : JSON.stringify(result) + "\n");
    return args[0] === offerVerb && result.status === "deferred" ? 1 : 0;
  } catch (error) {
    stderr.write(String(error instanceof Error ? error.message : error) + "\n");
    return 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await runUpgradeCliMain(process.argv.slice(2));
