import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { PassThrough } from "node:stream";
import { setImmediate } from "node:timers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pairOverPipes } from "./bluetoothctl-pair.mjs";

// Above the CLI cases' spawn timeout below, so a slow but healthy child is not failed for its duration.
const SPAWN_TIMEOUT_MS = 10_000;
vi.setConfig({ testTimeout: SPAWN_TIMEOUT_MS + 10_000 });

const MAC = "86:67:7A:00:00:01";
// bluetoothctl 5.82's own bytes over pipes: the prompt carries colour codes and no newline, and each
// event line is padded with a carriage return and spaces.
const PROMPT = "\u001b[0;94m[bluetoothctl]> \u001b[0m";
const line = (text) => `\r${" ".repeat(79)}\r${text}\n${PROMPT}`;
const PIN_PROMPT = "\r\u001b[1;39m\u001b[1;39m[agent] Enter PIN code: \u001b[0m\u001b[0m";

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = new PassThrough();
  child.written = [];
  child.stdin.on("data", (chunk) => child.written.push(chunk.toString()));
  child.stdin.on("finish", () => {
    child.ended = true;
  });
  child.kill = (signal) => {
    child.killedWith = signal;
    child.emit("close", null, signal);
  };
  return child;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("pairOverPipes", () => {
  it("pairs only after the agent is registered, answers the PIN prompt once, then quits", async () => {
    const child = fakeChild();
    const result = pairOverPipes(child, { address: MAC, pin: "1234", deadlineMs: 5000 });
    child.stdout.write(`Waiting to connect to bluetoothd...\r${PROMPT}`);
    await settle();
    expect(child.written).toEqual([]);
    child.stdout.write(line("Agent registered"));
    await settle();
    expect(child.written).toEqual([`pair ${MAC}\n`]);
    child.stdout.write(line(`Attempting to pair with ${MAC}`) + line("Request PIN code"));
    await settle();
    expect(child.written).toEqual([`pair ${MAC}\n`]);
    // The prompt split across two chunks is still one prompt.
    child.stdout.write(PIN_PROMPT.slice(0, 20));
    await settle();
    expect(child.written).toEqual([`pair ${MAC}\n`]);
    child.stdout.write(PIN_PROMPT.slice(20));
    await settle();
    expect(child.written).toEqual([`pair ${MAC}\n`, "1234\n"]);
    child.stdout.write(PIN_PROMPT);
    await settle();
    expect(child.written).toEqual([`pair ${MAC}\n`, "1234\n"]);
    child.stdout.write(line(`[CHG] Device ${MAC} Paired: yes`) + line("Pairing successful"));
    await settle();
    expect(child.written).toEqual([`pair ${MAC}\n`, "1234\n", "quit\n"]);
    expect(child.ended).toBe(true);
    // Output after the result is read but never answered: stdin is already closed.
    child.stdout.write(PIN_PROMPT);
    await settle();
    expect(child.written).toEqual([`pair ${MAC}\n`, "1234\n", "quit\n"]);
    child.emit("close", 0, null);
    await expect(result).resolves.toMatchObject({ outcome: "paired", pinAsked: true });
  });

  it("reports a bluetoothctl that exits before any result as failed", async () => {
    const child = fakeChild();
    const result = pairOverPipes(child, { address: MAC, pin: "1234", deadlineMs: 5000 });
    child.stdout.write("Waiting to connect to bluetoothd...");
    await settle();
    child.emit("close", 1, null);
    await expect(result).resolves.toMatchObject({ outcome: "failed", pinAsked: false });
  });

  it("reports a refused pairing as failed, and still quits", async () => {
    const child = fakeChild();
    const result = pairOverPipes(child, { address: MAC, pin: "9999", deadlineMs: 5000 });
    child.stdout.write(line("Agent registered") + PIN_PROMPT);
    await settle();
    child.stdout.write(line("Failed to pair: org.bluez.Error.AuthenticationFailed"));
    await settle();
    expect(child.written).toEqual([`pair ${MAC}\n`, "9999\n", "quit\n"]);
    child.emit("close", 0, null);
    await expect(result).resolves.toMatchObject({ outcome: "failed", pinAsked: true });
  });

  it("reports an agent the bus refused as failed, without sending pair", async () => {
    const child = fakeChild();
    const result = pairOverPipes(child, { address: MAC, pin: "1234", deadlineMs: 5000 });
    child.stdout.write(line("Failed to register agent: org.freedesktop.DBus.Error.AccessDenied"));
    await settle();
    expect(child.written).toEqual(["quit\n"]);
    child.emit("close", 0, null);
    await expect(result).resolves.toMatchObject({ outcome: "failed", pinAsked: false });
  });

  it("keeps the whole transcript, colour codes removed", async () => {
    const child = fakeChild();
    const result = pairOverPipes(child, { address: MAC, pin: "1234", deadlineMs: 5000 });
    child.stdout.write(line("Agent registered") + line("Pairing successful"));
    await settle();
    child.emit("close", 0, null);
    const { transcript, pinAsked } = await result;
    expect(pinAsked).toBe(false);
    expect(transcript).toContain("Pairing successful");
    expect(transcript).not.toContain("\u001b");
  });

  it("ends stdin and kills bluetoothctl when no result arrives before the deadline", async () => {
    const child = fakeChild();
    const result = pairOverPipes(child, { address: MAC, pin: "1234", deadlineMs: 50, graceMs: 20 });
    child.stdout.write(line("Agent registered"));
    await expect(result).resolves.toMatchObject({ outcome: "timeout" });
    expect(child.ended).toBe(true);
    expect(child.killedWith).toBe("SIGKILL");
  });

  it("does not kill a bluetoothctl that exits within the grace period after the deadline", async () => {
    const child = fakeChild();
    child.stdin.on("finish", () => setImmediate(() => child.emit("close", 0, null)));
    const result = pairOverPipes(child, {
      address: MAC,
      pin: "1234",
      deadlineMs: 20,
      graceMs: 5000,
    });
    await expect(result).resolves.toMatchObject({ outcome: "timeout" });
    expect(child.killedWith).toBeUndefined();
  });
});

