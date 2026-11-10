import { execFileSync } from "node:child_process";
import { lstat, readFile as readText } from "node:fs/promises";
import { HOST_ROOT } from "./disk-key.mjs";

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
