import { type ChildProcessWithoutNullStreams, execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pairWithBluetoothctl, runBluetoothctl } from "./bluetooth-command.js";

vi.mock("node:child_process", () => ({ execFile: vi.fn(), spawn: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
});

describe("runBluetoothctl", () => {
  it("bounds the command and returns its output", async () => {
    vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
      (args[3] as (error: null, stdout: string) => void)(null, "Device AA:BB:CC:DD:EE:FF Printer");
      return undefined as never;
    });
    await expect(runBluetoothctl(["devices"])).resolves.toContain("Printer");
    expect(execFile).toHaveBeenCalledWith(
      "bluetoothctl",
      ["devices"],
      {
        timeout: 15_000,
        killSignal: "SIGKILL",
        maxBuffer: 1_048_576,
        encoding: "utf8",
      },
      expect.any(Function),
    );
  });

  it("kills the command at a shorter deadline when asked", async () => {
    vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
      (args[3] as (error: null, stdout: string) => void)(null, "");
      return undefined as never;
    });
    await runBluetoothctl(["devices", "Paired"], { timeoutMs: 3_000 });
    expect(execFile).toHaveBeenLastCalledWith(
      "bluetoothctl",
      ["devices", "Paired"],
      expect.objectContaining({ timeout: 3_000, killSignal: "SIGKILL" }),
      expect.any(Function),
    );
  });

  it.each(["ENOENT", "command exited 1", "command timed out"])(
    "rejects %s instead of returning an empty scan",
    async (message) => {
      const error = new Error(message);
      vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
        (args[3] as (error: Error, stdout: string) => void)(error, "");
        return undefined as never;
      });
      await expect(runBluetoothctl(["scan", "on"])).rejects.toBe(error);
    },
  );

  // Measured 2026-09-29 on Node v26.7.0: execFile's callback error carries `code`, `killed`,
  // `signal` and `cmd`, and no `stdout`; the output arrives only as the callback's second argument.
  it("keeps what a failed command printed on the error it rejects with", async () => {
    const error = new Error("Command failed: bluetoothctl remove");
    vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
      (args[3] as (error: Error, stdout: string) => void)(error, "Device X not available\n");
      return undefined as never;
    });
    await expect(runBluetoothctl(["remove", "X"])).rejects.toMatchObject({
      stdout: "Device X not available\n",
    });
  });
});

// Chunk shapes measured 2026-09-29 against a stand-in BlueZ with the image's bluetoothctl 5.82,
// stdin/stdout/stderr all pipes.
// Every event line is cleared with "\r" + 79 spaces + "\r" and followed by the coloured prompt with
// no newline; the agent's PIN prompt has no newline either.
const MAC = "86:67:7A:00:00:01";
const PAD = `\r${" ".repeat(79)}\r`;
const SHELL_PROMPT = "\u001b[0;94m[bluetoothctl]> \u001b[0m";
const START = ["Waiting to connect to bluetoothd...", `\r${SHELL_PROMPT}        \b\b\b\b\b\b\b\b`];
const REGISTERED = `${PAD}Agent registered\n${SHELL_PROMPT}`;
const ATTEMPTING = `Attempting to pair with ${MAC}\n${SHELL_PROMPT}${" ".repeat(63)}\r${SHELL_PROMPT}`;
const PIN_PROMPT =
  `${PAD}Request PIN code\n${SHELL_PROMPT}` +
  "\r\u001b[1;39m\u001b[1;39m[agent] Enter PIN code: \u001b[0m\u001b[0m";
const event = (text: string): string => `${PAD}${text}\n${SHELL_PROMPT}`;
const BONDED =
  `${PAD}[\u001b[0;93mCHG\u001b[0m] Device ${MAC} Bonded: yes\n${SHELL_PROMPT}` +
  `${PAD}[\u001b[0;93mCHG\u001b[0m] Device ${MAC} Paired: yes\n${SHELL_PROMPT}`;
const END = "<end>";

/** A bluetoothctl stand-in the test speaks for: `say` is its stdout, `input` what it was sent. By
 * default it exits once its stdin ends, as the measured one does after `quit` or end of input. */
