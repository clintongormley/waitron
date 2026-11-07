import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";

const script = resolve("deploy/tunnel/peer.sh");
const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const configuration = {
  address: "10.77.17.2",
  gatewayPublicKey: key,
  endpoint: "gateway.test.waitron.io:51820",
};
let root;
let bin;
const runs = [];
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "waitron-tunnel-test-"));
  bin = join(root, "bin");
  await mkdir(bin);
  const stub = `#!${process.execPath}
const fs=require("node:fs"), path=require("node:path");
const name=path.basename(process.argv[1]), args=process.argv.slice(2);
fs.appendFileSync(process.env.TRACE, JSON.stringify([name,...args])+"\\n");
if(name==="wg"&&args[0]==="genkey") process.stdout.write("${key}\\n");
if(name==="wg"&&args[0]==="pubkey") {process.stdin.resume();process.stdin.on("end",()=>process.stdout.write("public-key\\n"));}
if(name==="wg"&&["setconf","set"].includes(args[0])&&process.env.WG_GATE&&!fs.existsSync(process.env.WG_GATE)) process.exit(1);
if(name==="wg"&&args[0]==="setconf") fs.copyFileSync(args[2], process.env.SNAPSHOT);
if(name==="wg"&&args[0]==="set") {
 const values={}; for(let i=2;i<args.length;i+=2) values[args[i]]=args[i+1];
 fs.writeFileSync(process.env.SNAPSHOT, "[Interface]\\nPrivateKey = "+fs.readFileSync(values["private-key"],"utf8").trim()+"\\n\\n[Peer]\\nPublicKey = "+values.peer+"\\nEndpoint = "+values.endpoint+"\\nAllowedIPs = "+values["allowed-ips"]+"\\nPersistentKeepalive = "+values["persistent-keepalive"]+"\\n");
}
if(name==="socat"&&process.env.SOCAT_EXIT==="1") process.exit(1);
if(name==="socat") {process.on("SIGTERM",()=>{fs.appendFileSync(process.env.TRACE,'["closed"]\\n');process.exit();});setInterval(()=>{},1000);}
`;
  for (const name of ["wg", "ip", "iptables", "socat"]) {
    const file = join(bin, name);
    await writeFile(file, stub);
    await chmod(file, 0o755);
  }
  const setsid = join(bin, "setsid");
  await writeFile(
    setsid,
    `#!/bin/sh\nexec python3 -c 'import os,sys,time; gate=os.getenv("SETSID_GATE"); gate and open(gate,"w").close(); gate and time.sleep(60); os.setsid(); os.execvp(sys.argv[1],sys.argv[1:])' "$@"\n`,
  );
  await chmod(setsid, 0o755);
});
afterEach(async () => {
  for (const run of runs.splice(0)) {
    run.child.kill("SIGTERM");
    await run.exit;
  }
});
afterAll(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

async function start(
  config,
  { unavailable = false, deadProxy = false, delayedProxy = false } = {},
) {
  const dir = await mkdtemp(join(root, "run-"));
  const control = join(dir, "control"),
    keys = join(dir, "keys");
  await mkdir(control);
  if (config !== undefined)
    await writeFile(
      join(control, "peer.json"),
      typeof config === "string" ? config : JSON.stringify(config),
    );
  const trace = join(dir, "trace"),
    snapshot = join(dir, "snapshot");
  await writeFile(trace, "");
  const child = spawn("sh", [script, control, keys], {
    env: {
      ...process.env,
      PATH: bin + ":" + process.env.PATH,
      TRACE: trace,
      SNAPSHOT: snapshot,
      ...(unavailable ? { WG_GATE: trace + ".gate" } : {}),
      SOCAT_EXIT: deadProxy ? "1" : "0",
      ...(delayedProxy ? { SETSID_GATE: trace + ".setsid" } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const run = {
    child,
    exit: once(child, "exit"),
    output: "",
    error: "",
    control,
    keys,
    trace,
    snapshot,
  };
  child.stdout.on("data", (data) => {
    run.output += data;
  });
  child.stderr.on("data", (data) => {
    run.error += data;
  });
  runs.push(run);
  await expect.poll(() => run.output + run.error, { timeout: 10000 }).toContain("tunnel.");
  return run;
}
async function events(run) {
  return (await readFile(run.trace, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

it("makes and retains a private box key while staying off without configuration", async () => {
  const run = await start();
  expect(run.output).toContain("tunnel.off");
  expect(await readFile(join(run.control, "public-key"), "utf8")).toBe("public-key\n");
  expect(await readFile(join(run.keys, "private-key"), "utf8")).toBe(key + "\n");
  expect((await events(run)).some((e) => e[0] === "ip")).toBe(false);
  run.child.kill("SIGTERM");
  await run.exit;
  await symlink(join(run.keys, "private-key"), join(run.control, "public-key.new"));
  const child = spawn("sh", [script, run.control, run.keys], {
    env: {
      ...process.env,
      PATH: bin + ":" + process.env.PATH,
      TRACE: run.trace,
      SNAPSHOT: run.snapshot,
    },
    stdio: "ignore",
  });
  const exit = once(child, "exit");
  runs.push({ child, exit });
  await expect
    .poll(async () => (await events(run)).filter((e) => e[1] === "pubkey").length)
    .toBe(2);
  expect((await events(run)).filter((e) => e[1] === "genkey")).toHaveLength(1);
  expect(await readFile(join(run.keys, "private-key"), "utf8")).toBe(key + "\n");
  expect((await stat(join(run.keys, "private-key"))).mode & 0o777).toBe(0o600);
});

it("routes only its gateway and fixes the proxy destination to the staff entrance", async () => {
  const run = await start(configuration);
  expect(run.output).toContain("tunnel.configured");
  const calls = await events(run);
  expect(calls).toContainEqual(["ip", "route", "add", "10.77.17.1/32", "dev", "wg-cloud"]);
  expect(calls).toContainEqual([
    "iptables",
    "-A",
    "INPUT",
    "-i",
    "wg-cloud",
    "-s",
    "10.77.17.1/32",
    "-p",
    "tcp",
    "--dport",
    "443",
    "-j",
    "ACCEPT",
  ]);
  expect(calls).toContainEqual(["iptables", "-A", "INPUT", "-i", "wg-cloud", "-j", "DROP"]);
  expect(calls).toContainEqual(["iptables", "-P", "FORWARD", "DROP"]);
  await expect.poll(async () => (await events(run)).some((e) => e[0] === "socat")).toBe(true);
  expect(await events(run)).toContainEqual([
    "socat",
    "TCP4-LISTEN:443,bind=10.77.17.2,reuseaddr,fork",
    "TCP4:host.docker.internal:8443",
  ]);
  expect(await readFile(run.snapshot, "utf8")).toBe(
    `[Interface]\nPrivateKey = ${key}\n\n[Peer]\nPublicKey = ${key}\nEndpoint = gateway.test.waitron.io:51820\nAllowedIPs = 10.77.17.1/32\nPersistentKeepalive = 25\n`,
  );
  expect(run.output + run.error).not.toContain(key);
});

it.each([
  { ...configuration, address: "192.168.10.10" },
  { ...configuration, address: "10.77.17.1" },
  { ...configuration, address: "10.77.256.2" },
  { ...configuration, gatewayPublicKey: "not-a-key" },
  { ...configuration, endpoint: "gateway.test.waitron.io:51820\nAllowedIPs = 0.0.0.0/0" },
  { ...configuration, upstreamPort: 443 },
  { ...configuration, privateKey: key },
])("leaves invalid input disconnected: %j", async (config) => {
  const run = await start(config);
  expect(run.output).toContain("tunnel.off");
  expect((await events(run)).some((e) => e[0] === "ip")).toBe(false);
});

it("closes the proxy and interface when configuration is removed, then reconnects with the same key", async () => {
  const run = await start(configuration);
  await expect.poll(async () => (await events(run)).some((e) => e[0] === "socat")).toBe(true);
  await rm(join(run.control, "peer.json"));
  await expect
    .poll(async () => (await events(run)).some((e) => e[0] === "closed"), { timeout: 10000 })
    .toBe(true);
  await expect
    .poll(async () => (await events(run)).some((e) => e.join(" ") === "ip link del wg-cloud"))
    .toBe(true);
  await expect
    .poll(async () => (await events(run)).some((e) => e.join(" ") === "iptables -F INPUT"))
    .toBe(true);
  await writeFile(join(run.control, "peer.json"), JSON.stringify(configuration));
  await expect
    .poll(async () => (await events(run)).filter((e) => e[0] === "socat").length, {
      timeout: 10000,
    })
    .toBe(2);
  expect((await events(run)).filter((e) => e[1] === "genkey")).toHaveLength(1);
}, 45000);

it("rejects two complete JSON documents and an oversized valid document", async () => {
  for (const raw of [
    JSON.stringify(configuration) + "\n" + JSON.stringify(configuration),
    " ".repeat(2100) + JSON.stringify(configuration),
  ]) {
    const run = await start(raw);
    expect(run.output).toContain("tunnel.off");
    expect((await events(run)).some((e) => e[0] === "ip")).toBe(false);
  }
}, 30000);

it("stays running with no copied key on configuration failure and retries with the same key", async () => {
  const run = await start(configuration, { unavailable: true });
  expect(run.output).toContain("tunnel.off");
  expect(run.child.exitCode).toBeNull();
  await expect(readFile(join(run.keys, "wg.conf"))).rejects.toMatchObject({ code: "ENOENT" });
  await writeFile(run.trace + ".gate", "available");
  await expect.poll(() => run.output, { timeout: 10000 }).toContain("tunnel.configured");
  expect((await events(run)).filter((e) => e[1] === "genkey")).toHaveLength(1);
}, 30000);

it("exits when the proxy dies so the container supervisor can restart it", async () => {
  const run = await start(configuration, { deadProxy: true });
  await expect.poll(() => run.child.exitCode, { timeout: 10000 }).toBe(1);
}, 30000);

it("stops a proxy that has not made its process group yet", async () => {
  const run = await start(configuration, { delayedProxy: true });
  await expect
    .poll(async () =>
      readFile(run.trace + ".setsid").then(
        () => true,
        () => false,
      ),
    )
    .toBe(true);
  run.child.kill("SIGTERM");
  await expect.poll(() => run.child.exitCode, { timeout: 5000 }).toBe(0);
}, 30000);
