import { execFileSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { parseHostRequest, formatHostReply, VERB_PERMISSION } from "./host-protocol.mjs";
import { wifiBootCopyStatus } from "./wifi-boot-copy.mjs";

const NM = "org.freedesktop.NetworkManager";
const ROOT = "/org/freedesktop/NetworkManager";

export function networkCommand({ now = () => performance.now(), exec = execFileSync } = {}) {
  const deadline = now() + 3000;
  return (command, args) => {
    const remaining = Math.floor(deadline - now());
    if (remaining <= 0) throw new Error("network deadline");
    return exec(command, args, {
      encoding: "utf8",
      timeout: remaining,
      maxBuffer: 65536,
      // execFileSync otherwise echoes a failed command's stderr before throwing.
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LC_ALL: "C" },
    });
  };
}

export async function handleNetworkRead(line, { run = networkCommand() } = {}) {
  const answer = (reply) => formatHostReply("network.read", reply);
  const parsed = parseHostRequest(line);
  if (!parsed.ok) return answer({ ok: false, reason: parsed.reason });
  if (parsed.request.verb !== "network.read")
    return answer({ ok: false, reason: "unknown_request" });
  const journal = {
    verb: "network.read",
    actor: parsed.request.actor,
    permission: parsed.request.actor.source === "person" ? VERB_PERMISSION["network.read"] : null,
  };
  try {
    const bus = async (...args) =>
      String(await run("busctl", ["--system", "--json=short", ...args]));
    const call = async (path, iface, method) =>
      JSON.parse(await bus("call", NM, path, iface, method)).data[0];
    const get = async (path, iface, ...names) => {
      const rows = (await bus("get-property", NM, path, iface, ...names))
        .trim()
        .split("\n")
        .map((row) => JSON.parse(row));
      if (rows.length !== names.length) throw new Error("incomplete properties");
      return rows.map((row) => row.data);
    };
    const paths = await call(ROOT, NM, "GetDevices");
    const devices = [];
    for (const path of paths) {
      const [type, state, name, ip4, ip6, connection] = await get(
        path,
        `${NM}.Device`,
        "DeviceType",
        "State",
        "Interface",
        "Ip4Config",
        "Ip6Config",
        "ActiveConnection",
      );
      devices.push({ path, type, connected: state === 100, name, ip4, ip6, connection });
    }
    const ethernet = devices
      .filter((device) => device.type === 1)
      .sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name))[0];
    let address = null;
    if (ethernet?.connected) {
      const addresses = [];
      for (const [path, version] of [
        [ethernet.ip4, 4],
        [ethernet.ip6, 6],
      ]) {
        if (path === "/") continue;
        const [data] = await get(path, `${NM}.IP${version}Config`, "AddressData");
        addresses.push(
          ...data
            .map((entry) => entry.address.data)
            .filter(
              (value) => isIP(value) === version && !/^169\.254\.|^fe[89ab][0-9a-f]:/i.test(value),
            ),
        );
      }
      address = addresses[0] ?? null;
    }
    let connectedSsidHex = null,
      activeProfile = null;
    for (const radio of devices
      .filter((device) => device.type === 2 && device.connected)
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const [mode, accessPoint] = await get(
        radio.path,
        `${NM}.Device.Wireless`,
        "Mode",
        "ActiveAccessPoint",
      );
      if (mode !== 2 || accessPoint === "/") continue;
      const [ssid] = await get(accessPoint, `${NM}.AccessPoint`, "Ssid");
      connectedSsidHex = Buffer.from(ssid).toString("hex");
      if (radio.connection !== "/")
        [activeProfile] = await get(radio.connection, `${NM}.Connection.Active`, "Connection");
      break;
    }
    const profiles = [];
    for (const path of await call(`${ROOT}/Settings`, `${NM}.Settings`, "ListConnections")) {
      const settings = await call(path, `${NM}.Settings.Connection`, "GetSettings");
      const wireless = settings["802-11-wireless"];
      if (
        settings.connection?.type?.data !== "802-11-wireless" ||
        !wireless ||
        (wireless.mode?.data ?? "infrastructure") !== "infrastructure"
      )
        continue;
      profiles.push({ path, ssid: Buffer.from(wireless.ssid.data).toString("hex") });
    }
    const distinct = [...new Set(profiles.map((profile) => profile.ssid))];
    // Null means there is no single normal profile to name; it does not invalidate other observations.
    const savedSsidHex =
      profiles.find((profile) => profile.path === activeProfile)?.ssid ??
      (distinct.length === 1 ? distinct[0] : null);
    if (distinct.length > 1 && savedSsidHex === null) journal.ambiguousProfiles = true;
    return answer({
      ok: true,
      wired: { connected: ethernet?.connected ?? false, address },
      wifi: { connectedSsidHex, savedSsidHex },
      change: null,
      bootCopy: wifiBootCopyStatus(),
    });
  } catch {
    return answer({ ok: false, reason: "host_failed" });
  } finally {
    console.error(JSON.stringify(journal));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(await handleNetworkRead(readFileSync(0, "utf8")));
}
