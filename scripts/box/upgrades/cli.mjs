import * as fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  checkInstalledUpgradeQuiet,
  createUpgradeHost,
  installedBoxId,
  installedVenueTimeZone,
  recoverInstalledUpgrade,
} from "./host.mjs";
import {
  applyUpgrade,
  offeredUpgradeOutcome,
  upgradeResultPath,
  upgradeStatus,
  writeFileDurable,
} from "./transaction.mjs";
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
const offeredCheckVerb = "check-offered-upgrade";
const offeredApplyVerb = "apply-offered-upgrade";
const windowVerb = "check-upgrade-window";
const readSettingsVerb = "read-upgrade-settings";
const saveSettingsVerb = "save-upgrade-settings";
const defaultSettings = { version: 1, revision: 0, automatic: true, start: "03:00", end: "05:00" };
const settingsFields = ["revision", "automatic", "start", "end"];
const settingsRefusal = (reason) => ({ ok: false, reason });

function hasSettingsFields(value, fields) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field))
  );
}

function validSettings({ revision, automatic, start, end }) {
  if (!Number.isSafeInteger(revision) || revision < 0 || typeof automatic !== "boolean")
    return false;
  if (start === null && end === null) return true;
  const hour = (value) =>
    typeof value === "string" && value.length === 5 && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (!hour(start) || !hour(end)) return false;
  const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return (minutes(end) - minutes(start) + 1440) % 1440 >= 60;
}

async function readUpgradeSettings(file) {
  let value;
  try {
    value = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return defaultSettings;
    throw error;
  }
  if (
    !hasSettingsFields(value, ["version", ...settingsFields]) ||
    value.version !== 1 ||
    !validSettings(value)
  )
    throw new Error("unreadable upgrade settings");
  return value;
}

async function upgradeSettingsCommand(file, edit) {
  let draft;
  if (edit !== undefined) {
    try {
      draft = JSON.parse(edit);
    } catch {
      return settingsRefusal("settings_invalid");
    }
    if (!hasSettingsFields(draft, settingsFields) || !validSettings(draft))
      return settingsRefusal("settings_invalid");
  }
  try {
    const saved = await readUpgradeSettings(file);
    if (draft === undefined) return { ok: true, result: saved };
    if (draft.revision !== saved.revision || saved.revision === Number.MAX_SAFE_INTEGER)
      return settingsRefusal("settings_stale");
    const result = { version: 1, ...draft, revision: saved.revision + 1 };
    await writeFileDurable(file, result);
    return { ok: true, result };
  } catch {
    return settingsRefusal("host_failed");
  }
}
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

