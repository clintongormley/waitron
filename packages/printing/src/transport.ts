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

/** The default per-send inactivity deadline (ms) for {@link NetworkTcpTransport}. Covers BOTH the
 * connect phase and the write flush: a receipt printer on a LAN connects and drains a small ESC/POS
 * payload in well under a second, so a few seconds is generous headroom while still bounding a hung
 * send. It exists because WITHOUT a timeout a black-hole host (powered off / SYN dropped) or a printer
 * that accepts the connection but never drains would hang for the OS default TCP timeout (~1-2 min),
 * stalling every later job in the agent's serial push (runtime.ts) — the isolation gap this closes. */
export const DEFAULT_TCP_TIMEOUT_MS = 5000;

/** Options for {@link NetworkTcpTransport} — just the send deadline for now, overridable so a suite
 * (or a slow-link deployment) can tighten or relax it. */
export interface NetworkTcpOptions {
  /** Per-send inactivity deadline in ms (default {@link DEFAULT_TCP_TIMEOUT_MS}). */
  timeoutMs?: number;
}

/** The ESC/POS-over-TCP:9100 adapter (design §3c / the deli-hardware `ReceiptPrinter`). Opens a
 * socket to the printer's `host:port`, writes the bytes, closes. A per-send inactivity timeout
 * (`timeoutMs`) bounds BOTH connect and flush, so a dead or non-draining printer rejects promptly
 * rather than stalling the agent's serial push behind the OS TCP timeout. */
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
    const port = printer.port ?? 9100; // the schema default, applied here too for a target read raw
    return new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      // Inactivity deadline over the whole send: while the socket is CONNECTING (a black-hole host) or
      // flow-controlled mid-flush (a printer that accepts but never drains), no bytes move and libuv
      // fires `'timeout'` after `timeoutMs`. Node does NOT sever the socket on timeout — we destroy it
      // ourselves and reject, so the promise settles instead of hanging for the OS TCP timeout.
      socket.setTimeout(this.timeoutMs);
      // A single settle: an error before OR after connect rejects; a timeout rejects; a clean
      // flush+close resolves.
      socket.once("error", reject);
      socket.once("timeout", () => {
        socket.destroy();
        reject(new Error(`network_tcp printer ${printer.id} timed out after ${this.timeoutMs}ms`));
      });
      socket.once("connect", () => {
        // `end(data, cb)` writes the bytes, half-closes, and calls back once the stream has finished
        // flushing — the point at which the printer has the payload. Clear the inactivity timer then,
        // so the lingering read-side half-close is not destroyed by a late `'timeout'`.
        socket.end(Buffer.from(bytes), () => {
          socket.setTimeout(0);
          resolve();
        });
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
