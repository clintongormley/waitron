import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { type PairResult, isBluetoothAddress, isBluetoothPin } from "@waitron/print-agent";

export interface BluetoothctlRunOptions {
  /** Kills bluetoothctl after this long; its error then carries `killed: true`. */
  timeoutMs?: number;
}

/** A non-zero exit rejects with the error carrying what was printed as `stdout`, because
 * bluetoothctl reports some outcomes (an address it no longer knows, on `remove`) by exiting 1. */
export function runBluetoothctl(
  args: string[],
  opts: BluetoothctlRunOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "bluetoothctl",
      args,
      {
        timeout: opts.timeoutMs ?? 15_000,
        killSignal: "SIGKILL",
        maxBuffer: 1_048_576,
        encoding: "utf8",
      },
      (error, stdout) => {
        if (error) reject(Object.assign(error, { stdout }));
        else resolve(stdout);
      },
    );
  });
}

// eslint-disable-next-line no-control-regex -- bluetoothctl colours its output; strip CSI SGR codes.
export const ANSI = /\x1b\[[0-9;]*m/g;
export const NO_CONTROLLER = "No default controller available";
export const NOT_AN_ADDRESS = "not a Bluetooth address";

const BAD_PIN = "a PIN is 1 to 16 printable characters, with no spaces";
const UNAVAILABLE = "bluetooth unavailable";
const INCOMPLETE = "pairing did not complete";
const REGISTER_TIMEOUT_MS = 10_000;
/** bluetoothd waits 60 s for an agent's answer, plus paging the printer, plus the 3 s before
 * bluetoothd retries a bonding after a refused automatic PIN (research-pin-report.md, step 4). */
const PAIR_TIMEOUT_MS = 75_000;
const EXIT_GRACE_MS = 5_000;
// bluez 5.82 client/agent.c: every agent question is "[agent] <text>:" with no newline after it.
const AGENT_PROMPT = /^\[agent\] .*:$/;
const PIN_PROMPT = "[agent] Enter PIN code:";
const SHELL_PROMPT = "[bluetoothctl]>";

export interface BluetoothctlPairOptions {
  spawn?: () => ChildProcessWithoutNullStreams;
}

function spawnBluetoothctl(): ChildProcessWithoutNullStreams {
  return spawn("bluetoothctl", [], { stdio: ["pipe", "pipe", "pipe"] });
}

/**
 * Pairs through bluetoothctl's interactive shell, because its one-shot `pair` registers no agent and
 * so cannot answer a PIN request. The conversation was measured against a stand-in BlueZ with the
 * image's bluetoothctl 5.82 (P2b research-pin-report.md); the lines the tests mark READ (a refused
 * agent, no controller, the non-PIN prompts) come from the bluez 5.82 source and were not run. The
 * exit status is ignored: it was 0 whatever the outcome once `quit` was written. bluetoothctl echoes
 * the PIN to stdout, so every error that carries printed text has the PIN masked.
 */
export function pairWithBluetoothctl(
  mac: string,
  pin: string | undefined,
  opts: BluetoothctlPairOptions = {},
): Promise<PairResult> {
  if (!isBluetoothAddress(mac)) return Promise.resolve({ ok: false, error: NOT_AN_ADDRESS });
  if (pin !== undefined && !isBluetoothPin(pin))
    return Promise.resolve({ ok: false, error: BAD_PIN });
  const address = mac.toUpperCase();
  /** For text bluetoothctl printed, which can carry the PIN it echoed; never the runner's own words. */
  const mask = (printed: string): string =>
    pin === undefined ? printed : printed.replaceAll(pin, "****");
  const fail = (error: string): PairResult => ({ ok: false, error });

  return new Promise((resolve) => {
    const child = (opts.spawn ?? spawnBluetoothctl)();
    let phase: "registering" | "pairing" | "closing" = "registering";
    let pinWritten = false;
    let pending = "";
    let lastLine: string | undefined;
    let outcome: PairResult | undefined;
    let deadline = setTimeout(() => finish(fail(UNAVAILABLE), "end"), REGISTER_TIMEOUT_MS);
    let grace: NodeJS.Timeout | undefined;

    const settle = (): void => {
      clearTimeout(deadline);
      clearTimeout(grace);
      resolve(outcome!);
    };
    const finish = (result: PairResult, how: "quit" | "end"): void => {
      phase = "closing";
      outcome = result;
      clearTimeout(deadline);
      grace = setTimeout(() => {
        child.kill("SIGKILL");
        settle();
      }, EXIT_GRACE_MS);
      if (how === "quit") child.stdin.write("quit\n");
      child.stdin.end();
    };

    const onPrompt = (prompt: string): void => {
      if (!prompt.includes(PIN_PROMPT)) {
        child.stdin.write("no\n");
        finish(fail("this printer asked for a pairing method we do not support"), "quit");
      } else if (pinWritten) {
        return;
      } else if (pin === undefined) {
        // Measured (pipe-eof): at the end of its input bluetoothctl answers the request with "" and exits.
        finish(fail("this printer needs a PIN"), "end");
      } else {
        child.stdin.write(`${pin}\n`);
        pinWritten = true;
      }
    };

    const onPairingLine = (line: string): void => {
      if (AGENT_PROMPT.test(line)) return onPrompt(line);
      if (!line.startsWith(SHELL_PROMPT)) lastLine = line;
      if (line === "Pairing successful") return finish({ ok: true, localKey: address }, "quit");
      if (line === NO_CONTROLLER) return finish(fail(NO_CONTROLLER), "quit");
      if (line.toUpperCase() === `DEVICE ${address} NOT AVAILABLE`)
        return finish(fail("printer not found — scan first"), "quit");
      const failed = /^Failed to pair: (.+)$/.exec(line);
      if (failed === null) return;
      const name = failed[1]!;
      if (name === "org.bluez.Error.AlreadyExists") finish({ ok: true, localKey: address }, "quit");
      else if (name === "org.bluez.Error.AuthenticationFailed" && pinWritten)
        finish(fail("wrong PIN"), "quit");
      else if (name === "org.bluez.Error.ConnectionAttemptFailed")
        finish(fail("printer is off or out of range"), "quit");
      else finish(fail(`pairing failed: ${mask(name)}`), "quit");
    };

    const onLine = (line: string): void => {
      if (line === "" || phase === "closing") return;
      if (phase === "pairing") return onPairingLine(line);
      if (line === "Agent registered") {
        clearTimeout(deadline);
        phase = "pairing";
        child.stdin.write(`pair ${address}\n`);
        deadline = setTimeout(() => finish(fail("pairing timed out"), "end"), PAIR_TIMEOUT_MS);
        return;
      }
      const refused = /^Failed to register agent: (.+)$/.exec(line);
      if (refused !== null) finish(fail(`bluetooth agent refused: ${mask(refused[1]!)}`), "quit");
    };

    const clean = (fragment: string): string =>
      fragment.replace(ANSI, "").replaceAll("\b", "").trim();

    child.stdin.on("error", () => {});
    child.stderr.resume();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const fragments = (pending + chunk).split(/[\r\n]/);
      pending = fragments.pop()!;
      for (const fragment of fragments) onLine(clean(fragment));
      // A prompt is never followed by a newline, so it is read from the unfinished fragment.
      if (phase === "pairing" && AGENT_PROMPT.test(clean(pending))) {
        const prompt = clean(pending);
        pending = "";
        onPrompt(prompt);
      }
    });
    child.on("error", (error: Error) => {
      outcome ??= fail(error.message);
      phase = "closing";
      settle();
    });
    child.on("close", () => {
      if (phase === "registering") finish(fail(UNAVAILABLE), "end");
      else if (phase === "pairing")
        finish(
          fail(lastLine === undefined ? INCOMPLETE : `${INCOMPLETE}: ${mask(lastLine)}`),
          "end",
        );
      settle();
    });
  });
}
