import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parseWifiRecord } from "./wifi-record.mjs";

const folders = [];
afterEach(async () => {
  for (const root of folders.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
const fields = { ssidHex: "00ffc3285c", keyMgmt: "sae", psk: " secret\\café ", hidden: true };
const pending = { kind: "join", ssidHex: "00ffc3285c", state: "running", reason: null };
const typed = (data) => ({ data });
const previous = "11111111-1111-4111-8111-111111111111";
async function fixture({
  failActivation = false,
  wrongMount = false,
  failStart = false,
  failLoad = false,
  disconnected = false,
} = {}) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "b3-network-change-")));
  folders.push(root);
  const hostRoot = join(root, "host"),
    profilesRoot = join(root, "profiles"),
    bootRoot = join(root, "boot");
  for (const path of [hostRoot, profilesRoot, bootRoot]) await fs.mkdir(path, { mode: 0o700 });
  let activated = false,
    boot = "boot-one",
    candidateUuid;
  const journal = [];
  const run = vi.fn(async (command, args) => {
    if (command === "systemctl") {
      if (failStart) throw Error("secret start detail");
      return "";
    }
    if (command === "nmcli") {
      if (args.includes("load") && failLoad) throw Error("cannot load profile");
      if (args.includes("delete") && !candidateUuid) throw Error("unknown connection");
      if (args.includes("load"))
        candidateUuid = /^uuid=(.+)$/m.exec(await fs.readFile(args.at(-1), "utf8"))[1];
      if (args.includes("up") && args.includes(previous)) return "";
      if (args.includes("up")) {
        if (failActivation) throw Error("secret activation detail");
        activated = true;
      }
      return "";
    }
    expect(command).toBe("busctl");
    const [operation, , path, iface, ...members] = args.slice(2);
    if (operation === "call") {
      if (members[0] === "GetDevices") return JSON.stringify(typed([["/radio"]]));
      if (members[0] === "ListConnections")
        return JSON.stringify(typed([candidateUuid ? ["/previous", "/candidate"] : ["/previous"]]));
      if (members[0] === "GetSettings")
        return JSON.stringify(
          typed([
            {
              connection: {
                type: typed("802-11-wireless"),
                uuid: typed(path === "/candidate" ? candidateUuid : previous),
              },
              "802-11-wireless": {
                mode: typed("infrastructure"),
                ssid: typed([0, 255, 195, 40, 92]),
                hidden: typed(true),
              },
              "802-11-wireless-security": { "key-mgmt": typed("sae") },
            },
          ]),
        );
      if (members[0] === "GetSecrets") {
        expect(members.slice(1)).toEqual(["s", "802-11-wireless-security"]);
        return JSON.stringify(
          typed([{ "802-11-wireless-security": { psk: typed(" secret\\café ") } }]),
        );
      }
    }
    if (iface.endsWith("Device"))
      return [2, disconnected ? 30 : 100, "wlan9", "/", "/", disconnected ? "/" : "/active"]
        .map((v) => JSON.stringify(typed(v)))
        .join("\n");
    if (iface.endsWith("Device.Wireless"))
      return [2, "/ap"].map((v) => JSON.stringify(typed(v))).join("\n");
    if (iface.endsWith("Connection.Active"))
      return JSON.stringify(typed(activated ? "/candidate" : "/previous"));
    throw Error(`unhandled ${args}`);
  });
  const inspect = vi.fn(async () => ({ hostRoot, diskUuid: "own-disk", rootId: "host-identity" }));
  const inspectBootMount = async () => {
    if (wrongMount) throw Error("wrong mount");
    const s = await fs.lstat(bootRoot, { bigint: true });
    return { bootRoot, rootId: `${s.dev}:${s.ino}` };
  };
  const module = await import("./network-change.mjs").catch(() => ({}));
  expect(typeof module.createNetworkChange).toBe("function");
  const deps = {
    run,
    inspect,
    hostRoot,
    profilesRoot,
    bootRoot,
    inspectBootMount,
    ownerUid: process.getuid(),
    readBootId: async () => boot,
    log: (entry) => journal.push(entry),
  };
  const service = module.createNetworkChange(deps);
  return {
    service,
    deps,
    run,
    inspect,
    root,
    hostRoot,
    profilesRoot,
    bootRoot,
    journal,
    reboot: () => {
      boot = "boot-two";
    },
  };
}

