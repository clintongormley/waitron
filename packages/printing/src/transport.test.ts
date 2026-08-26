import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeSink, NetworkTcpTransport, RoutingTransport, UsbTransport } from "./transport.js";
import type { PrinterTarget, Transport } from "./transport.js";

// The transport adapters are the hardware seam. CI exercises them against LOCAL fakes — a loopback
// TCP server and a temp file — never a real printer (real hardware is verified manually, design §5).
// The FakeSink is the byte-capturing double the agent-runtime suites push through.

function target(overrides: Partial<PrinterTarget>): PrinterTarget {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    transport: "network_tcp",
    host: null,
    port: null,
    usbPath: null,
    ...overrides,
  };
}

describe("FakeSink", () => {
  it("records each printer id + byte payload in send order", async () => {
    const sink = new FakeSink();
    await sink.send(target({ id: "a" }), new Uint8Array([1, 2]));
    await sink.send(target({ id: "b" }), new Uint8Array([3]));
    expect(sink.written).toEqual([
      { printerId: "a", bytes: new Uint8Array([1, 2]) },
      { printerId: "b", bytes: new Uint8Array([3]) },
    ]);
  });
});

describe("NetworkTcpTransport", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
  });

  /** A loopback TCP server that accumulates every byte it receives. `firstConnectionEnded` resolves
   * with all bytes once the client half-closes (its `end()`), so the assertion never races the
   * server's event loop. */
  async function listeningServer(): Promise<{
    port: number;
    firstConnectionEnded: Promise<Buffer>;
  }> {
    const chunks: Buffer[] = [];
    let resolveEnded!: (b: Buffer) => void;
    const firstConnectionEnded = new Promise<Buffer>((resolve) => (resolveEnded = resolve));
    const server = net.createServer((socket) => {
      socket.on("data", (chunk) => chunks.push(chunk));
      socket.on("end", () => resolveEnded(Buffer.concat(chunks)));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    return { port: address.port, firstConnectionEnded };
  }

  it("writes the exact bytes to the printer's host:port over TCP", async () => {
    const { port, firstConnectionEnded } = await listeningServer();
    await new NetworkTcpTransport().send(
      target({ transport: "network_tcp", host: "127.0.0.1", port }),
      new Uint8Array([0x1b, 0x40, 0x41]),
    );
    expect([...(await firstConnectionEnded)]).toEqual([0x1b, 0x40, 0x41]);
  });

  it("rejects when the printer refuses the connection (a down printer)", async () => {
    // Bind then immediately close, so the port is (almost certainly) unbound → ECONNREFUSED.
    const { port } = await listeningServer();
    for (const c of cleanups.splice(0)) await c(); // close the server, freeing the port
    await expect(
      new NetworkTcpTransport().send(
        target({ transport: "network_tcp", host: "127.0.0.1", port }),
        new Uint8Array([1]),
      ),
    ).rejects.toThrow();
  });

  it("rejects a network_tcp printer with no host rather than dialling nowhere", async () => {
    await expect(
      new NetworkTcpTransport().send(
        target({ transport: "network_tcp", host: null }),
        new Uint8Array([1]),
      ),
    ).rejects.toThrow(/host/);
  });

  it("defaults a null port to 9100, the ESC/POS port", async () => {
    // Assert the DIALLED port without binding 9100 (which may be in use): stub createConnection to
    // capture the options and drive a clean connect+flush through a fake socket.
    let dialledPort: number | undefined;
    const fake = new EventEmitter() as unknown as net.Socket;
    (fake as unknown as { end: (data: unknown, cb: () => void) => void }).end = (_data, cb) => cb();
    const spy = vi.spyOn(net, "createConnection").mockImplementation(((
      opts: net.NetConnectOpts,
    ) => {
      dialledPort = (opts as net.TcpNetConnectOpts).port;
      queueMicrotask(() => fake.emit("connect"));
      return fake;
    }) as unknown as typeof net.createConnection);
    try {
      await new NetworkTcpTransport().send(
        target({ transport: "network_tcp", host: "127.0.0.1", port: null }),
        new Uint8Array([1]),
      );
      expect(dialledPort).toBe(9100);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("UsbTransport", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
  });

  it("writes the exact bytes to the printer's usb_path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "waitron-usb-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const usbPath = join(dir, "lp0");
    await new UsbTransport().send(
      target({ transport: "usb", usbPath }),
      new Uint8Array([0x1d, 0x56, 0x00]),
    );
    expect([...(await readFile(usbPath))]).toEqual([0x1d, 0x56, 0x00]);
  });

  it("rejects a usb printer with no usb_path", async () => {
    await expect(
      new UsbTransport().send(target({ transport: "usb", usbPath: null }), new Uint8Array([1])),
    ).rejects.toThrow(/usb_path/);
  });

  it("rejects when the usb path cannot be written (a missing device directory)", async () => {
    await expect(
      new UsbTransport().send(
        target({ transport: "usb", usbPath: "/no/such/dir/lp0" }),
        new Uint8Array([1]),
      ),
    ).rejects.toThrow();
  });
});

describe("RoutingTransport", () => {
  /** A recording double standing in for a real adapter. */
  class Recorder implements Transport {
    readonly seen: string[] = [];
    send(printer: PrinterTarget): Promise<void> {
      this.seen.push(printer.id);
      return Promise.resolve();
    }
  }

  it("dispatches to the adapter for the printer's transport", async () => {
    const network = new Recorder();
    const usb = new Recorder();
    const router = new RoutingTransport({ network_tcp: network, usb });
    await router.send(target({ id: "n", transport: "network_tcp" }), new Uint8Array([1]));
    await router.send(target({ id: "u", transport: "usb" }), new Uint8Array([2]));
    expect(network.seen).toEqual(["n"]);
    expect(usb.seen).toEqual(["u"]);
  });

  it("throws for a cloud_poll printer — an agent never pushes to a self-polling printer", async () => {
    const router = new RoutingTransport({ network_tcp: new Recorder(), usb: new Recorder() });
    await expect(
      router.send(target({ id: "c", transport: "cloud_poll" }), new Uint8Array([1])),
    ).rejects.toThrow(/cloud_poll/);
  });
});