describe("node scripts/bluetoothctl-pair.mjs", () => {
  const dirs = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  // A stand-in bluetoothctl on PATH that plays the success path and records what it was sent.
  function fakeBluetoothctl(result) {
    const dir = mkdtempSync(join(tmpdir(), "bluetoothctl-pair-"));
    dirs.push(dir);
    const bin = join(dir, "bluetoothctl");
    writeFileSync(
      bin,
      `#!${process.execPath}
const out = (s) => process.stdout.write(s);
out(${JSON.stringify(line("Agent registered"))});
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  if (buf.includes("pair ") && !buf.includes("\\n1234")) out(${JSON.stringify(PIN_PROMPT)});
  if (buf.endsWith("1234\\n")) out(${JSON.stringify(line(result))});
  if (buf.endsWith("quit\\n")) process.exit(0);
});
`,
    );
    chmodSync(bin, 0o755);
    return dir;
  }

  const cli = (dir, args) =>
    spawnSync(process.execPath, [join(import.meta.dirname, "bluetoothctl-pair.mjs"), ...args], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` },
      timeout: SPAWN_TIMEOUT_MS,
    });

  it("prints the transcript and exits 0 when the PIN was asked for and the pairing succeeded", () => {
    const r = cli(fakeBluetoothctl("Pairing successful"), [MAC, "1234"]);
    expect(r.stdout).toContain("Pairing successful");
    expect(r.stdout).toContain("outcome=paired pinAsked=true");
    expect(r.status).toBe(0);
  });

  it("exits 1 when the pairing failed", () => {
    const r = cli(fakeBluetoothctl("Failed to pair: org.bluez.Error.AuthenticationFailed"), [
      MAC,
      "1234",
    ]);
    expect(r.stdout).toContain("outcome=failed");
    expect(r.status).toBe(1);
  });

  it("refuses to run without an address and a PIN", () => {
    const r = cli(fakeBluetoothctl("Pairing successful"), [MAC]);
    expect(r.stderr).toContain("usage");
    expect(r.status).toBe(2);
  });
});
