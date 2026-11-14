import * as fs from "node:fs/promises";
import { Buffer } from "node:buffer";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectEncryptedHostState } from "./disk-start.mjs";
import { networkBus, networkCommand, networkRadio } from "./network-manager.mjs";
import { formatHostReply } from "./host-protocol.mjs";
import { createWifiBootCopyPublisher } from "./wifi-boot-copy.mjs";
import { decideWifiBootCopy } from "./wifi-record.mjs";
import { writeFileDurable } from "./upgrades/transaction.mjs";

const NM = "org.freedesktop.NetworkManager";
const pendingCopy = () => ({ state: "pending", reason: null, failure: null });
const failedCopy = () => ({ state: "failed", reason: null, failure: "io-failed" });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const escaped = (value) => value.replaceAll("\\", "\\\\").replaceAll(" ", "\\s");

export async function inspectNetworkBootMount({
  run = networkCommand(),
  bootRoot = "/boot",
  fstab = "/etc/fstab",
  ownerUid = 0,
} = {}) {
  const lines = (await fs.readFile(fstab, "utf8"))
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"));
  const expected = lines
    .map((line) => line.trim().split(/\s+/))
    .find((row) => row[1] === bootRoot && row[2] === "ext4")?.[0];
  const mount = JSON.parse(
    await run("findmnt", ["--json", "--output", "TARGET,FSTYPE,UUID", "--target", bootRoot]),
  ).filesystems?.[0];
  const stat = await fs.lstat(bootRoot, { bigint: true });
  if (
    !expected?.startsWith("UUID=") ||
    mount?.target !== bootRoot ||
    mount.fstype !== "ext4" ||
    mount.uuid !== expected.slice(5) ||
    !stat.isDirectory() ||
    Number(stat.uid) !== ownerUid ||
    (Number(stat.mode) & 0o022) !== 0 ||
    (await fs.realpath(bootRoot)) !== bootRoot
  )
    throw Error("boot mount unverified");
  return { bootRoot, rootId: `${stat.dev}:${stat.ino}` };
}

