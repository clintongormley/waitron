import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { lstat, readFile as readText } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { diskRecoveryKeyPassphrase } from "./disk-recovery-key.mjs";
import { HOST_ROOT, createDiskRecoveryStore } from "./disk-key.mjs";

/**
 * @param {{keySlots:number, tpmSlots:number, emptyPassword:boolean, openedBy:string|null}} state
 * @returns {'enroll'|'remove-empty'|'ready'}
 */
export function diskStartupAction(state) {
  if (
    state.keySlots === 1 &&
    state.tpmSlots === 0 &&
    state.emptyPassword === true &&
    state.openedBy === "bootstrap"
  )
    return "enroll";
  if (state.tpmSlots === 1 && state.openedBy === "chip") {
    if (state.keySlots === 3 && state.emptyPassword === true) return "remove-empty";
    if (state.keySlots === 2 && state.emptyPassword === false) return "ready";
  }
  throw Object.assign(new Error("disk_start.refused"), { code: "disk_start.refused" });
}

/**
 * @param {{hostRoot?:string, run?:(command:string, args:string[])=>Promise<string>, readFile?:(path:string, encoding:string)=>Promise<string>}} [deps]
 * @returns {Promise<import('./disk-key.mjs').HostStateIdentity>}
 */
export async function inspectEncryptedHostState({
  hostRoot = HOST_ROOT,
  run = async (command, args) =>
    execFileSync(command, args, {
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, LC_ALL: "C" },
    }),
  readFile = readText,
} = {}) {
  const refuse = () => {
    throw Object.assign(new Error("disk_start.refused"), { code: "disk_start.refused" });
  };
  const mount = async (path) =>
    JSON.parse(
      await run("findmnt", [
        "--json",
        "--output",
        "TARGET,SOURCE,FSTYPE,FSROOT,UUID",
        "--target",
        path,
      ]),
    ).filesystems?.[0];
  const root = await mount("/");
  const host = await mount(hostRoot);
  const expectedRoot = (await readFile("/etc/waitron-dev-root", "utf8")).trim();
  const expectedDisk = (await readFile("/etc/waitron-dev-luks", "utf8")).trim();
  const source = (value) => (typeof value === "string" ? value.split("[")[0] : "");
  if (
    !root ||
    !host ||
    root.target !== "/" ||
    host.target !== hostRoot ||
    root.fstype !== "btrfs" ||
    host.fstype !== "btrfs" ||
    root.fsroot !== "/@rootfs" ||
    host.fsroot !== "/@host-state" ||
    !expectedRoot ||
    root.uuid !== expectedRoot ||
    host.uuid !== expectedRoot ||
    !source(root.source) ||
    source(root.source) !== source(host.source)
  )
    refuse();
  const status = await run("cryptsetup", ["status", source(root.source)]);
  const backing = /^\s*device:\s*(\/\S+)\s*$/m.exec(status)?.[1];
  if (!backing) refuse();
  const diskUuid = (await run("cryptsetup", ["luksUUID", backing])).trim();
  if (!expectedDisk || diskUuid !== expectedDisk) refuse();
  const stat = await lstat(hostRoot, { bigint: true });
  return { hostRoot, diskUuid, rootId: `${stat.dev}:${stat.ino}` };
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {Uint8Array} [secret]
 * @param {{runRoot?:string, statfs?:typeof fs.statfs}} [options]
 */
export async function runDiskCommand(
  command,
  args,
  secret,
  { runRoot = "/run", statfs = fs.statfs } = {},
) {
  let folder, handle, emptyHandle, failure;
  let answer;
  const refused = () =>
    Object.assign(new Error("disk_start.refused"), { code: "disk_start.refused" });
  try {
    if (secret) {
      if (Number((await statfs(runRoot)).type) !== 0x01021994) throw refused();
      folder = await fs.mkdtemp(`${runRoot}/waitron-disk-key-`);
      const path = `${folder}/passphrase`;
      await fs.writeFile(path, secret, { mode: 0o600, flag: "wx" });
      handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      await fs.writeFile(`${folder}/empty`, "", { mode: 0o600, flag: "wx" });
      emptyHandle = await fs.open(`${folder}/empty`, constants.O_RDONLY | constants.O_NOFOLLOW);
    }
    const result = spawnSync(command, args, {
      encoding: "utf8",
      timeout: 60000,
      env: { ...process.env, LC_ALL: "C" },
      stdio: handle
        ? ["ignore", "pipe", "pipe", handle.fd, emptyHandle.fd]
        : ["ignore", "pipe", "pipe"],
    });
    answer = { status: result.status ?? 1, stdout: result.stdout ?? "" };
  } catch {
    failure = refused();
  } finally {
    secret?.fill(0);
    try {
      await handle?.close();
      await emptyHandle?.close();
      if (folder) await fs.rm(folder, { recursive: true, force: true });
    } catch {
      failure = refused();
    }
  }
  if (failure) throw failure;
  return answer;
}

export async function startDisk({
  checkOnly = false,
  report = () => {},
  hostRoot = HOST_ROOT,
  ownerUid = 0,
  inspect = () => inspectEncryptedHostState({ hostRoot }),
  command = runDiskCommand,
  openedBy = () => readDiskOpening({ ownerUid }),
} = {}) {
  const refused = () =>
    Object.assign(new Error("disk_start.refused"), { code: "disk_start.refused" });
  const { diskUuid } = await inspect();
  const device = `/dev/disk/by-uuid/${diskUuid}`;
  const checked = async (name, args, secret) => {
    try {
      const result = await command(name, args, secret);
      report({ command: name, operation: args[0], status: result.status });
      if (result.status !== 0) throw refused();
      return result.stdout;
    } finally {
      secret?.fill(0);
    }
  };
  const readState = async () => {
    const metadata = JSON.parse(
      await checked("cryptsetup", ["luksDump", "--dump-json-metadata", device]),
    );
    const tokens = Object.values(metadata.tokens).filter((token) => token.type === "systemd-tpm2");
    const secret = new Uint8Array();
    const { status } = await command(
      "cryptsetup",
      ["open", "--test-passphrase", "--key-file", "/proc/self/fd/3", device],
      secret,
    );
    if (status !== 0 && status !== 2) throw refused();
    return {
      keySlots: Object.keys(metadata.keyslots).length,
      tpmSlots: tokens.length,
      emptyPassword: status === 0,
      openedBy: await openedBy(),
      tpmPcrs: tokens[0]?.["tpm2-pcrs"] ?? [],
    };
  };
  const store = createDiskRecoveryStore({ hostRoot, ownerUid, inspectHostState: inspect });
  let state = await readState();
  const action = diskStartupAction(state);
  if (checkOnly && action !== "ready") throw refused();
  if (action === "enroll") {
    const key = randomBytes(32);
    try {
      await store.store({ diskUuid, key });
      await checked(
        "cryptsetup",
        ["luksAddKey", "--key-file", "/proc/self/fd/4", device, "/proc/self/fd/3"],
        diskRecoveryKeyPassphrase(key),
      );
      await checked(
        "systemd-cryptenroll",
        [
          "--unlock-key-file=/proc/self/fd/3",
          "--tpm2-device=auto",
          "--tpm2-pcrs=5+7+8+9+15:sha256=0000000000000000000000000000000000000000000000000000000000000000",
          device,
        ],
        diskRecoveryKeyPassphrase(key),
      );
    } finally {
      key.fill(0);
    }
    report({ action: "restart", diskUuid });
    await checked("systemctl", ["reboot", "--no-block"]);
    return { action: "restart", diskUuid };
  }
  await store.withKey({ diskUuid }, async (key) => {
    await checked(
      "cryptsetup",
      ["open", "--test-passphrase", "--key-file", "/proc/self/fd/3", device],
      diskRecoveryKeyPassphrase(key),
    );
    if (action === "remove-empty")
      await checked(
        "systemd-cryptenroll",
        ["--unlock-key-file=/proc/self/fd/3", "--wipe-slot=empty", device],
        diskRecoveryKeyPassphrase(key),
      );
  });
  state = await readState();
  if (diskStartupAction(state) !== "ready") throw refused();
  return { action: "ready", diskUuid, ...state };
}

export async function readDiskOpening({ path = "/run/waitron-disk-opened", ownerUid = 0 } = {}) {
  const handle = await fs.open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== ownerUid || (stat.mode & 0o077) !== 0 || stat.size > 16)
      throw Object.assign(new Error("disk_start.refused"), { code: "disk_start.refused" });
    const text = await handle.readFile("utf8");
    return text === "chip\n" ? "chip" : text === "bootstrap\n" ? "bootstrap" : null;
  } finally {
    await handle.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  try {
    if (process.getuid() !== 0 || !["prepare", "check"].includes(mode))
      throw Object.assign(new Error("disk_start.refused"), { code: "disk_start.refused" });
    const result = await startDisk({
      checkOnly: mode === "check",
      report:
        mode === "prepare"
          ? (value) => console.log(`B3_DISK_START:${JSON.stringify(value)}`)
          : undefined,
    });
    if (mode === "check") console.log(JSON.stringify(result));
    else if (result.action === "ready") console.log(`B3_DISK_START:${JSON.stringify(result)}`);
  } catch (error) {
    console.error("disk_start.refused", {
      code: error.code,
      reason: error.reason,
      kind: error.name,
    });
    process.exitCode = 1;
  }
}