class FakeBluetoothctl extends EventEmitter {
  readonly input: string[] = [];
  readonly kill = vi.fn(() => true);
  readonly stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  readonly stderr = Object.assign(new EventEmitter(), { resume: vi.fn() });
  readonly stdin = Object.assign(new EventEmitter(), {
    write: (text: string) => {
      this.input.push(text);
      return true;
    },
    end: () => {
      this.input.push(END);
      if (this.exitsOnEnd) queueMicrotask(() => this.emit("close", 0, null));
    },
  });

  constructor(private readonly exitsOnEnd = true) {
    super();
  }

  say(...chunks: string[]): void {
    for (const chunk of chunks) this.stdout.emit("data", chunk);
  }

  spawn = vi.fn(() => this as unknown as ChildProcessWithoutNullStreams);
}

function watch<T>(promise: Promise<T>): { settled: () => boolean } {
  let done = false;
  void promise.then(() => (done = true));
  return { settled: () => done };
}

/** Drives a run to the point where bluetoothctl has been asked to pair. */
function registered(pin?: string, child = new FakeBluetoothctl()) {
  const result = pairWithBluetoothctl(MAC, pin, { spawn: child.spawn });
  child.say(...START, REGISTERED, `pair ${MAC}\n`, ATTEMPTING);
  return { child, result };
}

describe("pairWithBluetoothctl — the conversation", () => {
  it("writes nothing until the agent is registered, then asks to pair", async () => {
    const child = new FakeBluetoothctl();
    void pairWithBluetoothctl(MAC.toLowerCase(), "1234", { spawn: child.spawn });
    child.say(...START);
    expect(child.input).toStrictEqual([]);
    child.say(REGISTERED);
    expect(child.input).toStrictEqual([`pair ${MAC}\n`]);
  });

  it("answers the PIN prompt with the PIN once, and only after the prompt appears", async () => {
    const { child, result } = registered("1234");
    expect(child.input).toStrictEqual([`pair ${MAC}\n`]);
    child.say(PIN_PROMPT);
    expect(child.input).toStrictEqual([`pair ${MAC}\n`, "1234\n"]);
    child.say("1234\n", `${SHELL_PROMPT}${" ".repeat(63)}\r${SHELL_PROMPT}`, BONDED);
    child.say(event("Pairing successful"));
    expect(child.input).toStrictEqual([`pair ${MAC}\n`, "1234\n", "quit\n", END]);
    await expect(result).resolves.toStrictEqual({ ok: true, localKey: MAC });
  });

  it("reads a prompt split across chunks, and a prompt only once it is whole", async () => {
    const { child, result } = registered("1234");
    const [head, tail] = [PIN_PROMPT.slice(0, -20), PIN_PROMPT.slice(-20)];
    child.say(head);
    expect(child.input).toStrictEqual([`pair ${MAC}\n`]);
    child.say(tail);
    expect(child.input).toStrictEqual([`pair ${MAC}\n`, "1234\n"]);
    child.say("1234\n", event("Pairing successful"));
    await expect(result).resolves.toMatchObject({ ok: true });
  });

  // rec-silent: after bluetoothd's Cancel, bluetoothctl prints the prompt again before the failure.
  it("does not write the PIN a second time when the prompt comes back", async () => {
    const { child, result } = registered("1234");
    child.say(PIN_PROMPT, "1234\n");
    child.say(
      `${PAD}Request canceled\n\u001b[1;39m\u001b[1;39m[agent] Enter PIN code: \u001b[0m\u001b[0m` +
        event("Failed to pair: org.bluez.Error.AuthenticationFailed"),
    );
    expect(child.input.filter((line) => line === "1234\n")).toHaveLength(1);
    await expect(result).resolves.toStrictEqual({
      ok: false,
      error: "the printer stopped waiting for the PIN",
    });
  });

  it("pairs a printer that never asks for a PIN, with or without one given", async () => {
    for (const pin of [undefined, "1234"]) {
      const { child, result } = registered(pin);
      child.say(BONDED, event("Pairing successful"));
      expect(child.input).toStrictEqual([`pair ${MAC}\n`, "quit\n", END]);
      await expect(result).resolves.toStrictEqual({ ok: true, localKey: MAC });
    }
  });

  // Measured with the stand-in above: ending stdin at the prompt made bluetoothctl answer "" and exit.
  it("answers the PIN prompt by ending its input when no PIN was given, and says a PIN is needed", async () => {
    const { child, result } = registered(undefined);
    child.say(PIN_PROMPT);
    expect(child.input).toStrictEqual([`pair ${MAC}\n`, END]);
    await expect(result).resolves.toStrictEqual({ ok: false, error: "this printer needs a PIN" });
  });

  // Prompt texts READ from bluez 5.82 client/agent.c; not measured.
  it.each([
    "Enter passkey (number in 0-999999):",
    "Confirm passkey 123456 (yes/no):",
    "Accept pairing (yes/no):",
  ])("refuses the %s prompt with `no` and reports the method unsupported", async (prompt) => {
    const { child, result } = registered("1234");
    child.say(`${PAD}Request\n${SHELL_PROMPT}\r\u001b[1;39m[agent] ${prompt} \u001b[0m`);
    expect(child.input).toStrictEqual([`pair ${MAC}\n`, "no\n", "quit\n", END]);
    await expect(result).resolves.toStrictEqual({
      ok: false,
      error: "this printer asked for a pairing method we do not support",
    });
  });

  it("ignores an agent message that is not a prompt", async () => {
    const { child, result } = registered("1234");
    child.say(event("\u001b[1;39m[agent]\u001b[0m PIN code: 0000"), event("Pairing successful"));
    expect(child.input).toStrictEqual([`pair ${MAC}\n`, "quit\n", END]);
    await expect(result).resolves.toMatchObject({ ok: true });
  });
});

