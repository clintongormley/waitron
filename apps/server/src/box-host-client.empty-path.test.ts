import { createConnection } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { boxHostClient } from "./box-host-client.js";

vi.mock("node:net", async (original) => {
  const actual = await original<typeof import("node:net")>();
  return { ...actual, createConnection: vi.fn(actual.createConnection) };
});
const connects = vi.mocked(createConnection);

describe("boxHostClient() given an empty or unusable socket path", () => {
  it("reads an empty path as no path, and asks the box's own socket", async () => {
    connects.mockClear();
    // No machine running this suite has the box's service.
    expect(await boxHostClient({ socketPath: "", statusMs: 200 }).clockStatus()).toMatchObject({
      available: false,
      reason: "missing",
    });
    expect(connects.mock.calls).toEqual([["/run/waitron-box/box.sock"]]);
  });

  it("answers missing, naming the error, for a path the connection refuses at once", async () => {
    // Node reads a path of only spaces as a port number and throws before connecting.
    const client = boxHostClient({ socketPath: " " });
    expect(await client.clockStatus()).toEqual({
      available: false,
      reason: "missing",
      detail: "ERR_SOCKET_BAD_PORT",
    });
    expect(await client.setClock({ targetMs: 0, requester: {} })).toEqual({
      available: false,
      reason: "missing",
      detail: "ERR_SOCKET_BAD_PORT",
    });
  });
});
