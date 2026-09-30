import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrinterTarget } from "@waitron/print-agent";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RfcommTransport } from "./rfcomm.js";

const ADDRESS = "5A:4A:45:D4:FB:BB";
const ERRNO_97 = `rfcomm ${ADDRESS} channel 1: [Errno 97] Address family not supported by protocol`;

// Stands in for the interpreter: it records its arguments, its pid and its standard input under
// WT_RFCOMM_OUT, then does what the case's environment asks. `exec sleep` keeps the pid, so the
// recorded pid is the process a kill must reach.
const STUB = [
  "#!/bin/sh",
  'if [ -n "$WT_RFCOMM_EARLY" ]; then printf \'%s\\n\' "$WT_RFCOMM_STDERR" >&2; exit 1; fi',
  'printf \'%s\\n\' "$@" > "$WT_RFCOMM_OUT/argv"',
  'echo $$ > "$WT_RFCOMM_OUT/pid"',
  'cat > "$WT_RFCOMM_OUT/stdin"',
  'if [ -n "$WT_RFCOMM_HANG" ]; then exec sleep 30; fi',
  'if [ -n "$WT_RFCOMM_SLEEP" ]; then sleep "$WT_RFCOMM_SLEEP"; fi',
  'if [ -n "$WT_RFCOMM_SIGNAL" ]; then kill -TERM $$; fi',
  'if [ -n "$WT_RFCOMM_STDERR" ]; then printf \'%s\' "$WT_RFCOMM_STDERR" >&2; fi',
  'exit "${WT_RFCOMM_EXIT:-0}"',
].join("\n");

const CONTROLS = [
  "WT_RFCOMM_OUT",
  "WT_RFCOMM_EARLY",
  "WT_RFCOMM_HANG",
  "WT_RFCOMM_SLEEP",
  "WT_RFCOMM_SIGNAL",
  "WT_RFCOMM_STDERR",
  "WT_RFCOMM_EXIT",
] as const;

let bin: string;
let stub: string;
let out: string;
let savedPath: string | undefined;

beforeAll(async () => {
  bin = await mkdtemp(join(tmpdir(), "print-agent-rfcomm-bin-"));
  // Named `python3` so the default interpreter finds it on PATH.
  stub = join(bin, "python3");
  await writeFile(stub, `${STUB}\n`);
  await chmod(stub, 0o755);
});
afterAll(async () => {
  await rm(bin, { recursive: true, force: true });
});

beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), "print-agent-rfcomm-out-"));
  process.env.WT_RFCOMM_OUT = out;
  savedPath = process.env.PATH;
});
afterEach(async () => {
  process.env.PATH = savedPath;
  for (const name of CONTROLS) delete process.env[name];
  await rm(out, { recursive: true, force: true });
});

function target(over: Partial<PrinterTarget> = {}): PrinterTarget {
  return {
    id: "p1",
    transport: "bluetooth",
    host: null,
    port: null,
    devicePath: ADDRESS,
    ...over,
  };
}

const argv = async (): Promise<string[]> =>
  (await readFile(join(out, "argv"), "utf8")).split("\n").slice(0, -1);