describe("pairWithBluetoothctl — outcomes", () => {
  it("reads AuthenticationFailed after the PIN was written as a wrong PIN", async () => {
    const { child, result } = registered("9999");
    child.say(PIN_PROMPT, "9999\n", event("Failed to pair: org.bluez.Error.AuthenticationFailed"));
    await expect(result).resolves.toStrictEqual({ ok: false, error: "wrong PIN" });
    expect(child.input.slice(-2)).toStrictEqual(["quit\n", END]);
  });

  it("does not call AuthenticationFailed a wrong PIN when no PIN was ever asked for", async () => {
    const { child, result } = registered("1234");
    child.say(event("Failed to pair: org.bluez.Error.AuthenticationFailed"));
    await expect(result).resolves.toStrictEqual({
      ok: false,
      error: "pairing failed: org.bluez.Error.AuthenticationFailed",
    });
  });

  it("reads ConnectionAttemptFailed as a printer that is off or out of range", async () => {
    const { child, result } = registered("1234");
    child.say(event("Failed to pair: org.bluez.Error.ConnectionAttemptFailed"));
    await expect(result).resolves.toStrictEqual({
      ok: false,
      error: "printer is off or out of range",
    });
  });

  it("reads AlreadyExists as success, because already paired is the goal state", async () => {
    const { child, result } = registered("1234");
    child.say(event("Failed to pair: org.bluez.Error.AlreadyExists"));
    await expect(result).resolves.toStrictEqual({ ok: true, localKey: MAC });
    expect(child.input.slice(-2)).toStrictEqual(["quit\n", END]);
  });

  it("names any other failure BlueZ reports", async () => {
    const { child, result } = registered("1234");
    child.say(event("Failed to pair: org.bluez.Error.InProgress"));
    await expect(result).resolves.toStrictEqual({
      ok: false,
      error: "pairing failed: org.bluez.Error.InProgress",
    });
  });

  it("names a D-Bus refusal of the pair call, such as one from the AppArmor profile", async () => {
    const { child, result } = registered("1234");
    child.say(event("Failed to pair: org.freedesktop.DBus.Error.AccessDenied"));
    await expect(result).resolves.toStrictEqual({
      ok: false,
      error: "pairing failed: org.freedesktop.DBus.Error.AccessDenied",
    });
  });

  // rec0-unknown: bluetoothctl checks its own device list and makes no D-Bus call.
  it("reads an address bluetoothctl does not list as not found, and says to scan", async () => {
    const child = new FakeBluetoothctl();
    const result = pairWithBluetoothctl(MAC, "1234", { spawn: child.spawn });
    child.say(...START, REGISTERED, `pair ${MAC}\n`, event(`Device ${MAC} not available`));
    await expect(result).resolves.toStrictEqual({
      ok: false,
      error: "printer not found — scan first",
    });
  });

  it("does not read another address being unavailable as this one", async () => {
    vi.useFakeTimers();
    const { child, result } = registered("1234");
    child.say(event("Device 11:22:33:44:55:66 not available"));
    const run = watch(result);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run.settled()).toBe(false);
    expect(child.input).toStrictEqual([`pair ${MAC}\n`]);
    child.say(event("Pairing successful"));
    await expect(result).resolves.toMatchObject({ ok: true });
  });

  // bluez 5.82 client/main.c: `pair` looks the device up through check_default_ctrl, which prints
  // this line when there is no controller. READ, not measured.
  it("reports a box with no Bluetooth controller", async () => {
    const { child, result } = registered("1234");
    child.say(event("No default controller available"));
    await expect(result).resolves.toStrictEqual({
      ok: false,
      error: "No default controller available",
    });
  });

  // bluez 5.82 client/agent.c register_agent_reply; READ, not measured.
  it("reports an agent BlueZ refused to register, naming the refusal, and never asks to pair", async () => {
    const child = new FakeBluetoothctl();
    const result = pairWithBluetoothctl(MAC, "1234", { spawn: child.spawn });
    child.say(...START, event("Failed to register agent: org.freedesktop.DBus.Error.AccessDenied"));
    await expect(result).resolves.toStrictEqual({
      ok: false,
      error: "bluetooth agent refused: org.freedesktop.DBus.Error.AccessDenied",
    });
    expect(child.input).toStrictEqual(["quit\n", END]);
  });

  it("reports bluetooth unavailable when bluetoothctl exits before registering its agent", async () => {
    const child = new FakeBluetoothctl();
    const result = pairWithBluetoothctl(MAC, "1234", { spawn: child.spawn });
    child.say(START[0]!);
    child.emit("close", 1, null);
    await expect(result).resolves.toStrictEqual({ ok: false, error: "bluetooth unavailable" });
  });

  it("reports a pairing that ended without an outcome, with the last thing printed", async () => {
    const { child, result } = registered("1234");
    child.say(event("Request PIN code"));
    child.emit("close", 0, null);
    await expect(result).resolves.toStrictEqual({
      ok: false,
      error: "pairing did not complete: Request PIN code",
    });
  });

  it("does not count bluetoothctl's own prompt as the last thing printed", async () => {
    const { child, result } = registered("1234");
    child.say(`${SHELL_PROMPT}${" ".repeat(63)}\r${SHELL_PROMPT}\r`);
    child.emit("close", 0, null);
    await expect(result).resolves.toStrictEqual({
      ok: false,
      error: `pairing did not complete: Attempting to pair with ${MAC}`,
    });
  });

  it("reports the last thing printed as it was when no PIN was given", async () => {
    const { child, result } = registered(undefined);
    child.say(event("Request canceled"));
    child.emit("close", 0, null);
    await expect(result).resolves.toStrictEqual({
      ok: false,
      error: "pairing did not complete: Request canceled",
    });
  });

  it("reports a pairing that ended without printing anything after the request", async () => {
    const child = new FakeBluetoothctl();
    const result = pairWithBluetoothctl(MAC, "1234", { spawn: child.spawn });
    child.say(REGISTERED);
    child.emit("close", 0, null);
    await expect(result).resolves.toStrictEqual({
      ok: false,
      error: "pairing did not complete",
    });
  });

  // Measured 2026-09-29 on Node v26.7.0: spawn THROWS for an invalid argument (a null byte in the
  // file name, ERR_INVALID_ARG_VALUE), while ENOENT and EMFILE arrive as an 'error' event.
  it("reports a spawn that throws rather than rejecting", async () => {
    const spawn = vi.fn((): never => {
      throw new Error("The argument 'file' must be a string without null bytes");
    });
    await expect(pairWithBluetoothctl(MAC, "1234", { spawn })).resolves.toStrictEqual({
      ok: false,
      error: "The argument 'file' must be a string without null bytes",
    });
  });

  it("reports a spawn that throws something other than an Error", async () => {
    const spawn = vi.fn((): never => {
      throw "no process slots";
    });
    await expect(pairWithBluetoothctl(MAC, "1234", { spawn })).resolves.toStrictEqual({
      ok: false,
      error: "no process slots",
    });
  });

  it("reports a bluetoothctl that could not be started", async () => {
    const child = new FakeBluetoothctl();
    const result = pairWithBluetoothctl(MAC, "1234", { spawn: child.spawn });
    child.emit("error", new Error("spawn bluetoothctl ENOENT"));
    child.emit("close", -2, null);
    await expect(result).resolves.toStrictEqual({
      ok: false,
      error: "spawn bluetoothctl ENOENT",
    });
  });

  it("drains stderr and survives a write to a stdin that has closed", async () => {
    const { child, result } = registered("1234");
    expect(child.stderr.resume).toHaveBeenCalled();
    expect(child.stdout.setEncoding).toHaveBeenCalledWith("utf8");
    child.stdin.emit("error", new Error("write EPIPE"));
    child.say(event("Pairing successful"));
    await expect(result).resolves.toMatchObject({ ok: true });
  });
});

