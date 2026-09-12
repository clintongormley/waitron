import { createServer, Socket } from "node:net";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { connectTcp, probeNetwork } from "./tcp-probe.js";

it("connects to a reachable address without sending bytes, and reports a refused port", async () => {
  let bytes = 0;
  let ended!: () => void;
  const disconnected = new Promise<void>((resolve) => {
    ended = resolve;
  });
  const server = createServer((socket) => {
    socket.on("data", (chunk) => {
      bytes += chunk.length;
    });
    socket.on("end", ended);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No TCP port");
  const target = { host: "127.0.0.1", port: address.port, expiresAt: Date.now() + 30000 };
  try {
    expect(await probeNetwork([target])).toEqual([
      { transport: "network_tcp", host: target.host, port: target.port },
    ]);
    await disconnected;
    expect(bytes).toBe(0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  expect(await connectTcp(target.host, target.port, 100)).toBe(false);
});

it("destroys a silent socket when its deadline expires", async () => {
  const socket = Object.assign(new EventEmitter(), { destroy: vi.fn() });
  const dial = vi.fn(() => socket as unknown as Socket);
  expect(await connectTcp("10.0.0.1", 9100, 10, dial)).toBe(false);
  expect(socket.destroy).toHaveBeenCalledOnce();
});

it("contains a synchronous dial failure", async () => {
  expect(
    await connectTcp("10.0.0.1", 9100, 10, () => {
      throw new Error("socket unavailable");
    }),
  ).toBe(false);
});

describe("probe target boundary", () => {
  it("caps fan-out and excludes non-IP or malformed targets before opening sockets", async () => {
    const connect = vi.fn().mockResolvedValue(true);
    const target = { host: "192.168.20.247", port: 9100, expiresAt: 30000 };
    const invalid = [
      { ...target, host: "http://printer" },
      { ...target, host: "printer.local" },
      { ...target, port: 0 },
      { ...target, port: 65536 },
      { ...target, port: 1.5 },
    ];
    expect(await probeNetwork(invalid, connect)).toEqual([]);
    expect(connect).not.toHaveBeenCalled();
    const result = await probeNetwork(
      Array.from({ length: 12 }, (_, i) => ({ ...target, host: `10.0.0.${i + 1}` })),
      connect,
    );
    expect(result).toHaveLength(8);
    expect(connect).toHaveBeenCalledTimes(8);
    expect(connect).toHaveBeenCalledWith("10.0.0.1", 9100, 500);
  });
  it("keeps reachable targets when another connection rejects or refuses", async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error("unreachable"))
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const result = await probeNetwork(
      [1, 2, 3].map((n) => ({ host: `10.0.0.${n}`, port: 9100, expiresAt: 30000 })),
      connect,
    );
    expect(result).toEqual([{ transport: "network_tcp", host: "10.0.0.3", port: 9100 }]);
  });
});
