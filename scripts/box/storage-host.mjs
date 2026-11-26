import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  STORAGE_DRIVES_MAX,
  VERB_PERMISSION,
  formatHostReply,
  parseHostRequest,
} from "./host-protocol.mjs";

export const DRIVES_ROOT = "/run/waitron-drives";
const STATE_DIR = "/run/waitron-box-state";
const MOUNT_LIMIT_MS = 5000;
const MOUNT_OPTIONS = "ro,nosuid,nodev,noexec,noatime,nosymfollow,fmask=0133,dmask=0022";
const MOUNT_TYPES = Object.freeze({ vfat: "vfat", exfat: "exfat", ntfs: "ntfs3" });
const DRIVE_NAME = /^sd[a-z]{1,3}[0-9]{0,3}$/;
const HOLDER_TYPE = /^(crypt|lvm|raid)/;
const HOLDER_FSTYPES = Object.freeze(["crypto_LUKS", "LVM2_member", "linux_raid_member"]);

export function storageCommand({ now = () => performance.now(), exec = execFileSync } = {}) {
  const deadline = now() + 12_000;
  return (command, args, limit = Infinity) => {
    const remaining = Math.floor(deadline - now());
    if (remaining <= 0) throw new Error("storage deadline");
    return exec(command, args, {
      encoding: "utf8",
      timeout: Math.min(remaining, limit),
      killSignal: "SIGKILL",
      env: { ...process.env, LC_ALL: "C" },
    });
  };
}

/**
 * The drives USB disks offer, by kernel name, with what identifies each one now.
 * @param {Record<string, any>[]} rows lsblk's flat list, each row naming its parent
 */
function usbDrives(rows, root) {
  /** @type {Map<string, Record<string, any>[]>} */
  const below = new Map();
  for (const row of rows) {
    if (row.pkname !== null) below.set(row.pkname, [...(below.get(row.pkname) ?? []), row]);
  }
  /** @param {Record<string, any>} row @returns {Record<string, any>[]} */
  const family = (row) => [row, ...(below.get(row.kname) ?? []).flatMap(family)];
  const drives = [];
  for (const disk of rows) {
    if (disk.type !== "disk" || disk.tran !== "usb") continue;
    const all = family(disk);
    const holder = all.some(
      (entry) => HOLDER_TYPE.test(entry.type) || HOLDER_FSTYPES.includes(entry.fstype),
    );
    const mountedElsewhere = all.some((entry) =>
      (entry.mountpoints ?? []).some((point) => point !== null && dirname(point) !== root),
    );
    if (holder || mountedElsewhere) continue;
    const parts = (below.get(disk.kname) ?? []).filter((entry) => entry.type === "part");
    for (const entry of parts.length > 0 ? parts : [disk]) {
      if (!entry.fstype || !DRIVE_NAME.test(entry.kname)) continue;
      drives.push({
        drive: entry.kname,
        type: Object.hasOwn(MOUNT_TYPES, entry.fstype) ? entry.fstype : null,
        device: entry["maj:min"],
        uuid: entry.uuid,
      });
    }
  }
  return drives.sort((a, b) => (a.drive < b.drive ? -1 : 1)).slice(0, STORAGE_DRIVES_MAX);
}

/** @returns {{ target: string, device: string }[]} the mounts directly inside the drive folder */
function driveMounts(run, root) {
  const { filesystems } = JSON.parse(
    run("findmnt", ["--json", "--list", "--output", "TARGET,MAJ:MIN"]),
  );
  return filesystems
    .filter((mount) => dirname(mount.target) === root)
    .map((mount) => ({ target: mount.target, device: mount["maj:min"] }));
}

/** @returns {boolean} whether the target is no longer mounted */
function unmount(run, target) {
  for (const args of [[target], ["-l", target]]) {
    try {
      run("umount", args);
      removeFolder(target);
      return true;
    } catch {
      // Tried lazily next, then left for the caller to report.
    }
  }
  return false;
}