// bluetoothctl echoes the PIN on a line of its own (every piped run measured). Of the lines printed
// after the PIN was written, only a D-Bus error name (`org.bluez.Error.` or
// `org.freedesktop.DBus.Error.` followed by letters) from a `Failed to pair:` line is quoted, and
// nothing quoted is altered: a masked copy of a line the reader can reconstruct (the address) would
// give the PIN away by its gaps.
describe("pairWithBluetoothctl — the PIN never leaves the runner", () => {
  const PIN = "Zq7~";

  it("never quotes a line printed after the PIN was written when pairing ends without an outcome", async () => {
    const { child, result } = registered(PIN);
    child.say(PIN_PROMPT, `${PIN}\n`);
    child.emit("close", 0, null);
    const outcome = await result;
    expect(outcome).toStrictEqual({
      ok: false,
      error: "pairing did not complete: Request PIN code",
    });
    expect(JSON.stringify(outcome)).not.toContain(PIN);
  });

  it("quotes an earlier line exactly as printed, even when the PIN occurs inside the address", async () => {
    const { child, result } = registered("00");
    child.emit("close", 0, null);
    await expect(result).resolves.toStrictEqual({
      ok: false,
      error: `pairing did not complete: Attempting to pair with ${MAC}`,
    });
  });

  // A `Failed to pair: ` line holds spaces, which a PIN cannot, so it is never the echo; the name
  // after it is BlueZ's (READ, bluez 5.82 client/main.c pair_reply prints error.name).
  it("quotes BlueZ's error name exactly as printed, even when the PIN occurs inside it", async () => {
    const { child, result } = registered("Progress");
    child.say(PIN_PROMPT, "Progress\n", event("Failed to pair: org.bluez.Error.InProgress"));
    await expect(result).resolves.toStrictEqual({
      ok: false,
      error: "pairing failed: org.bluez.Error.InProgress",
    });
  });

  it("quotes a D-Bus error name printed after the PIN", async () => {
    const { child, result } = registered(PIN);
    child.say(
      PIN_PROMPT,
      `${PIN}\n`,
      event("Failed to pair: org.freedesktop.DBus.Error.AccessDenied"),
    );
    await expect(result).resolves.toStrictEqual({
      ok: false,
      error: "pairing failed: org.freedesktop.DBus.Error.AccessDenied",
    });
  });

  it.each([PIN, "x 1234", "org.bluez.Error.In Progress", "org.bluez.Error."])(
    "quotes nothing from a failure whose name is not shaped like a D-Bus error name: %j",
    async (name) => {
      const { child, result } = registered(PIN);
      child.say(PIN_PROMPT, `${PIN}\n`, event(`Failed to pair: ${name}`));
      await expect(result).resolves.toStrictEqual({ ok: false, error: "pairing failed" });
    },
  );

  it("never alters the runner's own words, even when the PIN occurs in them", async () => {
    const { child, result } = registered("PIN");
    child.say(PIN_PROMPT, "PIN\n", event("Failed to pair: org.bluez.Error.AuthenticationFailed"));
    await expect(result).resolves.toStrictEqual({ ok: false, error: "wrong PIN" });
  });

  it("does not put a refused PIN in the error it reports", async () => {
    const child = new FakeBluetoothctl();
    const outcome = await pairWithBluetoothctl(MAC, "12 34", { spawn: child.spawn });
    expect(outcome).toStrictEqual({
      ok: false,
      error: "a PIN is 1 to 16 printable characters, with no spaces",
    });
    expect(JSON.stringify(outcome)).not.toContain("12 34");
  });
});

