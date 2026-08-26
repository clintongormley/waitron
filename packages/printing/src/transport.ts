import { writeFile } from "node:fs/promises";
import net from "node:net";
import type { PrintTransport } from "./printers.js";

/**
 * The transport layer (design §3c) — the hardware seam the agent runtime pushes claimed jobs through.
 * One interface, `Transport.send(printer, bytes)`, with the two LOCAL adapters this slice wires
 * (`network_tcp`, `usb`), a `RoutingTransport` that dispatches by the printer's transport, and a
 * byte-capturing `FakeSink` for tests. CI never touches real hardware — the loopback-TCP and temp-file
 * tests exercise the adapters, and the runtime suites push through the fake sink (the deli-hardware
 * verification approach; real printers are verified manually, design §5).
 */

/**
 * The connection facts a transport needs to reach one printer — the runtime reads them off the
 * claimed job's joined `printers` row and hands them here. All connection fields are nullable at the
 * source (transport-specific columns); each adapter validates the ones it requires.
 */
export interface PrinterTarget {
  id: string;
  transport: PrintTransport;
  host: string | null;
  port: number | null;
  usbPath: string | null;
}

/** How a batch of bytes reaches one printer. Implementations MUST resolve only once the bytes have
 * been handed off (flushed for TCP, written for USB) and reject on any delivery failure, so the
 * runtime can mark the job `done`/`failed` on the promise's settlement. */
export interface Transport {
  send(printer: PrinterTarget, bytes: Uint8Array): Promise<void>;
}

/** The ESC/POS-over-TCP:9100 adapter (design §3c / the deli-hardware `ReceiptPrinter`). Opens a
 * socket to the printer's `host:port`, writes the bytes, closes. */
export class NetworkTcpTransport implements Transport {
  send(printer: PrinterTarget, bytes: Uint8Array): Promise<void> {
    if (printer.host === null) {
      return Promise.reject(new Error(`network_tcp printer ${printer.id} has no host`));
    }
    const host = printer.host;
    const port = printer.port ?? 9100; // the schema default, applied here too for a target read raw
    return new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      // A single settle: an error before OR after connect rejects; a clean flush+close resolves.
      socket.once("error", reject);
      socket.once("connect", () => {
        // `end(data, cb)` writes the bytes, half-closes, and calls back once the stream has finished
        // flushing — the point at which the printer has the payload.
        socket.end(Buffer.from(bytes), () => resolve());
      });
    });
  }
}

/** The USB adapter — writes the bytes to the printer's device path on the agent's box (design §3c).
 * A character device ignores the truncating open; a regular file (the test double) receives exactly
 * the bytes. */
export class UsbTransport implements Transport {
  async send(printer: PrinterTarget, bytes: Uint8Array): Promise<void> {
    if (printer.usbPath === null) throw new Error(`usb printer ${printer.id} has no usb_path`);
    await writeFile(printer.usbPath, Buffer.from(bytes));
  }
}

/** The concrete adapters a {@link RoutingTransport} dispatches to, one per LOCAL transport an agent
 * can drive. `cloud_poll` printers have no agent (they self-poll), so no adapter is registered for
 * them. */
export interface TransportAdapters {
  network_tcp: Transport;
  usb: Transport;
}

/**
 * The transport a production agent injects into the runtime: it routes each job to the adapter for
 * its printer's transport, so one agent can drive a mix of `usb` and `network_tcp` printers. Tests
 * inject a {@link FakeSink} instead (which handles every printer uniformly).
 */
export class RoutingTransport implements Transport {
  constructor(private readonly adapters: TransportAdapters) {}

  send(printer: PrinterTarget, bytes: Uint8Array): Promise<void> {
    switch (printer.transport) {
      case "network_tcp":
        return this.adapters.network_tcp.send(printer, bytes);
      case "usb":
        return this.adapters.usb.send(printer, bytes);
      case "cloud_poll":
        // Unreachable via the runtime — the pull only claims an agent's own printers, and a
        // cloud_poll printer has no agent (it self-polls, design §3e). Guarded anyway so a
        // mis-wired caller fails loudly rather than silently dropping the job.
        return Promise.reject(
          new Error(
            `cloud_poll printer ${printer.id} is self-polling; an agent must not push to it`,
          ),
        );
    }
  }
}

/**
 * A byte-capturing test double (design §3c) — records `{ printerId, bytes }` per push instead of
 * touching hardware. Used by every runtime suite to assert the EXACT payload reaches the printer, and
 * available to Slice B / Task-6 tests for the same reason. Records the bytes verbatim; the runtime
 * hands it a plain `Uint8Array`, so `written[i].bytes` compares byte-for-byte against an `esc().bytes()`.
 */
export class FakeSink implements Transport {
  readonly written: { printerId: string; bytes: Uint8Array }[] = [];

  send(printer: PrinterTarget, bytes: Uint8Array): Promise<void> {
    this.written.push({ printerId: printer.id, bytes });
    return Promise.resolve();
  }
}
