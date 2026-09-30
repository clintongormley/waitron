import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { type PrinterTarget, type Transport, isBluetoothAddress } from "@waitron/print-agent";

/** The channel measured on the owner's printer; see A140's entry in `docs/backlog.md`. */
export const RFCOMM_CHANNEL = 1;
export const RFCOMM_TIMEOUT_MS = 20_000;
/** How long past twice its own timeout the helper may run before it is killed: the timeout bounds
 * its connect and, again, its send. */
export const RFCOMM_GRACE_MS = 5_000;
const STDERR_KEPT = 2048;

export interface RfcommOptions {
  python?: string;
  /** Defaults to `rfcomm-send.py` beside this module: the source file, or the bundle's copy. */
  script?: string;
  channel?: number;
  /** Handed to the helper as its socket timeout. */
  timeoutMs?: number;
  graceMs?: number;
}

/** Node has no Bluetooth sockets, so each job runs a Python helper that writes the bytes it reads on
 * standard input to the printer's serial channel. */
export class RfcommTransport implements Transport {
  private readonly python: string;
  private readonly script: string;
  private readonly channel: number;
  private readonly timeoutMs: number;
  private readonly graceMs: number;

  constructor(options: RfcommOptions = {}) {
    this.python = options.python ?? "python3";
    this.script = options.script ?? fileURLToPath(new URL("./rfcomm-send.py", import.meta.url));
    this.channel = options.channel ?? RFCOMM_CHANNEL;
    this.timeoutMs = options.timeoutMs ?? RFCOMM_TIMEOUT_MS;
    this.graceMs = options.graceMs ?? RFCOMM_GRACE_MS;
  }

  send(printer: PrinterTarget, bytes: Uint8Array): Promise<void> {
    const address = printer.devicePath;
    if (address === null || !isBluetoothAddress(address)) {
      return Promise.reject(
        new Error(`bluetooth printer ${printer.id} has no Bluetooth address: ${address}`),
      );
    }
    const args = [this.script, address, String(this.channel), String(this.timeoutMs / 1000)];
    return new Promise<void>((resolve, reject) => {
      const child = spawn(this.python, args, { stdio: ["pipe", "ignore", "pipe"] });
      let settled = false;
      let stderr = "";
      const settle = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(backstop);
        if (error === undefined) resolve();
        else reject(error);
      };
      const limit = 2 * this.timeoutMs + this.graceMs;
      const backstop = setTimeout(() => {
        child.kill("SIGKILL");
        settle(new Error(`bluetooth printer ${printer.id} timed out after ${limit}ms`));
      }, limit);

      child.once("error", (error) => {
        settle(
          new Error(
            `bluetooth printer ${printer.id}: could not run ${this.python}: ${error.message}`,
          ),
        );
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-STDERR_KEPT);
      });
      child.once("close", (code, signal) => {
        if (code === 0) {
          settle();
          return;
        }
        const reason =
          stderr
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line !== "")
            .at(-1) ?? `the Bluetooth helper exited with ${code ?? signal}`;
        settle(new Error(`bluetooth printer ${printer.id}: ${reason}`));
      });
      // A helper that exits before reading everything breaks the pipe; its exit status reports why.
      child.stdin.on("error", () => {});
      child.stdin.end(Buffer.from(bytes));
    });
  }
}
