import { EventEmitter } from "node:events";
import net from "node:net";
import type { LookupAddress, LookupOptions } from "node:dns";
import type { LookupFunction } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalNameLookup, type MdnsSocket } from "./local-name-lookup.js";

/**
 * A socket on a network whose responders answer only to the mDNS group, as the `multicast-dns`
 * library the box's server answers with does: `fromGroup` reaches the socket only once it is bound
 * to 5353 and has joined 224.0.0.251. A plain `emit("message")` is an answer sent to it directly.
 */
class FakeSocket extends EventEmitter implements MdnsSocket {
  readonly sent: { msg: Buffer; port: number; address: string }[] = [];
  readonly joined: string[] = [];
  boundPort: number | undefined;
  closed = false;
  bind(...args: [number, () => void] | [() => void]): void {
    const [port, callback] = args.length === 2 ? args : [undefined, args[0]];
    this.boundPort = port;
    queueMicrotask(callback);
  }
  addMembership(group: string): void {
    this.joined.push(group);
  }
  send(msg: Buffer, port: number, address: string): void {
    this.sent.push({ msg, port, address });
  }
  close(): void {
    this.closed = true;
  }
  fromGroup(msg: Buffer): void {
    if (this.boundPort === 5353 && this.joined.includes("224.0.0.251")) this.emit("message", msg);
  }
}

function encodeName(name: string): number[] {
  const out: number[] = [];
  for (const label of name.split(".")) {
    out.push(label.length, ...Buffer.from(label, "ascii"));
  }
  out.push(0);
  return out;
}

/** A response echoing one question, then one record per answer: A records carry four bytes. */
function reply(answers: { name: string; type?: number; rdata: number[] }[]): Buffer {
  const bytes: number[] = [0, 0, 0x84, 0, 0, 1, 0, answers.length, 0, 0, 0, 0];
  bytes.push(...encodeName("question.local"), 0, 1, 0, 1);
  for (const a of answers) {
    bytes.push(...encodeName(a.name), 0, a.type ?? 1, 0, 1, 0, 0, 0, 120);
    bytes.push((a.rdata.length >> 8) & 0xff, a.rdata.length & 0xff, ...a.rdata);
  }
  return Buffer.from(bytes);
}

interface Answer {
  error: NodeJS.ErrnoException | null;
  address?: string | LookupAddress[];
  family?: number;
}

function ask(lookup: LookupFunction, hostname: string, options: LookupOptions): Promise<Answer> {
  return new Promise((resolve) => {
    lookup(hostname, options, (error, address, family) => resolve({ error, address, family }));
  });
}

async function sentQuestion(socket: FakeSocket): Promise<void> {
  await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
}

/** A normal lookup that knows no name, as a container's resolver does for a `.local` name. */
function unknownToSystem() {
  return vi.fn<LookupFunction>((hostname, _options, callback) =>
    callback(
      Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }),
      "",
    ),
  );
}

