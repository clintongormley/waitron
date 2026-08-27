import { describe, it, expect, vi } from "vitest";
import { buildMdnsAnswers, startMdnsResponder, MDNS_TTL_SECONDS, type MdnsSocket } from "./mdns.js";

function fakeSocket() {
  let handler: ((q: { questions: { name: string; type: string }[] }) => void) | undefined;
  const respond = vi.fn();
  const destroy = vi.fn((cb?: () => void) => cb?.());
  const socket: MdnsSocket = {
    on: (_e, h) => {
      handler = h;
    },
    respond,
    destroy,
  };
  return {
    socket,
    respond,
    destroy,
    query: (q: { questions: { name: string; type: string }[] }) => handler?.(q),
  };
}

describe("mdns", () => {
  it("builds one A answer per address", () => {
    const answers = buildMdnsAnswers("waitron.local", ["192.168.1.5", "10.0.0.9"]);
    expect(answers).toEqual([
      { name: "waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "192.168.1.5" },
      { name: "waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "10.0.0.9" },
    ]);
  });

  it("answers an A query for its hostname with the current addresses", () => {
    const f = fakeSocket();
    startMdnsResponder({
      hostname: "waitron.local",
      getAddresses: () => ["192.168.1.5"],
      log: () => {},
      makeSocket: () => f.socket,
    });
    f.query({ questions: [{ name: "waitron.local", type: "A" }] });
    expect(f.respond).toHaveBeenCalledWith({
      answers: [{ name: "waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "192.168.1.5" }],
    });
  });

  it("answers an ANY query for its hostname (mDNS ANY asks for every record)", () => {
    const f = fakeSocket();
    startMdnsResponder({
      hostname: "waitron.local",
      getAddresses: () => ["192.168.1.5"],
      log: () => {},
      makeSocket: () => f.socket,
    });
    f.query({ questions: [{ name: "waitron.local", type: "ANY" }] });
    expect(f.respond).toHaveBeenCalledWith({
      answers: [{ name: "waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "192.168.1.5" }],
    });
  });

  it("ignores a query for a different name", () => {
    const f = fakeSocket();
    startMdnsResponder({
      hostname: "waitron.local",
      getAddresses: () => ["192.168.1.5"],
      log: () => {},
      makeSocket: () => f.socket,
    });
    f.query({ questions: [{ name: "other.local", type: "A" }] });
    expect(f.respond).not.toHaveBeenCalled();
  });

  it("does not respond when the box has no addresses", () => {
    const f = fakeSocket();
    startMdnsResponder({
      hostname: "waitron.local",
      getAddresses: () => [],
      log: () => {},
      makeSocket: () => f.socket,
    });
    f.query({ questions: [{ name: "waitron.local", type: "A" }] });
    expect(f.respond).not.toHaveBeenCalled();
  });

  it("stop() destroys the socket once", async () => {
    const f = fakeSocket();
    const r = startMdnsResponder({
      hostname: "waitron.local",
      getAddresses: () => ["192.168.1.5"],
      log: () => {},
      makeSocket: () => f.socket,
    });
    await r.stop();
    await r.stop();
    expect(f.destroy).toHaveBeenCalledTimes(1);
  });
});