async function selectOffer(boxDirectory, installedVersion, trustDirectory, readOffer, run) {
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
    selected = selector.selectUpgradeOffer(await readOffer(), keys, {
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

async function checkUpgradeOffer(
  boxDirectory,
  installedVersion,
  trustDirectory,
  stagedOffer,
  run,
  offeredInstall,
) {
  try {
    if (await pending(boxDirectory)) return deferred("upgrade-pending");
  } catch {
    return deferred("upgrade-pending");
  }
  if (offeredInstall) {
    try {
      await checkUpgradeWindow(boxDirectory, run, true);
      await checkInstalledUpgradeQuiet(boxDirectory, run);
    } catch (error) {
      return deferred(error.message);
    }
  }
  return selectOffer(
    boxDirectory,
    installedVersion,
    trustDirectory,
    () => fs.readFile(stagedOffer),
    run,
  );
}

async function checkUpgradeWindow(boxDirectory, run, offeredInstall = false) {
  let saved;
  try {
    saved = await readUpgradeSettings(`${boxDirectory}.upgrade-settings.json`);
  } catch {
    throw new Error("upgrade check skipped: the saved upgrade settings are unreadable");
  }
  if (offeredInstall) {
    if (!saved.automatic) throw new Error("automatic upgrades are paused");
    if (saved.start === null) throw new Error("automatic upgrade hours are cleared");
  }
  const start = saved.start ?? defaultSettings.start;
  const end = saved.end ?? defaultSettings.end;
  let timeZone;
  try {
    timeZone = await installedVenueTimeZone(boxDirectory, run);
  } catch {
    throw new Error("upgrade check skipped: could not read the venue time zone");
  }
  if (timeZone === undefined || timeZone === "")
    throw new Error("upgrade check skipped: the venue time zone is missing");
  const invalid = "upgrade check skipped: the saved venue time zone is invalid";
  if (typeof timeZone !== "string") throw new Error(invalid);
  const now = Date.now();
  let local;
  try {
    local = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(timeZone);
  } catch {
    throw new Error(invalid);
  }
  if (/^[+-]/.test(local.timeZoneId)) throw new Error(invalid);

  const today = local.toPlainDate();
  const crossesMidnight = end < start;
  const days = crossesMidnight ? [today, today.subtract({ days: 1 })] : [today];
  for (const day of days) {
    const endDay = crossesMidnight ? day.add({ days: 1 }) : day;
    const endpoint = (date, time) =>
      date.toPlainDateTime(time).toZonedDateTime(timeZone, { disambiguation: "reject" })
        .epochMilliseconds;
    let startMs, endMs;
    try {
      startMs = endpoint(day, start);
      endMs = endpoint(endDay, end);
    } catch {
      continue; // A missing or repeated endpoint gives that occurrence no single window.
    }
    if (now >= startMs && now < endMs && (!offeredInstall || now <= endMs - 30 * 60_000)) return;
  }
  if (offeredInstall)
    throw new Error("outside the offered upgrade start window in the venue time zone");
  throw new Error(`upgrade check skipped: outside ${start}–${end} in the venue time zone`);
}

class OfferedUpgradeDeferred extends Error {}

export async function recheckOfferedUpgrade(
  boxDirectory,
  installedVersion,
  target,
  trustDirectory,
  run,
) {
  const bytes = await downloadUpgradeOffer(run);
  if (bytes === null) throw new OfferedUpgradeDeferred("offer-download-failed");
  const offer = await selectOffer(boxDirectory, installedVersion, trustDirectory, () => bytes, run);
  if (offer.status === "deferred") throw new OfferedUpgradeDeferred(offer.reason);
  if (offer.version !== target) throw new OfferedUpgradeDeferred("offer-changed");
  try {
    await checkUpgradeWindow(boxDirectory, run, true);
  } catch (error) {
    throw new OfferedUpgradeDeferred(error.message);
  }
}

// Upgrade writes hold <box>.upgrade.lock. The host socket serialises settings saves separately.
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
      offeredCheckVerb,
      offeredApplyVerb,
      windowVerb,
      readSettingsVerb,
      saveSettingsVerb,
      downloadOfferVerb,
    ].includes(verb) ||
    !boxDirectory?.startsWith("/")
  )
    throw new Error(
      "Expected apply, status, restore, keep or offline-recovery, or check-upgrade-offer, and an absolute box directory",
    );
  if (verb === readSettingsVerb || verb === saveSettingsVerb) {
    if (prepare.length !== (verb === saveSettingsVerb ? 1 : 0))
      return settingsRefusal("settings_invalid");
    return upgradeSettingsCommand(`${boxDirectory}.upgrade-settings.json`, prepare[0]);
  }
  if (verb === windowVerb) return checkUpgradeWindow(boxDirectory, run);
  if (verb === downloadOfferVerb) return downloadUpgradeOffer(run);
  if (verb === offerVerb || verb === offeredCheckVerb)
    return checkUpgradeOffer(
      boxDirectory,
      prepare[0],
      prepare[1],
      prepare[2],
      run,
      verb === offeredCheckVerb,
    );
  const automatic = verb === offeredApplyVerb;
  let current = await pending(boxDirectory);
  if (verb === "status") return current?.marker ?? null;
  if (automatic && current) return deferred("upgrade-pending");
  if (current?.marker === null) {
    await recoverInstalledUpgrade({ boxDirectory, run });
    current = null;
  }
  if (verb === "apply" || automatic) {
    if (current)
      throw new Error("resolve the upgrade attempt with restore or keep before installing");
    const [installedVersion, target, trustDirectory] = automatic ? prepare.splice(0, 3) : [];
    if (prepare.length === 0) throw new Error("apply requires the candidate preparation command");
    await fs.mkdir(`${boxDirectory}.upgrades`, { recursive: true, mode: 0o700 });
    const directory = join(`${boxDirectory}.upgrades`, `${Date.now()}-${randomUUID()}`);
    const candidate = await createUpgradeHost({
      boxDirectory,
      directory,
      run,
      prepareCandidate: async () => JSON.parse((await run(prepare[0], prepare.slice(1))).stdout),
      checkCandidate: () => checkUpgradeCandidate({ boxDirectory, directory, run }),
      beforeAutomaticStop: automatic
        ? () => recheckOfferedUpgrade(boxDirectory, installedVersion, target, trustDirectory, run)
        : undefined,
    });
    try {
      const marker = await applyUpgrade({
        directory,
        paths: candidate.paths,
        mode: automatic ? "automatic" : "manual",
        host: candidate.host,
        ...(automatic
          ? {
              versions: { fromVersion: installedVersion, toVersion: target },
              resultPath: upgradeResultPath(boxDirectory),
            }
          : {}),
      });
      if (!automatic) return marker;
      const status = offeredUpgradeOutcome(marker);
      return status === "upgraded" ? { status } : { status, reason: marker.failure };
    } catch (error) {
      if (error instanceof OfferedUpgradeDeferred) return deferred(error.message);
      throw error;
    }
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

export async function runUpgradeCliMain(args, { stdout, stderr, run } = process) {
  try {
    const result = await runUpgradeCli(args, { run });
    if (args[0] === windowVerb) return 0;
    if (args[0] === downloadOfferVerb && result === null) return 1;
    stdout.write(args[0] === downloadOfferVerb ? result : JSON.stringify(result) + "\n");
    if (args[0] === readSettingsVerb && !result.ok) return 1;
    return [offerVerb, offeredCheckVerb, offeredApplyVerb].includes(args[0]) &&
      result.status === "deferred"
      ? 1
      : 0;
  } catch (error) {
    stderr.write(String(error instanceof Error ? error.message : error) + "\n");
    return 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await runUpgradeCliMain(process.argv.slice(2));
