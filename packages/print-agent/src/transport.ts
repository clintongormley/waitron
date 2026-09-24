import { writeFile } from "node:fs/promises";
import net from "node:net";

/** Declared here, in the db-free package, so the agent and the server share one wire vocabulary. */
export type PrintTransport = "usb" | "network_tcp" | "bluetooth" | "cloud_poll";

/** What an agent can DISCOVER: a `cloud_poll` printer has no agent (it self-polls). */
export type TransportKind = "usb" | "network_tcp" | "bluetooth";

/** Each adapter validates the nullable fields it requires. */
export interface PrinterTarget {
  id: string;
  transport: PrintTransport;
  host: string | null;
  port: number | null;
  /** A `/dev/usb/lp*` node for USB or a paired RFCOMM node for Bluetooth, resolved from the printer's
   * `local_key` by {@link Host.resolve}. */
  devicePath: string | null;
}

/** Implementations MUST resolve only once the bytes have been handed off, and reject on any delivery
 * failure: the job is marked `done`/`failed` on the promise's settlement. */
export interface Transport {
  send(printer: PrinterTarget, bytes: Uint8Array): Promise<void>;
}

/** Covers BOTH connect and flush. Without it a dead or non-draining printer hangs for the OS TCP
 * timeout, stalling every later job in the agent's serial push. */
export const DEFAULT_TCP_TIMEOUT_MS = 5000;

export interface NetworkTcpOptions {
  /** Per-send inactivity deadline in ms (default {@link DEFAULT_TCP_TIMEOUT_MS}). */
  timeoutMs?: number;
}

export class NetworkTcpTransport implements Transport {
  private readonly timeoutMs: number;

  constructor(options: NetworkTcpOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TCP_TIMEOUT_MS;
  }

  send(printer: PrinterTarget, bytes: Uint8Array): Promise<void> {
    if (printer.host === null) {
      return Promise.reject(new Error(`network_tcp printer ${printer.id} has no host`));
    }
    const host = printer.host;
    const port = printer.port ?? 9100; // the schema default
    return new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      // Node does NOT sever the socket on `'timeout'`; the handler below destroys it.
      socket.setTimeout(this.timeoutMs);
      socket.once("error", reject);
      socket.once("timeout", () => {
        socket.destroy();
        reject(new Error(`network_tcp printer ${printer.id} timed out after ${this.timeoutMs}ms`));
      });
      socket.once("connect", () => {
        // Once flushed, clear the timer so the lingering read-side half-close is not destroyed by a
        // late `'timeout'`.
        socket.end(Buffer.from(bytes), () => {
          socket.setTimeout(0);
          resolve();
        });
      });
    });
  }
}

/** A character device ignores the truncating open; a regular file (the test double) receives exactly
 * the bytes. */
async function writeToDevicePath(
  printer: PrinterTarget,
  bytes: Uint8Array,
  kind: "usb" | "bluetooth",
): Promise<void> {
  if (printer.devicePath === null) {
    throw new Error(`${kind} printer ${printer.id} has no device path`);
  }
  await writeFile(printer.devicePath, Buffer.from(bytes));
}

export class UsbTransport implements Transport {
  send(printer: PrinterTarget, bytes: Uint8Array): Promise<void> {
    return writeToDevicePath(printer, bytes, "usb");
  }
}

export class BluetoothTransport implements Transport {
  send(printer: PrinterTarget, bytes: Uint8Array): Promise<void> {
    return writeToDevicePath(printer, bytes, "bluetooth");
  }
}

export interface TransportAdapters {
  network_tcp: Transport;
  usb: Transport;
  bluetooth: Transport;
}

export class RoutingTransport implements Transport {
  constructor(private readonly adapters: TransportAdapters) {}

  send(printer: PrinterTarget, bytes: Uint8Array): Promise<void> {
    switch (printer.transport) {
      case "network_tcp":
        return this.adapters.network_tcp.send(printer, bytes);
      case "usb":
        return this.adapters.usb.send(printer, bytes);
      case "bluetooth":
        return this.adapters.bluetooth.send(printer, bytes);
      case "cloud_poll":
        // A cloud_poll printer has no agent; a mis-wired caller fails loudly here.
        return Promise.reject(
          new Error(
            `cloud_poll printer ${printer.id} is self-polling; an agent must not push to it`,
          ),
        );
    }
  }
}

/** A byte-capturing test double: records the bytes verbatim instead of touching hardware. */
export class FakeSink implements Transport {
  readonly written: { printerId: string; bytes: Uint8Array }[] = [];

  send(printer: PrinterTarget, bytes: Uint8Array): Promise<void> {
    this.written.push({ printerId: printer.id, bytes });
    return Promise.resolve();
  }
}
