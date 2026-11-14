import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { parseHostRequest, formatHostReply, VERB_PERMISSION } from "./host-protocol.mjs";

const NM = "org.freedesktop.NetworkManager";
const ROOT = "/org/freedesktop/NetworkManager";
export { networkCommand } from "./network-manager.mjs";
import { networkBus, networkCommand, networkRadio } from "./network-manager.mjs";

export async function handleNetworkRequest(line, deps = {}) {
  const parsed = parseHostRequest(line);
  if (!parsed.ok) return JSON.stringify(parsed) + "\n";
  const { verb, actor } = parsed.request;
  if (verb === "network.read") return handleNetworkRead(line, deps);
  if (verb === "network.join") {
    const { acceptNetworkJoin } = await import("./network-change.mjs");
    return acceptNetworkJoin(parsed.request, deps);
  }
  if (verb !== "network.scan")
    return formatHostReply(verb, { ok: false, reason: "unknown_request" });
  const run = deps.run ?? networkCommand({ budget: 12000 });
  try {
    console.error(JSON.stringify({ verb, actor, permission: VERB_PERMISSION[verb] }));
    const readStatus =
      deps.readStatus ??
      (async () => {
        const { createNetworkChange } = await import("./network-change.mjs");
        return createNetworkChange({ run }).status();
      });
    if ((await readStatus()).change?.state === "running")
      return formatHostReply(verb, { ok: false, reason: "busy" });
    const bus = networkBus(run);
    const radio = await networkRadio(bus);
    if (!radio) return formatHostReply(verb, { ok: false, reason: "no_wifi" });
    const [before] = await bus.get(radio.path, `${NM}.Device.Wireless`, "LastScan");
    await run("nmcli", ["--wait", "10", "device", "wifi", "rescan", "ifname", radio.name]);
    const deadline = performance.now() + 10000;
    while ((await bus.get(radio.path, `${NM}.Device.Wireless`, "LastScan"))[0] <= before) {
      if (performance.now() >= deadline) throw new Error("scan deadline");
      await sleep(100);
    }
    const networks = new Map();
    for (const path of await bus.call(radio.path, `${NM}.Device.Wireless`, "GetAllAccessPoints")) {
      const [ssid, signal, wpa, rsn] = await bus.get(
        path,
        `${NM}.AccessPoint`,
        "Ssid",
        "Strength",
        "WpaFlags",
        "RsnFlags",
      );
      if (!Array.isArray(ssid) || ssid.length === 0) continue;
      const ssidHex = Buffer.from(ssid).toString("hex");
      const security = rsn & 0x400 ? "sae" : (wpa | rsn) & 0x100 ? "wpa-psk" : "other";
      if (!networks.has(ssidHex) || networks.get(ssidHex).signal < signal)
        networks.set(ssidHex, { ssidHex, signal, security });
    }
    return formatHostReply(verb, {
      ok: true,
      networks: [...networks.values()]
        .sort((a, b) => b.signal - a.signal || a.ssidHex.localeCompare(b.ssidHex))
        .slice(0, 32),
    });
  } catch {
    return formatHostReply(verb, { ok: false, reason: "host_failed" });
  }
}

export async function handleNetworkRead(
  line,
  {
    run = networkCommand(),
    readStatus = async () => {
      const { createNetworkChange } = await import("./network-change.mjs");
      return createNetworkChange({ run }).status();
    },
  } = {},
) {
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
      ...(await readStatus()),
    });
  } catch {
    return answer({ ok: false, reason: "host_failed" });
  } finally {
    console.error(JSON.stringify(journal));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(await handleNetworkRequest(readFileSync(0, "utf8")));
}