describe("createLocalNameLookup", () => {
  it("asks the local network for a .local name and answers the first matching reply as a list", async () => {
    const socket = new FakeSocket();
    const lookup = createLocalNameLookup({ openSocket: () => socket });
    const answer = ask(lookup, "box-0793.waitron.local", { all: true });
    await sentQuestion(socket);
    socket.fromGroup(reply([{ name: "box-0793.waitron.local", rdata: [192, 168, 1, 20] }]));
    socket.fromGroup(reply([{ name: "box-0793.waitron.local", rdata: [192, 168, 1, 99] }]));
    expect(await answer).toEqual({
      error: null,
      address: [{ address: "192.168.1.20", family: 4 }],
      family: undefined,
    });
    expect(socket.closed).toBe(true);
    const { msg, port, address } = socket.sent[0]!;
    expect({ port, address }).toEqual({ port: 5353, address: "224.0.0.251" });
    expect(msg.readUInt16BE(4)).toBe(1);
    expect(msg.subarray(12)).toEqual(
      Buffer.from([...encodeName("box-0793.waitron.local"), 0, 1, 0, 1]),
    );
  });

  it("answers one address and its family when asked without all", async () => {
    const socket = new FakeSocket();
    const lookup = createLocalNameLookup({ openSocket: () => socket });
    const answer = ask(lookup, "box-1.local", {});
    await sentQuestion(socket);
    socket.fromGroup(reply([{ name: "box-1.local", rdata: [10, 0, 0, 7] }]));
    expect(await answer).toEqual({ error: null, address: "10.0.0.7", family: 4 });
  });

  it("answers every address the reply gives for the name, in its order", async () => {
    const twoAddresses = reply([
      { name: "box-1.local", rdata: [192, 168, 1, 20] },
      { name: "printer.local", rdata: [10, 0, 0, 1] },
      { name: "box-1.local", rdata: [10, 0, 0, 21] },
    ]);
    const listSocket = new FakeSocket();
    const list = ask(createLocalNameLookup({ openSocket: () => listSocket }), "box-1.local", {
      all: true,
    });
    await sentQuestion(listSocket);
    listSocket.fromGroup(twoAddresses);
    expect((await list).address).toEqual([
      { address: "192.168.1.20", family: 4 },
      { address: "10.0.0.21", family: 4 },
    ]);
    const oneSocket = new FakeSocket();
    const one = ask(createLocalNameLookup({ openSocket: () => oneSocket }), "box-1.local", {});
    await sentQuestion(oneSocket);
    oneSocket.fromGroup(twoAddresses);
    expect(await one).toEqual({ error: null, address: "192.168.1.20", family: 4 });
  });

  it("lets a connection reach the box at its second address when the first does not answer", async () => {
    const server = net.createServer((conn) => conn.end());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;
    const socket = new FakeSocket();
    // 192.0.2.1 is a documentation address nothing answers on.
    const sent = socket.send.bind(socket);
    socket.send = (msg, toPort, address) => {
      sent(msg, toPort, address);
      socket.fromGroup(
        reply([
          { name: "box-1.local", rdata: [192, 0, 2, 1] },
          { name: "box-1.local", rdata: [127, 0, 0, 1] },
        ]),
      );
    };
    const lookup = createLocalNameLookup({ openSocket: () => socket });
    try {
      const reached = await new Promise<string | undefined>((resolve, reject) => {
        const conn = net.connect({ host: "box-1.local", port, lookup, autoSelectFamily: true });
        conn.once("connect", () => {
          resolve(conn.remoteAddress);
          conn.destroy();
        });
        conn.once("error", reject);
      });
      expect(reached).toBe("127.0.0.1");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("matches the name whatever its case and with a trailing dot", async () => {
    const socket = new FakeSocket();
    const lookup = createLocalNameLookup({ openSocket: () => socket });
    const answer = ask(lookup, "Box-1.Waitron.LOCAL.", { all: true });
    await sentQuestion(socket);
    expect(socket.sent[0]!.msg.subarray(12)).toEqual(
      Buffer.from([...encodeName("Box-1.Waitron.LOCAL"), 0, 1, 0, 1]),
    );
    socket.fromGroup(reply([{ name: "box-1.waitron.local", rdata: [10, 0, 0, 8] }]));
    expect((await answer).address).toEqual([{ address: "10.0.0.8", family: 4 }]);
  });

  it("ignores replies for other names, other record types and broken packets", async () => {
    const socket = new FakeSocket();
    const lookup = createLocalNameLookup({ openSocket: () => socket });
    const answer = ask(lookup, "box-1.local", { all: true });
    await sentQuestion(socket);
    socket.fromGroup(reply([{ name: "printer.local", rdata: [10, 0, 0, 1] }]));
    socket.fromGroup(reply([{ name: "box-1.local", type: 16, rdata: [3, 97, 61, 98] }]));
    socket.fromGroup(reply([{ name: "box-1.local", rdata: [10, 0, 0] }]));
    socket.fromGroup(Buffer.from([0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0, 9, 1]));
    socket.fromGroup(Buffer.from([1, 2, 3]));
    expect(socket.closed).toBe(false);
    socket.fromGroup(
      reply([
        { name: "printer.local", rdata: [10, 0, 0, 1] },
        { name: "box-1.local", rdata: [10, 0, 0, 2] },
      ]),
    );
    expect((await answer).address).toEqual([{ address: "10.0.0.2", family: 4 }]);
  });

  it("listens on the mDNS port in the group, and also takes an answer sent to it directly", async () => {
    const socket = new FakeSocket();
    const lookup = createLocalNameLookup({ openSocket: () => socket });
    const answer = ask(lookup, "box-1.local", { all: true });
    await sentQuestion(socket);
    expect({ port: socket.boundPort, joined: socket.joined }).toEqual({
      port: 5353,
      joined: ["224.0.0.251"],
    });
    socket.emit("message", reply([{ name: "box-1.local", rdata: [10, 0, 0, 3] }]));
    expect((await answer).address).toEqual([{ address: "10.0.0.3", family: 4 }]);
    expect(socket.closed).toBe(true);
  });

  describe("on a clock", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("asks again at 250 ms and 1 s, then hands the name on at 1.5 s and leaves no timer behind", async () => {
      const socket = new FakeSocket();
      const fallback = unknownToSystem();
      const lookup = createLocalNameLookup({ openSocket: () => socket, fallback });
      let settled: Answer | undefined;
      void ask(lookup, "box-1.local", { all: true }).then((a) => (settled = a));
      await vi.advanceTimersByTimeAsync(0);
      expect(socket.sent).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(249);
      expect(socket.sent).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(socket.sent).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(749);
      expect(socket.sent).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(socket.sent).toHaveLength(3);
      expect(new Set(socket.sent.map((q) => q.msg.toString("hex"))).size).toBe(1);
      await vi.advanceTimersByTimeAsync(499);
      expect(settled).toBeUndefined();
      expect(fallback).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(fallback).toHaveBeenCalledTimes(1);
      expect(settled?.error?.code).toBe("ENOTFOUND");
      expect(socket.sent).toHaveLength(3);
      expect(socket.closed).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("is answered after a lost first question, and stops every timer once answered", async () => {
      const socket = new FakeSocket();
      const lookup = createLocalNameLookup({ openSocket: () => socket });
      const answer = ask(lookup, "box-1.local", { all: true });
      // The first question is lost: nothing answers until the second one goes out.
      await vi.advanceTimersByTimeAsync(250);
      expect(socket.sent).toHaveLength(2);
      socket.fromGroup(reply([{ name: "box-1.local", rdata: [10, 0, 0, 4] }]));
      expect((await answer).address).toEqual([{ address: "10.0.0.4", family: 4 }]);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(socket.sent).toHaveLength(2);
    });
  });

  it("hands the name, with its options, to the normal lookup when no reply comes in time", async () => {
    const socket = new FakeSocket();
    const fallback = vi.fn<LookupFunction>((_host, _options, callback) => {
      expect(socket.closed).toBe(true);
      callback(null, [{ address: "192.0.2.12", family: 4 }]);
    });
    const lookup = createLocalNameLookup({ openSocket: () => socket, fallback, timeoutMs: 20 });
    const answer = await ask(lookup, "configured-box.local", { all: true });
    expect(answer).toEqual({
      error: null,
      address: [{ address: "192.0.2.12", family: 4 }],
      family: undefined,
    });
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledWith(
      "configured-box.local",
      { all: true },
      expect.any(Function),
    );
  });

  it("passes on the normal lookup's refusal when neither knows the name", async () => {
    const socket = new FakeSocket();
    const fallback = unknownToSystem();
    const lookup = createLocalNameLookup({ openSocket: () => socket, fallback, timeoutMs: 20 });
    const answer = await ask(lookup, "box-1.local", { all: true });
    expect(answer.error?.code).toBe("ENOTFOUND");
    expect(answer.error?.message).toContain("box-1.local");
    expect(socket.closed).toBe(true);
  });

  it("hands the name to the normal lookup when the socket fails", async () => {
    const socket = new FakeSocket();
    const fallback = unknownToSystem();
    const lookup = createLocalNameLookup({ openSocket: () => socket, fallback });
    const answer = ask(lookup, "box-1.local", { all: true });
    socket.emit("error", new Error("bind EADDRNOTAVAIL"));
    const settled = await answer;
    expect(settled.error?.code).toBe("ENOTFOUND");
    expect(fallback).toHaveBeenCalledWith("box-1.local", { all: true }, expect.any(Function));
    expect(socket.closed).toBe(true);
  });

  it("hands the name to the normal lookup, without asking, when the group cannot be joined", async () => {
    const socket = new FakeSocket();
    socket.addMembership = () => {
      throw new Error("addMembership ENODEV");
    };
    const fallback = unknownToSystem();
    const lookup = createLocalNameLookup({ openSocket: () => socket, fallback });
    const settled = await ask(lookup, "box-1.local", { all: true });
    expect(settled.error?.code).toBe("ENOTFOUND");
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(socket.sent).toHaveLength(0);
    expect(socket.closed).toBe(true);
  });

  it("hands a .local name asked as IPv6 only to the normal lookup, without asking the network", async () => {
    const openSocket = vi.fn(() => new FakeSocket());
    const fallback = vi.fn<LookupFunction>((_host, _options, callback) =>
      callback(null, "fd00::7", 6),
    );
    const lookup = createLocalNameLookup({ openSocket, fallback });
    const answer = await ask(lookup, "box-1.local", { family: 6 });
    expect(answer).toEqual({ error: null, address: "fd00::7", family: 6 });
    expect(fallback).toHaveBeenCalledWith("box-1.local", { family: 6 }, expect.any(Function));
    expect(openSocket).not.toHaveBeenCalled();
  });

  it("passes any other name, with its options, to the normal lookup", async () => {
    const openSocket = vi.fn(() => new FakeSocket());
    const fallback = vi.fn<LookupFunction>((_host, _options, callback) =>
      callback(null, [{ address: "203.0.113.5", family: 4 }]),
    );
    const lookup = createLocalNameLookup({ openSocket, fallback });
    const answer = await ask(lookup, "box.example.com", { all: true });
    expect(answer.address).toEqual([{ address: "203.0.113.5", family: 4 }]);
    expect(fallback).toHaveBeenCalledWith("box.example.com", { all: true }, expect.any(Function));
    // A name that merely contains ".local" somewhere else is not a multicast name.
    await ask(lookup, "local.example.com", {});
    await ask(lookup, "box.localhost", {});
    expect(fallback).toHaveBeenCalledTimes(3);
    expect(openSocket).not.toHaveBeenCalled();
  });

  it("by default sends other names to the system lookup and .local names to a real socket", async () => {
    const local = await ask(createLocalNameLookup(), "localhost", { all: true });
    expect(local.error).toBeNull();
    expect(Array.isArray(local.address) && local.address.length > 0).toBe(true);
    // A stand-in normal lookup: a Mac's own takes 5 s to refuse an unknown `.local` name.
    const fallback = unknownToSystem();
    const lookup = createLocalNameLookup({ timeoutMs: 50, fallback });
    const missing = await ask(lookup, "no-such-box-a1562.local", { all: true });
    expect(missing.error?.code).toBe("ENOTFOUND");
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
