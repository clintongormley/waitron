import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { type PrinterTarget, type Transport, isBluetoothAddress } from "@waitron/print-agent";

/** The channel measured on the owner's printer; see A140's entry in `docs/backlog.md`. */
export const RFCOMM_CHANNEL = 1;
export const RFCOMM_TIMEOUT_MS = 20_000;
/** How long past twice its own timeout the helper may run before it is killed: the timeout bounds
 * its connect and, again, its send. */
export const RFCOMM_GRACE_MS = 5_000;

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
    const limit = 2 * this.timeoutMs + this.graceMs;
    return new Promise<void>((resolve, reject) => {
      const child = execFile(
        this.python,
        args,
        { timeout: limit, killSignal: "SIGKILL", maxBuffer: 1_048_576, encoding: "utf8" },
        (error, _stdout, stderr) => {
          if (error === null) return resolve();
          // Only a failure to start the interpreter names the system call.
          if (error.syscall !== undefined) {
            return reject(
              new Error(
                `bluetooth printer ${printer.id}: could not run ${this.python}: ${error.message}`,
              ),
            );
          }
          if (error.killed) {
            return reject(new Error(`bluetooth printer ${printer.id} timed out after ${limit}ms`));
          }
          const reason =
            stderr
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line !== "")
              .at(-1) ?? `the Bluetooth helper exited with ${error.code ?? error.signal}`;
          reject(new Error(`bluetooth printer ${printer.id}: ${reason}`));
        },
      );
      // A helper that exits before reading everything breaks the pipe; its exit status reports why.
      child.stdin?.on("error", () => {});
      child.stdin?.end(Buffer.from(bytes));
    });
  }
}
