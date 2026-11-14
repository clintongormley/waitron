import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const NM = "org.freedesktop.NetworkManager";
const ROOT = "/org/freedesktop/NetworkManager";

export function networkCommand({
  now = () => performance.now(),
  exec = execFileSync,
  budget = 3000,
} = {}) {
  const deadline = now() + budget;
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

export function networkBus(run) {
  const bus = async (...args) => String(await run("busctl", ["--system", "--json=short", ...args]));
  return {
    async call(path, iface, method, ...args) {
      return JSON.parse(await bus("call", NM, path, iface, method, ...args)).data[0];
    },
    async get(path, iface, ...names) {
      const rows = (await bus("get-property", NM, path, iface, ...names))
        .trim()
        .split("\n")
        .map(JSON.parse);
      if (rows.length !== names.length) throw new Error("incomplete properties");
      return rows.map((row) => row.data);
    },
  };
}

export async function networkDevices(bus) {
  const devices = [];
  for (const path of await bus.call(ROOT, NM, "GetDevices")) {
    const [type, state, name, ip4, ip6, connection] = await bus.get(
      path,
      `${NM}.Device`,
      "DeviceType",
      "State",
      "Interface",
      "Ip4Config",
      "Ip6Config",
      "ActiveConnection",
    );
    devices.push({ path, type, state, name, ip4, ip6, connection });
  }
  return devices;
}

export async function networkRadio(bus, devices) {
  const radios = [];
  for (const device of devices ?? (await networkDevices(bus))) {
    if (device.type !== 2) continue;
    const [mode, accessPoint] = await bus.get(
      device.path,
      `${NM}.Device.Wireless`,
      "Mode",
      "ActiveAccessPoint",
    );
    if (mode === 3) continue;
    radios.push({ ...device, accessPoint, active: device.state === 100 && mode === 2 });
  }
  const active = radios.filter((radio) => radio.active);
  const choices = active.length ? active : radios;
  if (choices.length > 1) throw new Error("ambiguous radio");
  return choices[0] ?? null;
}

export async function networkProfile(bus, radio) {
  const infrastructure = (settings) =>
    settings.connection?.type?.data === "802-11-wireless" &&
    (settings["802-11-wireless"]?.mode?.data ?? "infrastructure") === "infrastructure";
  if (radio?.active && radio.connection !== "/") {
    const [path] = await bus.get(radio.connection, `${NM}.Connection.Active`, "Connection");
    const settings = await bus.call(path, `${NM}.Settings.Connection`, "GetSettings");
    if (!infrastructure(settings)) throw new Error("invalid active profile");
    return { path, settings };
  }
  const choices = [];
  for (const path of await bus.call(`${ROOT}/Settings`, `${NM}.Settings`, "ListConnections")) {
    const settings = await bus.call(path, `${NM}.Settings.Connection`, "GetSettings");
    const connection = settings.connection;
    if (
      !infrastructure(settings) ||
      connection.autoconnect?.data === false ||
      (radio &&
        connection["interface-name"]?.data &&
        connection["interface-name"].data !== radio.name)
    )
      continue;
    choices.push({ path, settings });
  }
  if (choices.length > 1) throw new Error("ambiguous saved profiles");
  return choices[0] ?? null;
}