export function createNetworkChange({
  run = networkCommand({ budget: 85000 }),
  hostRoot = "/var/lib/waitron-host",
  profilesRoot = "/etc/NetworkManager/system-connections",
  bootRoot = "/boot",
  ownerUid = 0,
  inspect = () => inspectEncryptedHostState({ run }),
  inspectBootMount = () => inspectNetworkBootMount({ run, bootRoot, ownerUid }),
  readBootId = () => fs.readFile("/proc/sys/kernel/random/boot_id", "utf8"),
  log = (entry) => console.error(JSON.stringify(entry)),
} = {}) {
  const statePath = join(hostRoot, "network.json");
  const candidatePath = (state) => join(profilesRoot, `waitron-${state.uuid}.nmconnection`);
  const bus = networkBus(run);
  const publisher = createWifiBootCopyPublisher({ bootRoot, ownerUid, inspectBootMount });
  async function safe(path, directory = false, optional = false) {
    let stat;
    try {
      stat = await fs.lstat(path);
    } catch (error) {
      if (optional && error.code === "ENOENT") return;
      throw error;
    }
    if (
      Number(stat.uid) !== ownerUid ||
      stat.mode & (directory ? 0o022 : 0o077) ||
      (directory ? !stat.isDirectory() : !stat.isFile())
    )
      throw Error("unsafe network path");
  }
  async function identity() {
    await inspect();
    await safe(hostRoot, true);
  }
  async function load() {
    await identity();
    let handle;
    try {
      handle = await fs.open(statePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.uid !== ownerUid || stat.mode & 0o077 || stat.size > 8192)
        throw Error("unsafe network state");
      const value = JSON.parse(await handle.readFile("utf8"));
      if (
        !uuidPattern.test(value.uuid) ||
        (value.previous !== null && !uuidPattern.test(value.previous)) ||
        !["preparing", "queued", "activating", "finished"].includes(value.phase) ||
        typeof value.ifname !== "string" ||
        typeof value.boot !== "string"
      )
        throw Error("invalid network state");
      formatHostReply("network.read", {
        ok: true,
        wired: { connected: false, address: null },
        wifi: { connectedSsidHex: null, savedSsidHex: null },
        change: value.change,
        bootCopy: value.bootCopy,
      });
      return value;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    } finally {
      await handle?.close();
    }
  }
  async function durable(path, value) {
    await identity();
    await safe(path, false, true);
    await safe(`${path}.tmp`, false, true);
    await writeFileDurable(path, value);
  }
  async function save(state) {
    await durable(statePath, state);
  }
  async function removeCandidate(state) {
    const paths = await bus.call(
      "/org/freedesktop/NetworkManager/Settings",
      `${NM}.Settings`,
      "ListConnections",
    );
    for (const path of paths) {
      const settings = await bus.call(path, `${NM}.Settings.Connection`, "GetSettings");
      if (settings.connection.uuid.data === state.uuid) {
        await run("nmcli", ["--wait", "10", "connection", "delete", "uuid", state.uuid]);
        break;
      }
    }
    await safe(candidatePath(state), false, true);
    await fs.rm(candidatePath(state), { force: true });
  }
  async function restore(state) {
    await removeCandidate(state);
    if (state.previous)
      await run("nmcli", [
        "--wait",
        "10",
        "connection",
        "up",
        "uuid",
        state.previous,
        "ifname",
        state.ifname,
      ]);
  }
  async function publish(state) {
    let bootCopy;
    try {
      const radio = await networkRadio(bus);
      if (!radio?.active || radio.connection === "/") throw Error("no active profile");
      const [path] = await bus.get(radio.connection, `${NM}.Connection.Active`, "Connection");
      const settings = await bus.call(path, `${NM}.Settings.Connection`, "GetSettings");
      const wireless = settings["802-11-wireless"];
      const security = settings["802-11-wireless-security"];
      const secrets = security
        ? await bus.call(
            path,
            `${NM}.Settings.Connection`,
            "GetSecrets",
            "s",
            "802-11-wireless-security",
          )
        : {};
      const decision = decideWifiBootCopy({
        kind: "wifi",
        ssidHex: Buffer.from(wireless.ssid.data).toString("hex"),
        keyMgmt: security?.["key-mgmt"]?.data ?? null,
        psk: secrets["802-11-wireless-security"]?.psk?.data ?? null,
        hidden: wireless.hidden?.data ?? false,
      });
      bootCopy = await publisher.publish(decision);
    } catch {
      bootCopy = failedCopy();
    }
    state.bootCopy = bootCopy;
    await save(state);
  }
  return {
    async status() {
      try {
        const state = await load();
        return { change: state?.change ?? null, bootCopy: state?.bootCopy ?? pendingCopy() };
      } catch {
        return { change: null, bootCopy: failedCopy() };
      }
    },
    async accept(fields, actor) {
      let state;
      try {
        await log({ verb: "network.join", actor, permission: "system.manage" });
        const existing = await load();
        if (existing && existing.phase !== "finished") return { ok: false, reason: "busy" };
        const radio = await networkRadio(bus);
        if (!radio) return { ok: false, reason: "no_wifi" };
        let previous = null;
        if (radio.active && radio.connection !== "/") {
          const [path] = await bus.get(radio.connection, `${NM}.Connection.Active`, "Connection");
          previous = (await bus.call(path, `${NM}.Settings.Connection`, "GetSettings")).connection
            .uuid.data;
          if (!uuidPattern.test(previous)) throw Error("invalid previous uuid");
        } else {
          const choices = [];
          for (const path of await bus.call(
            "/org/freedesktop/NetworkManager/Settings",
            `${NM}.Settings`,
            "ListConnections",
          )) {
            const settings = await bus.call(path, `${NM}.Settings.Connection`, "GetSettings");
            const connection = settings.connection;
            if (
              connection?.type?.data !== "802-11-wireless" ||
              (settings["802-11-wireless"]?.mode?.data ?? "infrastructure") !== "infrastructure" ||
              (connection["interface-name"]?.data &&
                connection["interface-name"].data !== radio.name)
            )
              continue;
            choices.push(connection.uuid.data);
          }
          if (choices.length > 1) throw Error("ambiguous saved profiles");
          previous = choices[0] ?? null;
          if (previous !== null && !uuidPattern.test(previous))
            throw Error("invalid previous uuid");
        }
        await safe(profilesRoot, true);
        state = {
          phase: "preparing",
          uuid: randomUUID(),
          previous,
          ifname: radio.name,
          boot: await readBootId(),
          change: { kind: "join", ssidHex: fields.ssidHex, state: "running", reason: null },
          bootCopy: pendingCopy(),
        };
        await save(state);
        const ssid = [...Buffer.from(fields.ssidHex, "hex")].join(";") + ";";
        await durable(
          candidatePath(state),
          `[connection]\nid=Waitron Wi-Fi\nuuid=${state.uuid}\ntype=wifi\nautoconnect=false\n[wifi]\nmode=infrastructure\nssid=${ssid}\nhidden=${fields.hidden}\n[wifi-security]\nkey-mgmt=${fields.keyMgmt}\npsk=${escaped(fields.psk)}\n[ipv4]\nmethod=auto\n[ipv6]\nmethod=auto\n`,
        );
        await run("nmcli", ["connection", "load", candidatePath(state)]);
        state.phase = "queued";
        await save(state);
        await run("systemctl", ["start", "--no-block", "waitron-network-change.service"]);
        return { ok: true };
      } catch {
        if (state) {
          try {
            await restore(state);
            state.phase = "finished";
            state.change.state = "refused";
            state.change.reason = "failed";
            await save(state);
          } catch {
            /* Retain pending recovery when cleanup fails. */
          }
        }
        return { ok: false, reason: "host_failed" };
      }
    },
    async work() {
      const state = await load();
      if (!state) return;
      if (state.phase === "finished") {
        if (state.change.state === "applied") await publish(state);
        return;
      }
      try {
        if (state.phase !== "queued" || state.boot !== (await readBootId()))
          throw Error("interrupted join");
        state.phase = "activating";
        await save(state);
        await run("nmcli", [
          "--wait",
          "60",
          "connection",
          "up",
          "uuid",
          state.uuid,
          "ifname",
          state.ifname,
        ]);
        await run("nmcli", [
          "connection",
          "modify",
          "uuid",
          state.uuid,
          "connection.autoconnect",
          "yes",
        ]);
        if (state.previous)
          await run("nmcli", [
            "connection",
            "modify",
            "uuid",
            state.previous,
            "connection.autoconnect",
            "no",
          ]);
        state.phase = "finished";
        state.change.state = "applied";
        await save(state);
      } catch {
        await restore(state);
        state.phase = "finished";
        state.change.state = "refused";
        state.change.reason = "failed";
        await save(state);
        return;
      }
      await publish(state);
    },
  };
}

export async function acceptNetworkJoin(request, deps = {}) {
  const result = await createNetworkChange({
    ...deps,
    run: deps.run ?? networkCommand({ budget: 12000 }),
  }).accept(request.fields, request.actor);
  return formatHostReply("network.join", result);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await createNetworkChange().work();
  } catch {
    console.error("network.change failed");
    process.exitCode = 1;
  }
}
