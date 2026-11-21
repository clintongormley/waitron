import { createSocket } from "node:dgram";
import multicastDns from "multicast-dns";
import { afterEach, describe, it, expect, vi } from "vitest";
import { MDNS_TTL_SECONDS, type MdnsQuerySocket } from "./box-lookup.js";
import {
  buildMdnsAnswers,
  MDNS_GOODBYE_WAIT_MS,
  startMdnsResponder,
  watchVenueNameInSetup,
  type MdnsAnswer,
  type MdnsPeer,
  type MdnsQuestion,
  type MdnsSocket,
} from "./mdns.js";

type FakeQuery = { id?: number; flags?: number; questions: MdnsQuestion[] };
type From = MdnsPeer;
const FROM_GROUP_PORT: From = { address: "192.168.10.60", port: 5353 };

function fakeSocket() {
  let queryHandler: ((q: FakeQuery, from: From) => void) | undefined;
  let errorHandler: ((err: Error) => void) | undefined;
  const respond = vi.fn();
  const destroy = vi.fn((cb?: () => void) => cb?.());
  // The fake routes BY event so a later `on("error", …)` registration cannot clobber the query
  // handler (the real socket has distinct listeners per event); the cast satisfies the overloaded
  // `MdnsSocket["on"]` from a single broad implementation.
  const socket: MdnsSocket = {
    on: ((event: string, h: (...args: never[]) => void): void => {
      if (event === "error") errorHandler = h as (err: Error) => void;
      else queryHandler = h as (q: FakeQuery, from: From) => void;
    }) as MdnsSocket["on"],
    respond,
    destroy,
  };
  return {
    socket,
    respond,
    destroy,
    query: (q: FakeQuery, from: From = FROM_GROUP_PORT) => queryHandler?.(q, from),
    // Mirrors Node's EventEmitter: an `'error'` with no listener THROWS.
    emitError: (err: Error) => {
      if (errorHandler === undefined) throw err;
      errorHandler(err);
    },
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

  it.each([
    { devMode: true, httpHost: "0.0.0.0" },
    { devMode: true, httpHost: "192.168.10.101" },
    { devMode: false, httpHost: "127.0.0.1" },
    { devMode: false, httpHost: "127.255.255.254" },
    { devMode: false, httpHost: "::1" },
    { devMode: false, httpHost: "localhost" },
  ])("does not advertise the box name for $httpHost with devMode=$devMode", async (config) => {
    const f = fakeSocket();
    const makeSocket = vi.fn(() => f.socket);
    const log = vi.fn();
    const responder = startMdnsResponder({
      ...config,
      names: () => ["waitron.local"],
      getAddresses: () => ["192.168.10.101"],
      log,
      makeSocket,
    });
    f.query({ questions: [{ name: "waitron.local", type: "A" }] });
    await responder.stop();
    await responder.stop();
    expect(makeSocket).not.toHaveBeenCalled();
    expect(f.respond).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalledWith("info", "mdns.responding", expect.anything());
  });

  it("answers an A query for its hostname with the current addresses", () => {
    const f = fakeSocket();
    startMdnsResponder({
      names: () => ["waitron.local"],
      devMode: false,
      httpHost: "0.0.0.0",
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
      names: () => ["waitron.local"],
      devMode: false,
      httpHost: "0.0.0.0",
      getAddresses: () => ["192.168.1.5"],
      log: () => {},
      makeSocket: () => f.socket,
    });
    f.query({ questions: [{ name: "waitron.local", type: "ANY" }] });
    expect(f.respond).toHaveBeenCalledWith({
      answers: [{ name: "waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "192.168.1.5" }],
    });
  });

  it.each([
    { asked: "IN", answered: true },
    { asked: "ANY", answered: true },
    { asked: "UNKNOWN_32769", answered: true },
    { asked: "UNKNOWN_33023", answered: true },
    { asked: "CH", answered: false },
    { asked: "HS", answered: false },
  ])("answers its name asked in class $asked: $answered", ({ asked, answered }) => {
    const f = fakeSocket();
    startMdnsResponder({
      names: () => ["waitron.local"],
      devMode: false,
      httpHost: "0.0.0.0",
      getAddresses: () => ["192.168.1.5"],
      log: () => {},
      makeSocket: () => f.socket,
    });
    f.query(
      { id: 7, questions: [{ name: "waitron.local", type: "A", class: asked }] },
      { address: "192.168.10.50", port: 49152 },
    );
    expect(f.respond).toHaveBeenCalledTimes(answered ? 2 : 0);
  });

  it("answers its name asked in any mix of capitals, under its own spelling", () => {
    const f = fakeSocket();
    const at = { addresses: ["192.168.1.5"] };
    const r = startMdnsResponder({
      names: () => ["box-3333.waitron.local", "waitron.local"],
      devMode: false,
      httpHost: "0.0.0.0",
      getAddresses: () => at.addresses,
      log: () => {},
      makeSocket: () => f.socket,
    });
    r.announce("waitron.local");
    at.addresses = ["192.168.1.6"];
    f.respond.mockClear();
    f.query({ questions: [{ name: "Waitron.LOCAL", type: "A", class: "IN" }] });
    expect(f.respond.mock.calls).toEqual([
      [
        {
          answers: [
            { name: "waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "192.168.1.6" },
          ],
        },
      ],
    ]);
    f.respond.mockClear();
    r.withdraw("waitron.local");
    expect(f.respond.mock.calls.map(([response]) => response)).toEqual([
      {
        answers: [
          { name: "waitron.local", type: "A", ttl: 0, data: "192.168.1.5" },
          { name: "waitron.local", type: "A", ttl: 0, data: "192.168.1.6" },
        ],
      },
    ]);
  });

  it("answers each of its names", () => {
    const f = fakeSocket();
    startMdnsResponder({
      names: () => ["box-0a1b.waitron.local", "waitron.local"],
      devMode: false,
      httpHost: "0.0.0.0",
      getAddresses: () => ["192.168.1.5"],
      log: () => {},
      makeSocket: () => f.socket,
    });
    f.query({ questions: [{ name: "box-0a1b.waitron.local", type: "A" }] });
    f.query({ questions: [{ name: "waitron.local", type: "A" }] });
    expect(f.respond.mock.calls).toEqual([
      [
        {
          answers: [
            {
              name: "box-0a1b.waitron.local",
              type: "A",
              ttl: MDNS_TTL_SECONDS,
              data: "192.168.1.5",
            },
          ],
        },
      ],
      [
        {
          answers: [
            { name: "waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "192.168.1.5" },
          ],
        },
      ],
    ]);
  });

  it("answers every one of its names asked in one query", () => {
    const f = fakeSocket();
    startMdnsResponder({
      names: () => ["box-0a1b.waitron.local", "waitron.local"],
      devMode: false,
      httpHost: "0.0.0.0",
      getAddresses: () => ["192.168.1.5"],
      log: () => {},
      makeSocket: () => f.socket,
    });
    f.query({
      questions: [
        { name: "box-0a1b.waitron.local", type: "A" },
        { name: "other.local", type: "A" },
        { name: "waitron.local", type: "ANY" },
      ],
    });
    expect(f.respond.mock.calls).toEqual([
      [
        {
          answers: [
            {
              name: "box-0a1b.waitron.local",
              type: "A",
              ttl: MDNS_TTL_SECONDS,
              data: "192.168.1.5",
            },
            { name: "waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "192.168.1.5" },
          ],
        },
      ],
    ]);
  });

  it("stops answering a name dropped from the list on the next query", () => {
    const f = fakeSocket();
    let names = ["box-0a1b.waitron.local", "waitron.local"];
    startMdnsResponder({
      names: () => names,
      devMode: false,
      httpHost: "0.0.0.0",
      getAddresses: () => ["192.168.1.5"],
      log: () => {},
      makeSocket: () => f.socket,
    });
    f.query({ questions: [{ name: "waitron.local", type: "A" }] });
    expect(f.respond).toHaveBeenCalledTimes(1);
    names = ["box-0a1b.waitron.local"];
    f.query({ questions: [{ name: "waitron.local", type: "A" }] });
    expect(f.respond).toHaveBeenCalledTimes(1);
    f.query({ questions: [{ name: "box-0a1b.waitron.local", type: "A" }] });
    expect(f.respond).toHaveBeenCalledTimes(2);
  });

  it("a box that is not selling answers its own name and not the venue's", () => {
    const f = fakeSocket();
    const logged: Array<{ event: string; fields?: Record<string, unknown> }> = [];
    startMdnsResponder({
      names: () => ["box-0a1b.waitron.local"],
      devMode: false,
      httpHost: "0.0.0.0",
      getAddresses: () => ["192.168.1.5"],
      log: (_level, event, fields) => logged.push({ event, fields }),
      makeSocket: () => f.socket,
    });
    f.query({ questions: [{ name: "waitron.local", type: "A" }] });
    expect(f.respond).not.toHaveBeenCalled();
    f.query({ questions: [{ name: "box-0a1b.waitron.local", type: "ANY" }] });
    expect(f.respond).toHaveBeenCalledWith({
      answers: [
        { name: "box-0a1b.waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "192.168.1.5" },
      ],
    });
    expect(logged).toContainEqual({
      event: "mdns.responding",
      fields: { hostnames: ["box-0a1b.waitron.local"] },
    });
  });

  describe("a one-shot query, asked from the phone's own port", () => {
    const start = (f: ReturnType<typeof fakeSocket>) =>
      startMdnsResponder({
        names: () => ["waitron.local"],
        devMode: false,
        httpHost: "0.0.0.0",
        getAddresses: () => ["192.168.1.5"],
        log: () => {},
        makeSocket: () => f.socket,
      });

    it("is answered to the asking address and port, with its id, question and recursion-desired bit, and a 10-second lifetime", () => {
      const f = fakeSocket();
      start(f);
      f.query(
        {
          id: 4242,
          // Recursion desired, and checking disabled, which a reply does not repeat.
          flags: 0x0110,
          questions: [{ name: "waitron.local", type: "A", class: "IN" }],
        },
        { address: "192.168.10.50", port: 49152 },
      );
      expect(f.respond.mock.calls).toEqual([
        [
          {
            answers: [
              { name: "waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "192.168.1.5" },
            ],
          },
        ],
        [
          {
            id: 4242,
            flags: 0x0100,
            questions: [{ name: "waitron.local", type: "A", class: "IN" }],
            answers: [{ name: "waitron.local", type: "A", ttl: 10, data: "192.168.1.5" }],
          },
          { address: "192.168.10.50", port: 49152 },
        ],
      ]);
    });

    it("repeats every question asked, as asked, and answers with the box's own spelling", () => {
      const f = fakeSocket();
      start(f);
      const questions = [
        { name: "Waitron.LOCAL", type: "A", class: "IN" },
        { name: "waitron.local", type: "A", class: "CH" },
        { name: "other.local", type: "A", class: "IN" },
      ];
      f.query({ id: 7, flags: 0, questions }, { address: "192.168.10.50", port: 49152 });
      const answers = [{ name: "waitron.local", type: "A", ttl: 10, data: "192.168.1.5" }];
      expect(f.respond.mock.calls[1]).toEqual([
        { id: 7, flags: 0, questions, answers },
        { address: "192.168.10.50", port: 49152 },
      ]);
    });

    it("is not sent to a query from port 0, which has no port to answer at", () => {
      const f = fakeSocket();
      start(f);
      f.query(
        { id: 4242, questions: [{ name: "waitron.local", type: "A" }] },
        { address: "192.168.10.50", port: 0 },
      );
      expect(f.respond.mock.calls).toEqual([
        [
          {
            answers: [
              { name: "waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "192.168.1.5" },
            ],
          },
        ],
      ]);
    });

    it("repeats a question asking for a direct answer with its plain class", () => {
      const f = fakeSocket();
      start(f);
      f.query(
        { id: 7, questions: [{ name: "waitron.local", type: "A", class: "UNKNOWN_32769" }] },
        { address: "192.168.10.50", port: 49152 },
      );
      expect(f.respond.mock.calls[1]?.[0]).toMatchObject({
        questions: [{ name: "waitron.local", type: "A", class: "IN" }],
      });
    });

    it("is not sent for a query asked from the mDNS port, which hears the group's answer", () => {
      const f = fakeSocket();
      start(f);
      f.query({ id: 0, questions: [{ name: "waitron.local", type: "A" }] }, FROM_GROUP_PORT);
      f.query(
        { id: 0, questions: [{ name: "waitron.local", type: "A", class: "UNKNOWN_32769" }] },
        FROM_GROUP_PORT,
      );
      const group = [
        {
          answers: [
            { name: "waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "192.168.1.5" },
          ],
        },
      ];
      expect(f.respond.mock.calls).toEqual([group, group]);
    });

    it("reaches the asker through the real multicast-dns socket", async () => {
      const responderSocket = createSocket("udp4");
      await new Promise<void>((resolve) => responderSocket.bind(0, "127.0.0.1", resolve));
      const { port } = responderSocket.address();
      // Bound on loopback and pointed at itself, so the group reply stays on this machine.
      const responder = startMdnsResponder({
        names: () => ["waitron.local"],
        devMode: false,
        httpHost: "0.0.0.0",
        getAddresses: () => ["192.168.1.5"],
        log: () => {},
        makeSocket: () =>
          multicastDns({
            socket: responderSocket,
            port,
            ip: "127.0.0.1",
            bind: false,
            multicast: false,
          }) as MdnsSocket,
      });
      try {
        const askerSocket = createSocket("udp4");
        const asker = multicastDns({
          socket: askerSocket,
          port: 0,
          ip: "127.0.0.1",
          bind: false,
          multicast: false,
        });
        try {
          await new Promise<void>((resolve) => askerSocket.bind(0, "127.0.0.1", resolve));
          type Reply = { id?: number; flags?: number; questions?: unknown; answers?: unknown };
          const ask = (send: () => void) => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const reply = new Promise<Reply>((resolve, reject) => {
              asker.once("response", (packet) => resolve(packet));
              timer = setTimeout(() => reject(new Error("no reply within 2 seconds")), 2_000);
            }).finally(() => clearTimeout(timer));
            send();
            return reply.then(({ id, flags, questions, answers }) => ({
              id,
              flags,
              questions,
              answers,
            }));
          };
          const answers = [
            {
              name: "waitron.local",
              type: "A",
              class: "IN",
              flush: false,
              ttl: 10,
              data: "192.168.1.5",
            },
          ];

          const recursionDesired = await ask(() =>
            asker.query(
              { id: 4242, flags: 0x0100, questions: [{ name: "Waitron.LOCAL", type: "A" }] },
              { address: "127.0.0.1", port },
            ),
          );
          expect(recursionDesired).toEqual({
            id: 4242,
            flags: 0x0500,
            questions: [{ name: "Waitron.LOCAL", type: "A", class: "IN" }],
            answers,
          });

          // multicast-dns cannot send a question's unicast-response bit, so this one is built by hand.
          const unicastResponse = Buffer.concat([
            Buffer.from([0x00, 0x07, 0x00, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
            Buffer.from("\x07waitron\x05local\x00", "latin1"),
            Buffer.from([0x00, 0x01, 0x80, 0x01]),
          ]);
          const direct = await ask(() => askerSocket.send(unicastResponse, port, "127.0.0.1"));
          expect(direct).toEqual({
            id: 7,
            flags: 0x0400,
            questions: [{ name: "waitron.local", type: "A", class: "IN" }],
            answers,
          });
        } finally {
          await new Promise<void>((resolve) => asker.destroy(() => resolve()));
        }
      } finally {
        await responder.stop();
      }
    });

    it("gets no reply at all for a name the box does not answer", () => {
      const f = fakeSocket();
      start(f);
      f.query(
        { id: 4242, questions: [{ name: "other.local", type: "A" }] },
        { address: "192.168.10.50", port: 49152 },
      );
      expect(f.respond).not.toHaveBeenCalled();
    });
  });

  it("ignores a query for a different name", () => {
    const f = fakeSocket();
    startMdnsResponder({
      names: () => ["waitron.local"],
      devMode: false,
      httpHost: "0.0.0.0",
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
      names: () => ["waitron.local"],
      devMode: false,
      httpHost: "0.0.0.0",
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
      names: () => ["waitron.local"],
      devMode: false,
      httpHost: "0.0.0.0",
      getAddresses: () => ["192.168.1.5"],
      log: () => {},
      makeSocket: () => f.socket,
    });
    await r.stop();
    await r.stop();
    expect(f.destroy).toHaveBeenCalledTimes(1);
  });

  it("logs a socket error without throwing", () => {
    // A bind/membership failure arrives as an ASYNC `'error'` event, which with no listener kills the
    // box. The box stays reachable by IP without mDNS, so it must be swallowed, not fatal.
    const f = fakeSocket();
    const logged: Array<{ level: string; event: string; fields?: Record<string, unknown> }> = [];
    startMdnsResponder({
      names: () => ["waitron.local"],
      devMode: false,
      httpHost: "0.0.0.0",
      getAddresses: () => ["192.168.1.5"],
      log: (level, event, fields) => logged.push({ level, event, fields }),
      makeSocket: () => f.socket,
    });
    expect(() => f.emitError(new Error("bind EADDRINUSE 0.0.0.0:5353"))).not.toThrow();
    expect(logged).toContainEqual({
      level: "warn",
      event: "mdns.socket_error",
      fields: { message: "bind EADDRINUSE 0.0.0.0:5353" },
    });
  });

  it("announce sends the name's answers with their lifetime; withdraw sends them with a lifetime of 0", () => {
    const f = fakeSocket();
    const r = startMdnsResponder({
      names: () => ["box-3333.waitron.local"],
      devMode: false,
      httpHost: "0.0.0.0",
      getAddresses: () => ["192.168.1.5", "10.0.0.9"],
      log: () => {},
      makeSocket: () => f.socket,
    });
    r.announce("waitron.local");
    r.withdraw("waitron.local");
    expect(f.respond.mock.calls.map(([response]) => response)).toEqual([
      {
        answers: [
          { name: "waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "192.168.1.5" },
          { name: "waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "10.0.0.9" },
        ],
      },
      {
        answers: [
          { name: "waitron.local", type: "A", ttl: 0, data: "192.168.1.5" },
          { name: "waitron.local", type: "A", ttl: 0, data: "10.0.0.9" },
        ],
      },
    ]);
  });

  it("announce sends nothing without an address, nor once stopped", async () => {
    const f = fakeSocket();
    let addresses: string[] = [];
    const r = startMdnsResponder({
      names: () => ["waitron.local"],
      devMode: false,
      httpHost: "0.0.0.0",
      getAddresses: () => addresses,
      log: () => {},
      makeSocket: () => f.socket,
    });
    r.announce("waitron.local");
    addresses = ["192.168.1.5"];
    await r.stop();
    r.announce("waitron.local");
    r.withdraw("waitron.local");
    expect(f.respond).not.toHaveBeenCalled();
  });

  it("announce and withdraw send nothing in development mode", () => {
    const f = fakeSocket();
    const makeSocket = vi.fn(() => f.socket);
    const r = startMdnsResponder({
      names: () => ["waitron.local"],
      devMode: true,
      httpHost: "0.0.0.0",
      getAddresses: () => ["192.168.1.5"],
      log: () => {},
      makeSocket,
    });
    r.announce("waitron.local");
    r.withdraw("waitron.local");
    expect(makeSocket).not.toHaveBeenCalled();
    expect(f.respond).not.toHaveBeenCalled();
  });

  /** A responder for the box's own name, whose addresses the test moves through `at.addresses`. */
  function venueResponder(f: ReturnType<typeof fakeSocket>, at: { addresses: string[] }) {
    return startMdnsResponder({
      names: () => ["box-3333.waitron.local", "waitron.local"],
      devMode: false,
      httpHost: "0.0.0.0",
      getAddresses: () => at.addresses,
      log: () => {},
      makeSocket: () => f.socket,
    });
  }
  const sent = (f: ReturnType<typeof fakeSocket>) =>
    f.respond.mock.calls.flatMap(([r]) =>
      (r as { answers: MdnsAnswer[] }).answers.map((a) => `${a.data}/${a.ttl}`),
    );

  it("withdraw says goodbye at every address the name was given at, not at the current ones", () => {
    const f = fakeSocket();
    const at = { addresses: ["192.168.1.5"] };
    const r = venueResponder(f, at);
    r.announce("waitron.local");
    at.addresses = ["192.168.1.6"];
    f.query({ questions: [{ name: "waitron.local", type: "A" }] });
    at.addresses = ["192.168.1.7"];
    f.respond.mockClear();
    r.withdraw("waitron.local");
    expect(sent(f)).toEqual(["192.168.1.5/0", "192.168.1.6/0"]);
    f.respond.mockClear();
    r.withdraw("waitron.local");
    expect(f.respond).not.toHaveBeenCalled();
  });

  it("stop says goodbye for an announced name and closes only once the goodbye is sent", async () => {
    const f = fakeSocket();
    const r = venueResponder(f, { addresses: ["192.168.1.5"] });
    r.announce("waitron.local");
    f.query({ questions: [{ name: "box-3333.waitron.local", type: "A" }] });
    f.respond.mockClear();
    let stopped = false;
    const stopping = r.stop().then(() => {
      stopped = true;
    });
    f.query({ questions: [{ name: "waitron.local", type: "A" }] });
    expect(sent(f)).toEqual(["192.168.1.5/0"]);
    await Promise.resolve();
    expect([stopped, f.destroy.mock.calls.length]).toEqual([false, 0]);
    (f.respond.mock.calls[0]![1] as () => void)();
    await stopping;
    expect(f.destroy).toHaveBeenCalledTimes(1);
  });

  it("stop waits for a goodbye withdraw has started before closing the socket", async () => {
    const f = fakeSocket();
    const r = venueResponder(f, { addresses: ["192.168.1.5"] });
    r.announce("waitron.local");
    f.respond.mockClear();
    r.withdraw("waitron.local");
    const stopping = r.stop();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.destroy).not.toHaveBeenCalled();
    (f.respond.mock.calls[0]![1] as () => void)();
    await stopping;
    expect(sent(f)).toEqual(["192.168.1.5/0"]);
    expect(f.destroy).toHaveBeenCalledTimes(1);
  });

  it("stop says nothing for the box's own name or a name already withdrawn", async () => {
    const f = fakeSocket();
    const r = venueResponder(f, { addresses: ["192.168.1.5"] });
    r.announce("waitron.local");
    r.withdraw("waitron.local");
    f.query({ questions: [{ name: "box-3333.waitron.local", type: "A" }] });
    f.respond.mockClear();
    await r.stop();
    expect(f.respond).not.toHaveBeenCalled();
    expect(f.destroy).toHaveBeenCalledTimes(1);
  });

  it("stop closes the socket after a bounded wait when the goodbye's send never finishes", async () => {
    vi.useFakeTimers();
    try {
      const f = fakeSocket();
      const r = venueResponder(f, { addresses: ["192.168.1.5"] });
      r.announce("waitron.local");
      const stopping = r.stop();
      await vi.advanceTimersByTimeAsync(MDNS_GOODBYE_WAIT_MS - 1);
      expect(f.destroy).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await stopping;
      expect(f.destroy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

const OWN = "192.168.10.5";
const OTHER = "192.168.10.9";

/** Each ask opens a socket; whoever is in `answering` answers it, and `fail` makes it error instead. */
function fakeNetwork() {
  const net = {
    answering: [OWN],
    fail: undefined as Error | undefined,
    asks: [] as number[],
    destroys: 0,
  };
  const makeSocket = (): MdnsQuerySocket => {
    const handlers: {
      response?: (r: { answers: { name: string; type: string; data: unknown }[] }) => void;
      error?: (e: Error) => void;
    } = {};
    return {
      on(event: "response" | "error", handler: never) {
        handlers[event] = handler;
      },
      query() {
        net.asks.push(Date.now());
        if (net.fail !== undefined) {
          handlers.error?.(net.fail);
          handlers.error?.(net.fail);
          return;
        }
        const answers = net.answering.map((data) => ({ name: "waitron.local", type: "A", data }));
        handlers.response?.({ answers });
      },
      destroy(cb) {
        net.destroys += 1;
        cb?.();
      },
    };
  };
  return { net, makeSocket };
}

describe("a box in setup mode and the venue's name", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function watch(random: () => number, answering = [OWN], fail?: Error) {
    const { net, makeSocket } = fakeNetwork();
    net.answering = answering;
    net.fail = fail;
    const w = watchVenueNameInSetup({
      hostname: "waitron.local",
      devMode: false,
      httpHost: "0.0.0.0",
      ownAddresses: () => [OWN],
      random,
      makeSocket,
    });
    return { net, w };
  }

  it("a box in setup mode stops answering the venue's name once another box answers it", async () => {
    vi.useFakeTimers({ now: 0 });
    const { net, w } = watch(() => 0.5);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(net.asks).toEqual([0]);
    expect(w.names()).toEqual(["waitron.local"]);

    net.answering = [OWN, OTHER];
    expect(w.names()).toEqual(["waitron.local"]);
    await vi.advanceTimersByTimeAsync(35_000 + 2_000);
    expect(net.asks).toEqual([0, 37_000]);
    expect(w.names()).toEqual([]);

    net.answering = [OWN];
    await vi.advanceTimersByTimeAsync(35_000 + 2_000);
    expect(net.asks).toEqual([0, 37_000, 74_000]);
    expect(w.names()).toEqual(["waitron.local"]);
    await w.stop();
  });

  it("a box in setup mode answers nothing while its first ask is in flight, nor after it hears another box", async () => {
    vi.useFakeTimers({ now: 0 });
    const { net, w } = watch(() => 0, [OWN, OTHER]);
    expect(w.names()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(net.asks).toEqual([0]);
    expect(w.names()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(w.names()).toEqual([]);
    await w.stop();
  });

  it("a box in setup mode begins answering only when its first ask ends having heard nobody", async () => {
    vi.useFakeTimers({ now: 0 });
    const { w } = watch(() => 0);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(w.names()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(w.names()).toEqual(["waitron.local"]);
    await w.stop();
  });

  it("a box in setup mode that is answering stops at the end of the next ask that hears another box, and no later", async () => {
    vi.useFakeTimers({ now: 0 });
    const { net, w } = watch(() => 0.999_9);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(w.names()).toEqual(["waitron.local"]);
    net.answering = [OWN, OTHER];
    // The longest wait: 30 s plus a draw just under the 10 s of jitter, then the 2 s ask.
    await vi.advanceTimersByTimeAsync(30_000 + 9_999);
    expect(net.asks).toEqual([0, 41_999]);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(w.names()).toEqual(["waitron.local"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(w.names()).toEqual([]);
    await w.stop();
  });

  it("asks again after 30 seconds plus the random delay, drawn afresh each time", async () => {
    vi.useFakeTimers({ now: 0 });
    const draws = [0.7, 0.2];
    const { net, w } = watch(() => draws.shift()!);
    await vi.advanceTimersByTimeAsync(2_000 + 30_000 + 6_999);
    expect(net.asks).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    expect(net.asks).toEqual([0, 39_000]);
    await vi.advanceTimersByTimeAsync(2_000 + 32_000);
    expect(net.asks).toEqual([0, 39_000, 73_000]);
    await vi.advanceTimersByTimeAsync(2_000);
    await w.stop();
  });

  it("asks no more once stopped, and stops only after closing an ask in flight", async () => {
    vi.useFakeTimers({ now: 0 });
    const random = vi.fn(() => 0);
    const { net, w } = watch(random);
    const destroysWhenStopped = w.stop().then(() => net.destroys);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await destroysWhenStopped).toBe(1);
    expect(net.asks).toEqual([0]);
    expect(random).not.toHaveBeenCalled();
  });

  it("a failed ask leaves the box answering nothing until an ask at the usual interval hears nobody", async () => {
    vi.useFakeTimers({ now: 0 });
    const { net, w } = watch(() => 0, [OWN, OTHER]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(w.names()).toEqual([]);
    net.fail = new Error("bind EADDRINUSE 0.0.0.0:5353");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(net.asks).toEqual([0, 32_000]);
    expect(w.names()).toEqual([]);
    net.fail = undefined;
    net.answering = [OWN];
    await vi.advanceTimersByTimeAsync(30_000 + 1_999);
    expect(net.asks).toEqual([0, 32_000, 62_000]);
    expect(w.names()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(w.names()).toEqual(["waitron.local"]);
    await w.stop();
  });

  it("a box that is answering stops when an ask fails, and a failed first ask answers nothing", async () => {
    vi.useFakeTimers({ now: 0 });
    const { net, w } = watch(() => 0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(w.names()).toEqual(["waitron.local"]);
    net.fail = new Error("bind EADDRINUSE 0.0.0.0:5353");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(net.asks).toEqual([0, 32_000]);
    expect(w.names()).toEqual([]);
    await w.stop();

    const first = watch(() => 0, [OWN], new Error("bind EADDRINUSE 0.0.0.0:5353"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(first.net.asks).toEqual([32_000, 62_000]);
    expect(first.w.names()).toEqual([]);
    await first.w.stop();
  });

  it("tells apart another box answering, nobody answering, no answer yet and a failed ask", async () => {
    vi.useFakeTimers({ now: 0 });
    const { net, w } = watch(() => 0, [OWN, OTHER]);
    expect(w.state()).toBe("not-asked");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(w.state()).toBe("other-box-answers");
    expect(w.names()).toEqual([]);
    net.answering = [OWN];
    await vi.advanceTimersByTimeAsync(32_000);
    expect(w.state()).toBe("no-other-box");
    net.fail = new Error("bind EADDRINUSE 0.0.0.0:5353");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(w.state()).toBe("ask-failed");
    expect(w.names()).toEqual([]);
    net.fail = undefined;
    net.answering = [OWN, OTHER];
    await vi.advanceTimersByTimeAsync(32_000);
    expect(w.state()).toBe("other-box-answers");
    await w.stop();
  });

  it("keeps the other box answering through a failed ask, until an ask hears nobody", async () => {
    vi.useFakeTimers({ now: 0 });
    const { net, w } = watch(() => 0, [OWN, OTHER]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(w.state()).toBe("other-box-answers");
    net.fail = new Error("bind EADDRINUSE 0.0.0.0:5353");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(w.state()).toBe("other-box-answers");
    expect(w.names()).toEqual([]);
    net.fail = undefined;
    net.answering = [OWN];
    await vi.advanceTimersByTimeAsync(32_000);
    expect(w.state()).toBe("no-other-box");
    expect(w.names()).toEqual(["waitron.local"]);
    await w.stop();
  });

  it("stays not asked where the responder is off", async () => {
    const w = watchVenueNameInSetup({
      hostname: "waitron.local",
      devMode: true,
      httpHost: "0.0.0.0",
      random: () => 0,
      makeSocket: vi.fn(),
    });
    expect(w.state()).toBe("not-asked");
    await w.stop();
  });

  it.each([
    { devMode: true, httpHost: "0.0.0.0" },
    { devMode: false, httpHost: "127.0.0.1" },
  ])("asks nothing where the responder is off ($httpHost, devMode=$devMode)", async (config) => {
    const makeSocket = vi.fn();
    const w = watchVenueNameInSetup({
      hostname: "waitron.local",
      ...config,
      random: () => 0,
      makeSocket,
    });
    expect(makeSocket).not.toHaveBeenCalled();
    await w.stop();
  });
});