it("accepts a join durably without putting credentials in argv, state or journal", async () => {
  const f = await fixture();
  expect(await f.service.accept(fields, { source: "person", person: "waiter-1" })).toEqual({
    ok: true,
  });
  expect((await f.service.status()).change).toEqual(pending);
  const state = await fs.readFile(join(f.hostRoot, "network.json"), "utf8");
  expect(state).not.toContain(fields.psk);
  const profile = await fs.readFile(
    join(f.profilesRoot, (await fs.readdir(f.profilesRoot))[0]),
    "utf8",
  );
  expect(profile).toContain("ssid=0;255;195;40;92;");
  expect(profile).toContain("autoconnect=false");
  expect(profile).toContain("psk=\\ssecret\\\\café\\s");
  expect(
    (await fs.stat(join(f.profilesRoot, (await fs.readdir(f.profilesRoot))[0]))).mode & 0o777,
  ).toBe(0o600);
  expect(f.run.mock.calls.at(-1)).toEqual([
    "systemctl",
    ["start", "--no-block", "waitron-network-change.service"],
  ]);
  expect(JSON.stringify(f.run.mock.calls) + JSON.stringify(f.journal)).not.toContain(fields.psk);
  expect(f.journal[0]).toEqual({
    verb: "network.join",
    actor: { source: "person", person: "waiter-1" },
    permission: "system.manage",
  });
  expect(await f.service.accept(fields, { source: "person", person: "waiter-1" })).toEqual({
    ok: false,
    reason: "busy",
  });
});

it("applies then publishes the selected secrets and retains the previous profile with autoconnect off", async () => {
  const f = await fixture();
  await f.service.accept(fields, { source: "person", person: "waiter-1" });
  await f.service.work();
  expect(await f.service.status()).toEqual({
    change: { ...pending, state: "applied" },
    bootCopy: { state: "current", reason: null, failure: null },
  });
  const loaded = parseWifiRecord(await fs.readFile(join(f.bootRoot, "waitron-recovery/wifi.json")));
  expect(loaded).toEqual({ kind: "loaded", network: fields });
  const calls = f.run.mock.calls;
  expect(calls).toContainEqual([
    "nmcli",
    ["connection", "modify", "uuid", previous, "connection.autoconnect", "no"],
  ]);
  expect(calls.filter(([, args]) => args.includes("delete"))).toEqual([]);
  expect(calls.some(([, args]) => args.includes(fields.psk))).toBe(false);
});

it("keeps a successful live join when the boot-copy mount is unavailable", async () => {
  const f = await fixture({ wrongMount: true });
  await f.service.accept(fields, { source: "person", person: "waiter-1" });
  await f.service.work();
  expect(await f.service.status()).toEqual({
    change: { ...pending, state: "applied" },
    bootCopy: { state: "failed", reason: null, failure: "mount-unverified" },
  });
  expect(await fs.readdir(f.bootRoot)).toEqual([]);
});

it("removes a failed candidate and restores the previous connection before reporting refusal", async () => {
  const f = await fixture({ failActivation: true });
  await f.service.accept(fields, { source: "person", person: "waiter-1" });
  await f.service.work();
  expect((await f.service.status()).change).toEqual({
    ...pending,
    state: "refused",
    reason: "failed",
  });
  expect(f.run.mock.calls).toContainEqual([
    "nmcli",
    ["--wait", "10", "connection", "up", "uuid", previous, "ifname", "wlan9"],
  ]);
  expect(await fs.readdir(f.profilesRoot)).toEqual([]);
});

it("refuses an interrupted join on the next boot without activating it", async () => {
  const f = await fixture();
  await f.service.accept(fields, { source: "person", person: "waiter-1" });
  f.reboot();
  await f.service.work();
  expect((await f.service.status()).change).toEqual({
    ...pending,
    state: "refused",
    reason: "failed",
  });
  expect(f.run.mock.calls.filter(([, args]) => args.includes("60"))).toEqual([]);
  expect(await fs.readdir(f.profilesRoot)).toEqual([]);
});

