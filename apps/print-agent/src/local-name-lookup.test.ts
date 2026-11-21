import { EventEmitter } from "node:events";
import type { LookupAddress, LookupOptions } from "node:dns";
import type { LookupFunction } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { createLocalNameLookup, type MdnsSocket } from "./local-name-lookup.js";

class FakeSocket extends EventEmitter implements MdnsSocket {
  readonly sent: { msg: Buffer; port: number; address: string }[] = [];
  closed = false;
  bind(callback: () => void): void {
    queueMicrotask(callback);
  }
  send(msg: Buffer, port: number, address: string): void {
    this.sent.push({ msg, port, address });
  }
  close(): void {
    this.closed = true;
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

describe("createLocalNameLookup", () => {
  it("asks the local network for a .local name and answers the first matching reply as a list", async () => {
    const socket = new FakeSocket();
    const lookup = createLocalNameLookup({ openSocket: () => socket });
    const answer = ask(lookup, "box-0793.waitron.local", { all: true });
    await sentQuestion(socket);
    socket.emit("message", reply([{ name: "box-0793.waitron.local", rdata: [192, 168, 1, 20] }]));
    socket.emit("message", reply([{ name: "box-0793.waitron.local", rdata: [192, 168, 1, 99] }]));
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
    socket.emit("message", reply([{ name: "box-1.local", rdata: [10, 0, 0, 7] }]));
    expect(await answer).toEqual({ error: null, address: "10.0.0.7", family: 4 });
  });

  it("matches the name whatever its case and with a trailing dot", async () => {
    const socket = new FakeSocket();
    const lookup = createLocalNameLookup({ openSocket: () => socket });
    const answer = ask(lookup, "Box-1.Waitron.LOCAL.", { all: true });
    await sentQuestion(socket);
    expect(socket.sent[0]!.msg.subarray(12)).toEqual(
      Buffer.from([...encodeName("Box-1.Waitron.LOCAL"), 0, 1, 0, 1]),
    );
    socket.emit("message", reply([{ name: "box-1.waitron.local", rdata: [10, 0, 0, 8] }]));
    expect((await answer).address).toEqual([{ address: "10.0.0.8", family: 4 }]);
  });

  it("ignores replies for other names, other record types and broken packets", async () => {
    const socket = new FakeSocket();
    const lookup = createLocalNameLookup({ openSocket: () => socket });
    const answer = ask(lookup, "box-1.local", { all: true });
    await sentQuestion(socket);
    socket.emit("message", reply([{ name: "printer.local", rdata: [10, 0, 0, 1] }]));
    socket.emit("message", reply([{ name: "box-1.local", type: 16, rdata: [3, 97, 61, 98] }]));
    socket.emit("message", reply([{ name: "box-1.local", rdata: [10, 0, 0] }]));
    socket.emit("message", Buffer.from([0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0, 9, 1]));
    socket.emit("message", Buffer.from([1, 2, 3]));
    expect(socket.closed).toBe(false);
    socket.emit(
      "message",
      reply([
        { name: "printer.local", rdata: [10, 0, 0, 1] },
        { name: "box-1.local", rdata: [10, 0, 0, 2] },
      ]),
    );
    expect((await answer).address).toEqual([{ address: "10.0.0.2", family: 4 }]);
  });

  it("answers ENOTFOUND and closes the socket when no reply comes in time", async () => {
    const socket = new FakeSocket();
    const lookup = createLocalNameLookup({ openSocket: () => socket, timeoutMs: 20 });
    const answer = await ask(lookup, "box-1.local", { all: true });
    expect(answer.error?.code).toBe("ENOTFOUND");
    expect(answer.error?.message).toContain("box-1.local");
    expect(socket.closed).toBe(true);
  });

  it("answers ENOTFOUND when the socket fails", async () => {
    const socket = new FakeSocket();
    const lookup = createLocalNameLookup({ openSocket: () => socket });
    const answer = ask(lookup, "box-1.local", { all: true });
    socket.emit("error", new Error("bind EADDRNOTAVAIL"));
    const settled = await answer;
    expect(settled.error?.code).toBe("ENOTFOUND");
    expect(socket.closed).toBe(true);
  });

  it("answers ENOTFOUND for a .local name asked as IPv6 only, without asking the network", async () => {
    const openSocket = vi.fn(() => new FakeSocket());
    const lookup = createLocalNameLookup({ openSocket });
    const answer = await ask(lookup, "box-1.local", { family: 6 });
    expect(answer.error?.code).toBe("ENOTFOUND");
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
    const lookup = createLocalNameLookup({ timeoutMs: 50 });
    const local = await ask(lookup, "localhost", { all: true });
    expect(local.error).toBeNull();
    expect(Array.isArray(local.address) && local.address.length > 0).toBe(true);
    const missing = await ask(lookup, "no-such-box-a1562.local", { all: true });
    expect(missing.error?.code).toBe("ENOTFOUND");
  });
});