describe("pairWithBluetoothctl — refused before spawning", () => {
  it.each(["*", "", "86:67:7A:00:00", "86-67-7A-00-00-01"])(
    "refuses the address %j without starting bluetoothctl",
    async (address) => {
      const child = new FakeBluetoothctl();
      expect(await pairWithBluetoothctl(address, "1234", { spawn: child.spawn })).toStrictEqual({
        ok: false,
        error: "not a Bluetooth address",
      });
      expect(child.spawn).not.toHaveBeenCalled();
    },
  );

  it.each(["", "1".repeat(17), "12\n34", "12\r34", "12€4"])(
    "refuses the PIN %j without starting bluetoothctl",
    async (pin) => {
      const child = new FakeBluetoothctl();
      expect(await pairWithBluetoothctl(MAC, pin, { spawn: child.spawn })).toStrictEqual({
        ok: false,
        error: "a PIN is 1 to 16 printable characters, with no spaces",
      });
      expect(child.spawn).not.toHaveBeenCalled();
    },
  );
});

describe("pairWithBluetoothctl — deadlines", () => {
  it("gives up on a bluetoothctl that has not registered its agent after 10 seconds", async () => {
    vi.useFakeTimers();
    const child = new FakeBluetoothctl();
    const run = watch(pairWithBluetoothctl(MAC, "1234", { spawn: child.spawn }));
    child.say(START[0]!);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(child.input).toStrictEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(child.input).toStrictEqual([END]);
    expect(run.settled()).toBe(true);
  });

  it("gives up 75 seconds after asking to pair, ending input rather than writing quit", async () => {
    vi.useFakeTimers();
    const child = new FakeBluetoothctl();
    const result = pairWithBluetoothctl(MAC, "1234", { spawn: child.spawn });
    await vi.advanceTimersByTimeAsync(9_000);
    child.say(REGISTERED);
    const run = watch(result);
    await vi.advanceTimersByTimeAsync(74_999);
    expect(child.input).toStrictEqual([`pair ${MAC}\n`]);
    await vi.advanceTimersByTimeAsync(1);
    expect(child.input).toStrictEqual([`pair ${MAC}\n`, END]);
    expect(run.settled()).toBe(true);
    await expect(result).resolves.toStrictEqual({ ok: false, error: "pairing timed out" });
  });

  it("kills a bluetoothctl that has not exited 5 seconds after being told to quit", async () => {
    vi.useFakeTimers();
    const { child, result } = registered("1234", new FakeBluetoothctl(false));
    const run = watch(result);
    child.say(event("Pairing successful"));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(child.kill).not.toHaveBeenCalled();
    expect(run.settled()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    await expect(result).resolves.toStrictEqual({ ok: true, localKey: MAC });
  });

  it("kills a bluetoothctl that ignores the end of its input after a deadline", async () => {
    vi.useFakeTimers();
    const child = new FakeBluetoothctl(false);
    const result = pairWithBluetoothctl(MAC, "1234", { spawn: child.spawn });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(child.input).toStrictEqual([END]);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    await expect(result).resolves.toStrictEqual({ ok: false, error: "bluetooth unavailable" });
  });

  it("never kills a bluetoothctl that exited on quit", async () => {
    vi.useFakeTimers();
    const { child, result } = registered("1234");
    child.say(event("Pairing successful"));
    await result;
    await vi.advanceTimersByTimeAsync(80_000);
    expect(child.kill).not.toHaveBeenCalled();
  });
});