it("clears an operation whose worker could not start", async () => {
  const f = await fixture({ failStart: true });
  expect(await f.service.accept(fields, { source: "person", person: "waiter-1" })).toEqual({
    ok: false,
    reason: "host_failed",
  });
  expect((await f.service.status()).change.state).toBe("refused");
  expect(await fs.readdir(f.profilesRoot)).toEqual([]);
});

it("keeps the successful profile on disk while a replacement join is still pending", async () => {
  const f = await fixture();
  await f.service.accept(fields, { source: "person", person: "waiter-1" });
  await f.service.work();
  const first = await fs.readdir(f.profilesRoot);
  const bytes = await fs.readFile(join(f.profilesRoot, first[0]), "utf8");
  await f.service.accept(
    { ...fields, psk: "replacement-password" },
    { source: "person", person: "waiter-1" },
  );
  expect(await fs.readFile(join(f.profilesRoot, first[0]), "utf8")).toBe(bytes);
  expect(await fs.readdir(f.profilesRoot)).toHaveLength(2);
});

it("checks the installed boot UUID before accepting the copy mount", async () => {
  const { inspectNetworkBootMount } = await import("./network-change.mjs");
  const f = await fixture();
  const fstab = join(f.root, "fstab");
  await fs.writeFile(fstab, `# installed mounts\nUUID=boot-uuid ${f.bootRoot} ext4 defaults 0 2\n`);
  const run = vi.fn(async () =>
    JSON.stringify({ filesystems: [{ target: f.bootRoot, fstype: "ext4", uuid: "boot-uuid" }] }),
  );
  const actual = await inspectNetworkBootMount({
    run,
    bootRoot: f.bootRoot,
    fstab,
    ownerUid: process.getuid(),
  });
  expect(actual.bootRoot).toBe(f.bootRoot);
  expect(actual.rootId).toMatch(/^\d+:\d+$/);
  run.mockResolvedValue(
    JSON.stringify({ filesystems: [{ target: f.bootRoot, fstype: "ext4", uuid: "wrong-disk" }] }),
  );
  await expect(
    inspectNetworkBootMount({ run, bootRoot: f.bootRoot, fstab, ownerUid: process.getuid() }),
  ).rejects.toThrow("boot mount unverified");
  expect(await fs.readdir(f.bootRoot)).toEqual([]);
});

it("treats missing state as pending, corrupt state as failed and refuses writes without changing profiles", async () => {
  const f = await fixture();
  expect(await f.service.status()).toEqual({
    change: null,
    bootCopy: { state: "pending", reason: null, failure: null },
  });
  await fs.writeFile(join(f.hostRoot, "network.json"), '{"not":"a network state"}', {
    mode: 0o600,
  });
  expect(await f.service.status()).toEqual({
    change: null,
    bootCopy: { state: "failed", reason: null, failure: "io-failed" },
  });
  expect(await f.service.accept(fields, { source: "person", person: "waiter-1" })).toEqual({
    ok: false,
    reason: "host_failed",
  });
  expect(await fs.readdir(f.profilesRoot)).toEqual([]);
});

it("does not touch host state or profiles when encrypted host inspection fails", async () => {
  const f = await fixture();
  f.inspect.mockRejectedValue(Error("wrong host"));
  expect(await f.service.accept(fields, { source: "person", person: "waiter-1" })).toEqual({
    ok: false,
    reason: "host_failed",
  });
  expect(await fs.readdir(f.hostRoot)).toEqual([]);
  expect(await fs.readdir(f.profilesRoot)).toEqual([]);
});