describe("RfcommTransport", () => {
  it("hands the script, address, channel and timeout in seconds to the interpreter, and the job's bytes on its standard input", async () => {
    const bytes = new Uint8Array([0x1b, 0x40, 0x00, 0x0a, 0xff, 0x41]);
    const transport = new RfcommTransport({
      python: stub,
      script: "/opt/helper/rfcomm-send.py",
      channel: 3,
      timeoutMs: 1500,
    });
    await expect(transport.send(target(), bytes)).resolves.toBeUndefined();
    expect(await argv()).toStrictEqual(["/opt/helper/rfcomm-send.py", ADDRESS, "3", "1.5"]);
    expect(new Uint8Array(await readFile(join(out, "stdin")))).toStrictEqual(bytes);
  });

  it("runs python3 from PATH on the helper beside this module, over channel 1 with a 20 second timeout, by default", async () => {
    process.env.PATH = `${bin}${delimiter}${savedPath ?? ""}`;
    await new RfcommTransport().send(target(), new Uint8Array([0x41]));
    expect(await argv()).toStrictEqual([
      fileURLToPath(new URL("./rfcomm-send.py", import.meta.url)),
      ADDRESS,
      "1",
      "20",
    ]);
  });

  it("rejects with the helper's last non-empty error line when it exits non-zero", async () => {
    process.env.WT_RFCOMM_EXIT = "1";
    process.env.WT_RFCOMM_STDERR = `a first line\n${ERRNO_97}\n\n`;
    await expect(
      new RfcommTransport({ python: stub }).send(target(), new Uint8Array([0x41])),
    ).rejects.toThrow(new Error(`bluetooth printer p1: ${ERRNO_97}`));
  });

  it("names the exit code when the helper exits non-zero without saying why", async () => {
    process.env.WT_RFCOMM_EXIT = "3";
    await expect(
      new RfcommTransport({ python: stub }).send(target(), new Uint8Array([0x41])),
    ).rejects.toThrow(new Error("bluetooth printer p1: the Bluetooth helper exited with 3"));
  });

  it("names the signal when the helper is killed", async () => {
    process.env.WT_RFCOMM_SIGNAL = "1";
    await expect(
      new RfcommTransport({ python: stub }).send(target(), new Uint8Array([0x41])),
    ).rejects.toThrow(new Error("bluetooth printer p1: the Bluetooth helper exited with SIGTERM"));
  });

  it("rejects with the helper's error when it dies before reading a job larger than a pipe holds", async () => {
    process.env.WT_RFCOMM_EARLY = "1";
    process.env.WT_RFCOMM_STDERR = ERRNO_97;
    await expect(
      new RfcommTransport({ python: stub }).send(target(), new Uint8Array(4 * 1024 * 1024)),
    ).rejects.toThrow(new Error(`bluetooth printer p1: ${ERRNO_97}`));
  });

  it("rejects, naming the interpreter, when it cannot be started", async () => {
    const missing = join(bin, "no-such-python");
    const sent = new RfcommTransport({ python: missing }).send(target(), new Uint8Array([0x41]));
    await expect(sent).rejects.toThrow(`bluetooth printer p1: could not run ${missing}`);
    await expect(sent).rejects.toThrow(/ENOENT/);
  });

  it("kills a helper that has not exited by twice the timeout plus the grace period, and rejects", async () => {
    process.env.WT_RFCOMM_HANG = "1";
    const started = Date.now();
    await expect(
      new RfcommTransport({ python: stub, timeoutMs: 200, graceMs: 200 }).send(
        target(),
        new Uint8Array([0x41]),
      ),
    ).rejects.toThrow(new Error("bluetooth printer p1 timed out after 600ms"));
    expect(Date.now() - started).toBeGreaterThanOrEqual(595);
    const pid = Number(await readFile(join(out, "pid"), "utf8"));
    await expect.poll(() => isAlive(pid), { timeout: 2000 }).toBe(false);
  });

  // The helper's timeout bounds its connect and, again, its send, so a healthy job can take up to
  // twice it.
  it("lets a helper finish that runs past its timeout but within twice it", async () => {
    process.env.WT_RFCOMM_SLEEP = "1.6";
    await expect(
      new RfcommTransport({ python: stub, timeoutMs: 1000, graceMs: 300 }).send(
        target(),
        new Uint8Array([0x41]),
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["has no device path", null],
    ["has a device path that is not a Bluetooth address", "/dev/rfcomm0"],
  ])("rejects without running the helper when the printer %s", async (_, devicePath) => {
    const sent = new RfcommTransport({ python: stub }).send(
      target({ devicePath }),
      new Uint8Array([0x41]),
    );
    await expect(sent).rejects.toThrow(/^bluetooth printer p1 /);
    await expect(sent).rejects.toThrow(/Bluetooth address/);
    await expect(readFile(join(out, "argv"))).rejects.toThrow(/ENOENT/);
  });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
