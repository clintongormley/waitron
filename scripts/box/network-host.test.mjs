import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, expect, it, onTestFinished, vi } from "vitest";

const bin = mkdtempSync(join(tmpdir(), "b3-network-host-"));
afterAll(() => rmSync(bin, { recursive: true, force: true }));
writeFileSync(
  join(bin, "busctl"),
  '#!/bin/sh\nif [ "$B3_NETWORK_FAILURE" = 1 ]; then echo private-radio-name >&2; exit 1; fi\nprintf \'{"type":"ao","data":[[]]}\\n\'\n',
);
chmodSync(join(bin, "busctl"), 0o700);
const line = 'network.read {"actor":{"source":"person","person":"waiter-1"}}';
const empty = {
  ok: true,
  wired: { connected: false, address: null },
  wifi: { connectedSsidHex: null, savedSsidHex: null },
  change: null,
  bootCopy: { state: "failed", reason: null, failure: "io-failed" },
};

it("answers a host without radios through the executable without exposing command output", () => {
  const result = spawnSync(process.execPath, ["scripts/box/network-host.mjs"], {
    input: line,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` },
    timeout: 5000,
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(`${JSON.stringify(empty)}\n`);
  expect(JSON.parse(result.stderr)).toEqual({
    verb: "network.read",
    actor: { source: "person", person: "waiter-1" },
    permission: "system.manage",
  });
}, 10_000);

it("keeps a failed command's real stderr out of the reply and journal", () => {
  const result = spawnSync(process.execPath, ["scripts/box/network-host.mjs"], {
    input: line,
    encoding: "utf8",
    timeout: 5000,
    env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, B3_NETWORK_FAILURE: "1" },
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('{"ok":false,"reason":"host_failed"}\n');
  expect(result.stderr).not.toContain("private-radio-name");
  expect(result.stderr.trim().split("\n")).toHaveLength(1);
}, 10_000);

const root = "/org/freedesktop/NetworkManager";
const nm = "org.freedesktop.NetworkManager";
const typed = (type, data) => ({ type, data });
function host({
  mode = 2,
  active = true,
  profiles = ["normal", "other"],
  addresses = ["192.0.2.8"],
  noIp4 = false,
} = {}) {
  const values = {
    [`${root}/Devices/eth1`]: [
      typed("u", 1),
      typed("u", 30),
      typed("s", "eth1"),
      typed("o", "/"),
      typed("o", "/"),
      typed("o", "/"),
    ],
    [`${root}/Devices/tun0`]: [
      typed("u", 16),
      typed("u", 100),
      typed("s", "tun0"),
      typed("o", "/"),
      typed("o", "/"),
      typed("o", "/"),
    ],
    [`${root}/Devices/eth0`]: [
      typed("u", 1),
      typed("u", 100),
      typed("s", "eth0"),
      typed("o", noIp4 ? "/" : `${root}/IP4Config/1`),
      typed("o", `${root}/IP6Config/1`),
      typed("o", "/"),
    ],
    [`${root}/Devices/wifi`]: [
      typed("u", 2),
      typed("u", active ? 100 : 30),
      typed("s", "wlan0"),
      typed("o", "/"),
      typed("o", "/"),
      typed("o", `${root}/Active/1`),
    ],
  };
  const run = vi.fn(async (command, args) => {
    expect(command).toBe("busctl");
    expect(args.slice(0, 2)).toEqual(["--system", "--json=short"]);
    expect(args[3]).toBe(nm);
    const [operation, , path, iface, ...members] = args.slice(2);
    if (operation === "call" && members[0] === "GetDevices")
      return JSON.stringify(typed("ao", [Object.keys(values)]));
    if (operation === "call" && members[0] === "ListConnections")
      return JSON.stringify(typed("ao", [profiles.map((id) => `${root}/Settings/${id}`)]));
    if (operation === "call" && members[0] === "GetSettings")
      return JSON.stringify(
        typed("a{sa{sv}}", [
          {
            connection: { type: typed("s", "802-11-wireless") },
            "802-11-wireless": {
              mode: typed("s", path.endsWith("hotspot") ? "ap" : "infrastructure"),
              ssid: typed("ay", path.endsWith("normal") ? [0, 255, 195, 40, 92] : [65]),
            },
          },
        ]),
      );
    if (operation === "get-property" && iface === `${nm}.Device`) {
      expect(members).toEqual([
        "DeviceType",
        "State",
        "Interface",
        "Ip4Config",
        "Ip6Config",
        "ActiveConnection",
      ]);
      return values[path].map((v) => JSON.stringify(v)).join("\n");
    }
    if (operation === "get-property" && iface === `${nm}.Device.Wireless`) {
      expect(members).toEqual(["Mode", "ActiveAccessPoint"]);
      return [typed("u", mode), typed("o", `${root}/AccessPoint/1`)]
        .map((v) => JSON.stringify(v))
        .join("\n");
    }
    if (operation === "get-property" && iface === `${nm}.AccessPoint`)
      return JSON.stringify(typed("ay", [0, 255, 195, 40, 92]));
    if (operation === "get-property" && iface === `${nm}.Connection.Active`)
      return JSON.stringify(typed("o", `${root}/Settings/normal`));
    if (operation === "get-property" && iface === `${nm}.IP4Config`)
      return JSON.stringify(
        typed(
          "aa{sv}",
          addresses.map((address) => ({ address: typed("s", address), prefix: typed("u", 24) })),
        ),
      );
    if (operation === "get-property" && iface === `${nm}.IP6Config`)
      return JSON.stringify(
        typed("aa{sv}", [
          { address: typed("s", "fe80::1"), prefix: typed("u", 64) },
          { address: typed("s", "2001:db8::8"), prefix: typed("u", 64) },
        ]),
      );
    throw new Error(`unexpected read ${JSON.stringify(args)}`);
  });
  return run;
}

it("refuses a canonical write request without starting a host command", async () => {
  const { handleNetworkRead } = await import("./network-host.mjs");
  const run = vi.fn();
  const join =
    'network.join {"ssidHex":"41","keyMgmt":"wpa-psk","psk":"restaurant-key","hidden":false,"actor":{"source":"person","person":"waiter-1"}}';
  const reply = await handleNetworkRead(join, { run });
  expect(run).not.toHaveBeenCalled();
  expect(reply).toBe('{"ok":false,"reason":"unknown_request"}\n');
});

it("reads connected Ethernet and exact Wi-Fi bytes, preferring its active infrastructure profile", async () => {
  const { handleNetworkRead } = await import("./network-host.mjs");
  const journal = vi.spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(() => journal.mockRestore());
  expect(JSON.parse(await handleNetworkRead(line, { run: host() }))).toEqual({
    ...empty,
    wired: { connected: true, address: "192.0.2.8" },
    wifi: { connectedSsidHex: "00ffc3285c", savedSsidHex: "00ffc3285c" },
  });
  expect(journal.mock.calls.map(([entry]) => JSON.parse(entry))).toEqual([
    {
      verb: "network.read",
      actor: { source: "person", person: "waiter-1" },
      permission: "system.manage",
    },
  ]);
});

it("logs no person's permission for a server-initiated observation", async () => {
  const { handleNetworkRead } = await import("./network-host.mjs");
  const journal = vi.spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(() => journal.mockRestore());
  await handleNetworkRead('network.read {"actor":{"source":"server"}}', { run: host() });
  expect(journal.mock.calls.map(([entry]) => JSON.parse(entry))).toEqual([
    {
      verb: "network.read",
      actor: { source: "server" },
      permission: null,
    },
  ]);
});

it.each([{ addresses: [] }, { addresses: ["169.254.3.4"] }])(
  "uses global IPv6 without usable IPv4 (%j)",
  async ({ addresses }) => {
    const { handleNetworkRead } = await import("./network-host.mjs");
    const reply = JSON.parse(await handleNetworkRead(line, { run: host({ addresses }) }));
    expect(reply.wired).toEqual({ connected: true, address: "2001:db8::8" });
  },
);

it.each([
  [
    "a saved normal profile without a connection",
    { active: false, profiles: ["normal"] },
    { connectedSsidHex: null, savedSsidHex: "00ffc3285c" },
    false,
  ],
  [
    "ambiguous normal profiles",
    { active: false },
    { connectedSsidHex: null, savedSsidHex: null },
    true,
  ],
  [
    "a hotspot alongside a normal saved profile",
    { mode: 3, profiles: ["hotspot", "normal"] },
    { connectedSsidHex: null, savedSsidHex: "00ffc3285c" },
    false,
  ],
])("keeps readable Ethernet status with %s", async (_name, config, wifi, ambiguous) => {
  const { handleNetworkRead } = await import("./network-host.mjs");
  const journal = vi.spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(() => journal.mockRestore());
  const reply = JSON.parse(await handleNetworkRead(line, { run: host(config) }));
  expect(reply.wired).toEqual({ connected: true, address: "192.0.2.8" });
  expect(reply.wifi).toEqual(wifi);
  expect(journal.mock.calls.map(([entry]) => JSON.parse(entry))).toEqual([
    {
      verb: "network.read",
      actor: { source: "person", person: "waiter-1" },
      permission: "system.manage",
      ...(ambiguous ? { ambiguousProfiles: true } : {}),
    },
  ]);
});

it.each(["failure", "invalid-json"])("sanitises an observation %s", async (kind) => {
  const { handleNetworkRead } = await import("./network-host.mjs");
  const run = () => {
    if (kind === "failure") throw new Error("private SSID and settings");
    return "private SSID and settings";
  };
  expect(await handleNetworkRead(line, { run })).toBe('{"ok":false,"reason":"host_failed"}\n');
});

it("shares three seconds across commands and caps output without invoking a shell", async () => {
  const { networkCommand } = await import("./network-host.mjs");
  let time = 0;
  const exec = vi.fn(() => "observation");
  const run = networkCommand({ now: () => time, exec });
  expect(run("busctl", ["--system"])).toBe("observation");
  time = 2600;
  run("busctl", ["--json=short"]);
  expect(exec.mock.calls.map((call) => call[2].timeout)).toEqual([3000, 400]);
  expect(exec.mock.calls[0][2]).toMatchObject({
    maxBuffer: 65536,
    encoding: "utf8",
    env: { LC_ALL: "C" },
  });
  expect(exec.mock.calls[0][2].shell).toBeUndefined();
  time = 3000;
  expect(() => run("busctl", [])).toThrow();
  expect(exec).toHaveBeenCalledTimes(2);
});

it("scans fresh access points, preserving bytes and choosing the strongest duplicate", async () => {
  const { handleNetworkRequest } = await import("./network-host.mjs");
  const base = host();
  let scans = 0;
  const run = vi.fn(async (command, args) => {
    if (command === "nmcli") {
      expect(args).toEqual(["--wait", "10", "device", "wifi", "rescan", "ifname", "wlan0"]);
      scans++;
      return "";
    }
    if (args.at(-1) === "LastScan") return JSON.stringify(typed("x", scans));
    if (args.at(-1) === "GetAllAccessPoints")
      return JSON.stringify(
        typed("ao", [["/ap/weak", "/ap/strong", "/ap/hidden", "/ap/sae", "/ap/open"]]),
      );
    if (
      args.includes("/ap/weak") ||
      args.includes("/ap/strong") ||
      args.includes("/ap/hidden") ||
      args.includes("/ap/sae") ||
      args.includes("/ap/open")
    ) {
      const path = args[4];
      const data = path.endsWith("hidden")
        ? [[], 100, 0, 0]
        : path.endsWith("sae")
          ? [[66], 80, 0, 0x400]
          : path.endsWith("open")
            ? [[67], 20, 0, 0]
            : [[0, 255, 195, 40, 92], path.endsWith("strong") ? 90 : 30, 0x100, 0];
      return data.map((v) => JSON.stringify(typed("unused", v))).join("\n");
    }
    return base(command, args);
  });
  expect(typeof handleNetworkRequest).toBe("function");
  const reply = await handleNetworkRequest(
    'network.scan {"actor":{"source":"person","person":"waiter-1"}}',
    { run },
  );
  expect(JSON.parse(reply)).toEqual({
    ok: true,
    networks: [
      { ssidHex: "00ffc3285c", signal: 90, security: "wpa-psk" },
      { ssidHex: "42", signal: 80, security: "sae" },
      { ssidHex: "43", signal: 20, security: "other" },
    ],
  });
});

it("refuses a scan without a radio", async () => {
  const { handleNetworkRequest } = await import("./network-host.mjs");
  expect(typeof handleNetworkRequest).toBe("function");
  expect(
    JSON.parse(
      await handleNetworkRequest('network.scan {"actor":{"source":"person","person":"waiter-1"}}', {
        run: async () => JSON.stringify(typed("ao", [[]])),
      }),
    ),
  ).toEqual({ ok: false, reason: "no_wifi" });
});

it("reports persisted live-change and boot-copy outcomes alongside the current link observations", async () => {
  const { handleNetworkRead } = await import("./network-host.mjs");
  const status = {
    change: { kind: "join", ssidHex: "41", state: "applied", reason: null },
    bootCopy: { state: "failed", reason: null, failure: "mount-unverified" },
  };
  const reply = JSON.parse(
    await handleNetworkRead(line, { run: host(), readStatus: async () => status }),
  );
  expect(reply.change).toEqual({ kind: "join", ssidHex: "41", state: "applied", reason: null });
  expect(reply.bootCopy).toEqual({ state: "failed", reason: null, failure: "mount-unverified" });
  expect(reply.wired).toEqual({ connected: true, address: "192.0.2.8" });
});

it.each([
  'network.join {"ssidHex":"41","keyMgmt":"wpa-psk","psk":"restaurant-key","hidden":false,"actor":{"source":"server"}}',
  'network.join {"ssidHex":"41","keyMgmt":"wpa-psk","psk":"short","hidden":false,"actor":{"source":"person","person":"owner"}}',
  "network.scan {}",
])("rejects malformed or inadmissible network requests before any command (%s)", async (line) => {
  const { handleNetworkRequest } = await import("./network-host.mjs");
  const run = vi.fn();
  expect(JSON.parse(await handleNetworkRequest(line, { run })).ok).toBe(false);
  expect(run).not.toHaveBeenCalled();
});

it("answers busy before scanning while a join is pending", async () => {
  const { handleNetworkRequest } = await import("./network-host.mjs");
  const run = vi.fn();
  const answer = await handleNetworkRequest(
    'network.scan {"actor":{"source":"person","person":"owner"}}',
    {
      run,
      readStatus: async () => ({
        change: { kind: "join", ssidHex: "41", state: "running", reason: null },
        bootCopy: { state: "pending", reason: null, failure: null },
      }),
    },
  );
  expect(JSON.parse(answer)).toEqual({ ok: false, reason: "busy" });
  expect(run).not.toHaveBeenCalled();
});

it("keeps the canonical read path and rejects a not-yet-implemented forget", async () => {
  const { handleNetworkRequest } = await import("./network-host.mjs");
  expect(JSON.parse(await handleNetworkRequest(line, { run: host() })).wired).toEqual({
    connected: true,
    address: "192.0.2.8",
  });
  expect(
    JSON.parse(
      await handleNetworkRequest(
        'network.forget {"ssidHex":"41","actor":{"source":"person","person":"owner"}}',
      ),
    ),
  ).toEqual({ ok: false, reason: "unknown_request" });
});

it("refuses a fresh scan that never completes instead of returning cached access points", async () => {
  const { handleNetworkRequest } = await import("./network-host.mjs");
  const { performance } = await import("node:perf_hooks");
  const now = vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(11000);
  onTestFinished(() => now.mockRestore());
  const base = host();
  const run = async (command, args) =>
    args.at(-1) === "LastScan"
      ? JSON.stringify(typed("x", 0))
      : command === "nmcli"
        ? ""
        : base(command, args);
  expect(
    JSON.parse(
      await handleNetworkRequest('network.scan {"actor":{"source":"person","person":"owner"}}', {
        run,
        readStatus: async () => ({ change: null }),
      }),
    ),
  ).toEqual({ ok: false, reason: "host_failed" });
});

it("refuses partial device properties and a radio already used as a hotspot", async () => {
  const { handleNetworkRequest } = await import("./network-host.mjs");
  const request = 'network.scan {"actor":{"source":"person","person":"owner"}}';
  expect(
    JSON.parse(
      await handleNetworkRequest(request, {
        run: host({ mode: 3 }),
        readStatus: async () => ({ change: null }),
      }),
    ),
  ).toEqual({ ok: false, reason: "no_wifi" });
  const base = host();
  const run = async (command, args) =>
    args.includes("DeviceType") ? JSON.stringify(typed("u", 2)) : base(command, args);
  expect(
    JSON.parse(
      await handleNetworkRequest(request, { run, readStatus: async () => ({ change: null }) }),
    ),
  ).toEqual({ ok: false, reason: "host_failed" });
});

it("waits for the requested scan to finish before reading access points", async () => {
  const { handleNetworkRequest } = await import("./network-host.mjs");
  const base = host();
  let observations = 0;
  const run = async (command, args) => {
    if (command === "nmcli") return "";
    if (args.at(-1) === "LastScan") return JSON.stringify(typed("x", ++observations < 3 ? 0 : 1));
    if (args.at(-1) === "GetAllAccessPoints")
      return JSON.stringify(typed("ao", [observations >= 3 ? ["/fresh"] : []]));
    if (args.includes("/fresh"))
      return [[65], 80, 0x100, 0].map((data) => JSON.stringify(typed("unused", data))).join("\n");
    return base(command, args);
  };
  expect(
    JSON.parse(
      await handleNetworkRequest('network.scan {"actor":{"source":"person","person":"owner"}}', {
        run,
        readStatus: async () => ({ change: null }),
      }),
    ),
  ).toEqual({ ok: true, networks: [{ ssidHex: "41", signal: 80, security: "wpa-psk" }] });
});

it("refuses selection when two infrastructure radios are active", async () => {
  const { networkRadio } = await import("./network-manager.mjs");
  const bus = {
    call: async () => ["/radio/0", "/radio/1"],
    get: async (path, iface) =>
      iface.endsWith(".Device")
        ? [2, 100, path.endsWith("0") ? "wlan0" : "wlan1", "/", "/", "/active/1"]
        : [2, "/ap/1"],
  };
  await expect(networkRadio(bus)).rejects.toThrow("ambiguous radio");
});

it("retains IPv6 status when Ethernet has no IPv4 configuration object", async () => {
  const { handleNetworkRead } = await import("./network-host.mjs");
  expect(JSON.parse(await handleNetworkRead(line, { run: host({ noIp4: true }) })).wired).toEqual({
    connected: true,
    address: "2001:db8::8",
  });
});

it("the read entry refuses malformed input without starting a host command", async () => {
  const { handleNetworkRead } = await import("./network-host.mjs");
  const run = vi.fn();
  expect(JSON.parse(await handleNetworkRead("network.read {", { run }))).toEqual({
    ok: false,
    reason: "request_invalid",
  });
  expect(run).not.toHaveBeenCalled();
});