it("repairs a pending boot copy on restart without reconnecting Wi-Fi", async () => {
  const f = await fixture();
  await f.service.work();
  await f.service.accept(fields, { source: "person", person: "waiter-1" });
  await f.service.work();
  const file = join(f.hostRoot, "network.json");
  const state = JSON.parse(await fs.readFile(file, "utf8"));
  state.bootCopy = { state: "pending", reason: null, failure: null };
  await fs.writeFile(file, JSON.stringify(state));
  f.reboot();
  const start = f.run.mock.calls.length;
  await f.service.work();
  expect((await f.service.status()).bootCopy).toEqual({
    state: "current",
    reason: null,
    failure: null,
  });
  expect(f.run.mock.calls.slice(start).filter(([, args]) => args.includes("up"))).toEqual([]);
});

it("cleans the unregistered keyfile if NetworkManager refuses to load it", async () => {
  const f = await fixture({ failLoad: true });
  expect(await f.service.accept(fields, { source: "person", person: "waiter-1" })).toEqual({
    ok: false,
    reason: "host_failed",
  });
  expect((await f.service.status()).change).toEqual({
    ...pending,
    state: "refused",
    reason: "failed",
  });
  expect(await fs.readdir(f.profilesRoot)).toEqual([]);
});

it("reports no_wifi without writing state through the canonical join handler", async () => {
  const f = await fixture();
  const { acceptNetworkJoin } = await import("./network-change.mjs");
  const run = vi.fn(async () => JSON.stringify({ data: [[]] }));
  const reply = await acceptNetworkJoin(
    { fields, actor: { source: "person", person: "waiter-1" } },
    {
      run,
      inspect: f.inspect,
      hostRoot: f.hostRoot,
      profilesRoot: f.profilesRoot,
      bootRoot: f.bootRoot,
      ownerUid: process.getuid(),
      log: () => {},
    },
  );
  expect(JSON.parse(reply)).toEqual({ ok: false, reason: "no_wifi" });
  expect(await fs.readdir(f.hostRoot)).toEqual([]);
});

it("retains the unique saved infrastructure profile when joining from a disconnected radio", async () => {
  const f = await fixture({ disconnected: true });
  await f.service.accept(fields, { source: "person", person: "waiter-1" });
  const state = JSON.parse(await fs.readFile(join(f.hostRoot, "network.json"), "utf8"));
  expect(state.previous).toBe("11111111-1111-4111-8111-111111111111");
});

it("dispatches a canonical join through the host into the durable worker queue", async () => {
  const f = await fixture();
  const { handleNetworkRequest } = await import("./network-host.mjs");
  const { formatHostRequest } = await import("./host-protocol.mjs");
  const reply = await handleNetworkRequest(
    formatHostRequest({
      verb: "network.join",
      fields,
      actor: { source: "person", person: "waiter-1" },
    }),
    f.deps,
  );
  expect(JSON.parse(reply)).toEqual({ ok: true });
  expect((await f.service.status()).change).toEqual(pending);
});

it("does not follow a linked state file or overwrite public state", async () => {
  const f = await fixture();
  const target = join(f.root, "outside");
  await fs.writeFile(target, "do not change", { mode: 0o600 });
  await fs.symlink(target, join(f.hostRoot, "network.json"));
  expect(await f.service.accept(fields, { source: "person", person: "waiter-1" })).toEqual({
    ok: false,
    reason: "host_failed",
  });
  expect(await fs.readFile(target, "utf8")).toBe("do not change");
  await fs.unlink(join(f.hostRoot, "network.json"));
  await fs.writeFile(join(f.hostRoot, "network.json"), "{}", { mode: 0o644 });
  expect((await f.service.status()).bootCopy).toEqual({
    state: "failed",
    reason: null,
    failure: "io-failed",
  });
});

it("reports an observation failure separately after the live join succeeds", async () => {
  const f = await fixture();
  await f.service.accept(fields, { source: "person", person: "waiter-1" });
  const original = f.run.getMockImplementation();
  f.run.mockImplementation(async (command, args) => {
    if (args.includes("GetSecrets")) throw Error("private secret detail");
    return original(command, args);
  });
  await f.service.work();
  expect(await f.service.status()).toEqual({
    change: { ...pending, state: "applied" },
    bootCopy: { state: "failed", reason: null, failure: "io-failed" },
  });
  expect(JSON.stringify(f.journal)).not.toContain("private secret detail");
});
