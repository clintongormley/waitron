import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { type PrinterTarget, type Transport, isBluetoothAddress } from "@waitron/print-agent";

/** Fallback for devices that advertise no unambiguous serial channel. */
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
  sdptool?: string;
  lookupTimeoutMs?: number;
  /** Handed to the helper as its socket timeout. */
  timeoutMs?: number;
  graceMs?: number;
}

/** Node has no Bluetooth sockets, so each job runs a Python helper that writes the bytes it reads on
 * standard input to the printer's serial channel. */
export class RfcommTransport implements Transport {
  private readonly python: string;
  private readonly script: string;
  private readonly channel: number | undefined;
  private readonly sdptool: string;
  private readonly lookupTimeoutMs: number;
  private readonly channels = new Map<string, number>();
  private readonly timeoutMs: number;
  private readonly graceMs: number;

  constructor(options: RfcommOptions = {}) {
    this.python = options.python ?? "python3";
    this.script = options.script ?? fileURLToPath(new URL("./rfcomm-send.py", import.meta.url));
    this.channel = options.channel;
    this.sdptool = options.sdptool ?? "sdptool";
    this.lookupTimeoutMs = options.lookupTimeoutMs ?? 3000;
    this.timeoutMs = options.timeoutMs ?? RFCOMM_TIMEOUT_MS;
    this.graceMs = options.graceMs ?? RFCOMM_GRACE_MS;
  }

  private lookupChannel(address: string): Promise<number> {
    return new Promise((resolve) => {
      execFile(
        this.sdptool,
        ["search", "--bdaddr", address, "SP"],
        {
          timeout: this.lookupTimeoutMs,
          killSignal: "SIGKILL",
          maxBuffer: 1_048_576,
          encoding: "utf8",
        },
        (error, stdout) => {
          if (error !== null) return resolve(RFCOMM_CHANNEL);
          const channels = new Set(
            [...stdout.matchAll(/^\s*Channel:\s*(\d+)\s*$/gm)]
              .map((match) => Number(match[1]))
              .filter((channel) => channel >= 1 && channel <= 30),
          );
          const channel = channels.size === 1 ? channels.values().next().value! : RFCOMM_CHANNEL;
          this.channels.set(address, channel);
          resolve(channel);
        },
      );
    });
  }

  async send(printer: PrinterTarget, bytes: Uint8Array): Promise<void> {
    const address = printer.devicePath;
    if (address === null || !isBluetoothAddress(address)) {
      return Promise.reject(
        new Error(`bluetooth printer ${printer.id} has no Bluetooth address: ${address}`),
      );
    }
    const channel =
      this.channel ?? this.channels.get(address) ?? (await this.lookupChannel(address));
    const args = [this.script, address, String(channel), String(this.timeoutMs / 1000)];
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
    }).catch((error: unknown) => {
      this.channels.delete(address);
      throw error;
    });
  }
}