function removeFolder(target) {
  try {
    rmdirSync(target);
  } catch {
    // Already gone, or holding a mount the kernel finished after its command timed out, which
    // the next list unmounts because no record names it.
  }
}

function readRecord(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function writeRecord(path, record) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(`${path}.new`, JSON.stringify(record), { mode: 0o600 });
  renameSync(`${path}.new`, path);
}

function list(run, root, recordPath) {
  const { blockdevices } = JSON.parse(
    run("lsblk", [
      "--json",
      "--list",
      "--output",
      "KNAME,PKNAME,TYPE,TRAN,FSTYPE,UUID,MAJ:MIN,MOUNTPOINTS",
    ]),
  );
  const drives = usbDrives(blockdevices, root);
  const record = readRecord(recordPath);
  /** @type {Record<string, string>} file-system id by drive name */
  const kept = {};
  let stuck = false;
  for (const mount of driveMounts(run, root)) {
    const name = mount.target.slice(root.length + 1);
    const drive = drives.find((entry) => entry.drive === name);
    const known = Object.hasOwn(record, name) ? record[name] : undefined;
    const same =
      drive?.type && drive.uuid != null && drive.device === mount.device && known === drive.uuid;
    if (same) kept[name] = drive.uuid;
    else if (!unmount(run, mount.target)) stuck = true;
  }
  if (stuck) throw new Error("a drive would not unmount");
  mkdirSync(root, { recursive: true, mode: 0o755 });
  const mounted = { ...kept };
  const answer = drives.map(({ drive, type, uuid }) => {
    if (type === null) return { drive, fileSystem: "other", readable: false };
    if (Object.hasOwn(kept, drive)) return { drive, fileSystem: type, readable: true };
    const target = join(root, drive);
    mkdirSync(target, { recursive: true, mode: 0o755 });
    try {
      run(
        "mount",
        ["-t", MOUNT_TYPES[type], "-o", MOUNT_OPTIONS, `/dev/${drive}`, target],
        MOUNT_LIMIT_MS,
      );
    } catch {
      removeFolder(target);
      return { drive, fileSystem: type, readable: false };
    }
    mounted[drive] = uuid;
    return { drive, fileSystem: type, readable: true };
  });
  writeRecord(recordPath, mounted);
  return { ok: true, drives: answer };
}

function release(run, root, recordPath) {
  const mounts = driveMounts(run, root);
  const record = readRecord(recordPath);
  /** @type {Record<string, string>} */
  const still = {};
  let stuck = false;
  for (const mount of mounts) {
    if (unmount(run, mount.target)) continue;
    stuck = true;
    const name = mount.target.slice(root.length + 1);
    if (Object.hasOwn(record, name)) still[name] = record[name];
  }
  writeRecord(recordPath, still);
  if (stuck) throw new Error("a drive would not unmount");
  return { ok: true, released: mounts.length };
}

export async function handleStorageRequest(
  line,
  {
    run = storageCommand(),
    root = DRIVES_ROOT,
    stateDir = STATE_DIR,
    log = (entry) => console.error(JSON.stringify(entry)),
  } = {},
) {
  const parsed = parseHostRequest(line);
  if (!parsed.ok) return `${JSON.stringify(parsed)}\n`;
  const { verb, actor } = parsed.request;
  if (verb !== "storage.list" && verb !== "storage.release")
    return formatHostReply(verb, { ok: false, reason: "unknown_request" });
  try {
    log({ verb, actor, permission: actor.source === "person" ? VERB_PERMISSION[verb] : null });
    const recordPath = join(stateDir, "storage-mounts.json");
    return formatHostReply(
      verb,
      verb === "storage.list" ? list(run, root, recordPath) : release(run, root, recordPath),
    );
  } catch {
    return formatHostReply(verb, { ok: false, reason: "host_failed" });
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(await handleStorageRequest(readFileSync(0, "utf8")));
  } catch {
    process.stdout.write('{"ok":false,"reason":"host_failed"}\n');
  }
}
