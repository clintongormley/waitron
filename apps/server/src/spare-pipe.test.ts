import { mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  createServer as createHttpServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type Server,
} from "node:http";
import { request } from "node:https";
import { connect } from "node:tls";
import { connect as connectTcp, createServer as createTcpServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  issueClientCert,
  mintSelfSignedServerCert,
  reissueServerLeaf,
  type SelfSignedMaterial,
} from "./self-signed-cert.js";
import {
  startStoreListener,
  startStorePipe,
  type StoreListenerDeps,
  type StorePipeDeps,
} from "./spare-pipe.js";

vi.mock("node:tls", async (original) => {
  const actual = await original<typeof import("node:tls")>();
  return { ...actual, createServer: vi.fn(actual.createServer) };
});
const { createServer: createTlsServer } = await import("node:tls");

const MAIN_NAME = "box-7f3a.waitron.local";
const SPARE_NAME = "box-5c21.waitron.local";
const STORE_HOST = `${SPARE_NAME}:7443`;

let venue: SelfSignedMaterial;
let other: SelfSignedMaterial;
let dir: string;
let upstream: Server;
let upstreamPort: number;
const seen: IncomingHttpHeaders[] = [];
const logged: Array<{ level: string; event: string; fields?: Record<string, unknown> }> = [];
let listener: { port: number; close(): Promise<void> } | undefined;

beforeAll(async () => {
  const now = new Date();
  venue = mintSelfSignedServerCert({ hostnames: ["waitron.local"], ipAddresses: [], now });
  other = mintSelfSignedServerCert({ hostnames: ["waitron.local"], ipAddresses: [], now });
  const spareLeaf = reissueServerLeaf({
    caCertPem: venue.caCertPem,
    caKeyPem: venue.caKeyPem,
    hostnames: [SPARE_NAME],
    ipAddresses: ["127.0.0.1"],
    now,
  });
  dir = await mkdtemp(join(tmpdir(), "waitron-spare-pipe-"));
  await writeFile(join(dir, "server.pem"), spareLeaf.serverCertPem + spareLeaf.serverKeyPem);
  await writeFile(join(dir, "ca.crt"), venue.caCertPem);
  const strangerLeaf = reissueServerLeaf({
    caCertPem: other.caCertPem,
    caKeyPem: other.caKeyPem,
    hostnames: [SPARE_NAME],
    ipAddresses: ["127.0.0.1"],
    now,
  });
  await writeFile(join(dir, "other.pem"), strangerLeaf.serverCertPem + strangerLeaf.serverKeyPem);
  const mainClient = clientFor(venue, MAIN_NAME);
  await writeFile(join(dir, "client.crt"), mainClient.cert);
  await writeFile(join(dir, "client.key"), mainClient.key);
  upstream = createHttpServer((req, res) => {
    seen.push(req.headers);
    res.end("stored");
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  upstreamPort = (upstream.address() as AddressInfo).port;
});

afterEach(async () => {
  await listener?.close();
  listener = undefined;
  seen.length = 0;
  logged.length = 0;
});

afterAll(async () => {
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});

async function listen(overrides: Partial<StoreListenerDeps> = {}): Promise<number> {
  listener = await startStoreListener({
    port: 0,
    host: "127.0.0.1",
    certFile: join(dir, "server.pem"),
    keyFile: join(dir, "server.pem"),
    caFile: join(dir, "ca.crt"),
    peerHostname: MAIN_NAME,
    upstreamPort,
    log: (level, event, fields) => logged.push({ level, event, ...(fields ? { fields } : {}) }),
    ...overrides,
  });
  return listener.port;
}

const refusals = () => logged.filter((line) => line.event === "spare.store_client_refused");

function clientFor(authority: SelfSignedMaterial, name: string) {
  const { clientCertPem, clientKeyPem } = issueClientCert({
    caCertPem: authority.caCertPem,
    caKeyPem: authority.caKeyPem,
    hostname: name,
    now: new Date(),
  });
  return { cert: clientCertPem, key: clientKeyPem };
}

/** A GET through the listener, as the main box sends it: "200 stored", or the error's code. */
function get(port: number, identity: { cert?: string; key?: string }): Promise<string> {
  return new Promise((resolve) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        servername: SPARE_NAME,
        ca: venue.caCertPem,
        path: "/waitron/db",
        headers: { host: STORE_HOST },
        agent: false,
        ...identity,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString()));
        res.on("end", () => resolve(`${res.statusCode} ${body}`));
      },
    );
    req.on("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message));
    req.end();
  });
}

async function expectRefused(identity: { cert?: string; key?: string }, reason: string) {
  const port = await listen();
  expect(await get(port, identity)).not.toBe("200 stored");
  await vi.waitFor(() =>
    expect(logged).toContainEqual({
      level: "warn",
      event: "spare.store_client_refused",
      fields: { reason, refused: 1 },
    }),
  );
  expect(seen).toEqual([]);
}

describe("startStoreListener", () => {
  it("carries a request from the paired main box's client certificate, Host header unchanged", async () => {
    const port = await listen();

    expect(await get(port, clientFor(venue, MAIN_NAME))).toBe("200 stored");

    expect(seen.map((headers) => headers.host)).toEqual([STORE_HOST]);
    expect(logged).toEqual([
      {
        level: "info",
        event: "server.listening",
        fields: { listener: "spare_store", port },
      },
    ]);
  });

  it("a client with no certificate is refused and logged", async () => {
    await expectRefused({}, "no_certificate");
  });

  it("a client certificate another authority signed is refused", async () => {
    await expectRefused(clientFor(other, MAIN_NAME), "CERT_SIGNATURE_FAILURE");
  });

  it("the box's server leaf presented as a client certificate is refused", async () => {
    const mainLeaf = reissueServerLeaf({
      caCertPem: venue.caCertPem,
      caKeyPem: venue.caKeyPem,
      hostnames: [MAIN_NAME],
      ipAddresses: [],
      now: new Date(),
    });
    await expectRefused(
      { cert: mainLeaf.serverCertPem, key: mainLeaf.serverKeyPem },
      "INVALID_PURPOSE",
    );
  });

  it("a venue certificate for another box's name is refused", async () => {
    await expectRefused(clientFor(venue, "box-9e0d.waitron.local"), "name_mismatch");
  });

  it("close ends a connection the main box holds open", async () => {
    const port = await listen();
    const socket = connect({
      host: "127.0.0.1",
      port,
      servername: SPARE_NAME,
      ca: venue.caCertPem,
      ...clientFor(venue, MAIN_NAME),
    });
    const ended = new Promise<void>((resolve) => socket.on("close", () => resolve()));
    socket.on("error", () => {});
    await new Promise<void>((resolve) => socket.once("secureConnect", () => resolve()));

    await listener!.close();
    listener = undefined;

    await ended;
  });

  it("close stops it accepting connections", async () => {
    const port = await listen();
    await listener!.close();
    listener = undefined;

    expect(await get(port, clientFor(venue, MAIN_NAME))).toBe("ECONNREFUSED");
  });
  it("a port already taken rejects as the listener's bind failure", async () => {
    const port = await listen();
    const first = listener;
    listener = undefined;
    try {
      await expect(listen({ port })).rejects.toMatchObject({
        code: "server.listen_failed",
        params: { listener: "spare_store", port, code: "EADDRINUSE" },
      });
    } finally {
      await first!.close();
    }
  });

  it("an error after it is listening is logged, not thrown, and it keeps serving", async () => {
    const port = await listen();
    const server = vi.mocked(createTlsServer).mock.results.at(-1)!
      .value as import("node:tls").Server;

    server.emit("error", Object.assign(new Error("accept failed"), { code: "EMFILE" }));

    expect(logged).toContainEqual({
      level: "warn",
      event: "server.listen_failed",
      fields: { listener: "spare_store", port, code: "EMFILE" },
    });
    expect(await get(port, clientFor(venue, MAIN_NAME))).toBe("200 stored");
  });

  it("logs refusals at most once a minute for each reason, with how many there were since", async () => {
    let at = 1_000_000;
    const port = await listen({ now: () => at });
    const stranger = clientFor(venue, "box-9e0d.waitron.local");

    for (let i = 0; i < 3; i++) expect(await get(port, stranger)).not.toBe("200 stored");
    expect(await get(port, {})).not.toBe("200 stored");
    await vi.waitFor(() => expect(refusals()).toHaveLength(2));
    expect(refusals().map((line) => line.fields)).toEqual([
      { reason: "name_mismatch", refused: 1 },
      { reason: "no_certificate", refused: 1 },
    ]);

    at += 59_999;
    expect(await get(port, stranger)).not.toBe("200 stored");
    at += 1;
    expect(await get(port, stranger)).not.toBe("200 stored");

    await vi.waitFor(() => expect(refusals()).toHaveLength(3));
    expect(refusals()[2]!.fields).toEqual({ reason: "name_mismatch", refused: 4 });
    expect(seen).toEqual([]);
  });
});

describe("startStorePipe", () => {
  let pipe: Awaited<ReturnType<typeof startStorePipe>> | undefined;

  afterEach(async () => {
    await pipe?.close();
    pipe = undefined;
  });

  async function open(overrides: Partial<StorePipeDeps> = {}) {
    pipe = await startStorePipe({
      storeUrl: `https://${SPARE_NAME}:${overrides.storeUrl === undefined ? listener!.port : 0}`,
      authorityPem: venue.caCertPem,
      clientCertFile: join(dir, "client.crt"),
      clientKeyFile: join(dir, "client.key"),
      lookup: async () => ({ addresses: ["127.0.0.1"], remembered: false }),
      log: (level, event, fields) => logged.push({ level, event, ...(fields ? { fields } : {}) }),
      ...overrides,
    });
    return pipe;
  }

  /** A GET through the pipe's loopback address, as Litestream sends one: "200 stored", or the error's code. */
  function getThrough(loopbackUrl: string): Promise<string> {
    return new Promise((resolve) => {
      const req = httpRequest(`${loopbackUrl}/waitron/db`, { agent: false }, (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString()));
        res.on("end", () => resolve(`${res.statusCode} ${body}`));
      });
      req.on("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message));
      req.end();
    });
  }

  it("carries a request from loopback to the spare's store under this box's client certificate", async () => {
    await listen();
    const { loopbackUrl, problem } = await open();

    expect(loopbackUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(await getThrough(loopbackUrl)).toBe("200 stored");
    expect(seen.map((headers) => headers.host)).toEqual([new URL(loopbackUrl).host]);
    expect(problem()).toBeNull();
    expect(refusals()).toEqual([]);
  });

  it("asks for the store's host name and tries each address it answers to in turn", async () => {
    await listen();
    const asked: string[] = [];
    const { loopbackUrl, problem } = await open({
      lookup: async (hostname) => {
        asked.push(hostname);
        return { addresses: ["::1", "127.0.0.1"], remembered: false };
      },
    });

    expect(await getThrough(loopbackUrl)).toBe("200 stored");
    expect(asked).toEqual([SPARE_NAME]);
    expect(problem()).toBeNull();
  });

  it("refuses a spare whose certificate another authority signed, keeps why, and pipes nothing", async () => {
    await listen({ certFile: join(dir, "other.pem"), keyFile: join(dir, "other.pem") });
    const { loopbackUrl, problem } = await open();

    expect(await getThrough(loopbackUrl)).not.toBe("200 stored");

    expect(problem()).toEqual({
      reason: "CERT_SIGNATURE_FAILURE",
      since: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(logged).toContainEqual({
      level: "warn",
      event: "stream.spare_store_refused",
      fields: { reason: "CERT_SIGNATURE_FAILURE" },
    });
    expect(seen).toEqual([]);
  });

  it("refuses a spare whose certificate does not carry the store's host name", async () => {
    await listen();
    const { loopbackUrl, problem } = await open({
      storeUrl: `https://box-9e0d.waitron.local:${listener!.port}`,
    });

    expect(await getThrough(loopbackUrl)).not.toBe("200 stored");

    expect(problem()?.reason).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
    expect(seen).toEqual([]);
  });

  it("keeps a name nobody answers for as the problem", async () => {
    await listen();
    const { loopbackUrl, problem } = await open({
      lookup: async () => {
        throw new AppError("mirror.peer_unresolved", {});
      },
    });

    expect(await getThrough(loopbackUrl)).not.toBe("200 stored");

    expect(problem()?.reason).toBe("mirror.peer_unresolved");
  });

  it("clears the problem once a connection gets through again", async () => {
    await listen();
    let addresses = ["::1"];
    const { loopbackUrl, problem } = await open({
      lookup: async () => ({ addresses, remembered: false }),
    });
    expect(await getThrough(loopbackUrl)).not.toBe("200 stored");
    expect(problem()?.reason).toBe("ECONNREFUSED");

    addresses = ["127.0.0.1"];
    expect(await getThrough(loopbackUrl)).toBe("200 stored");

    expect(problem()).toBeNull();
  });

  it("logs a refusal once while its reason stays the same", async () => {
    await listen({ certFile: join(dir, "other.pem"), keyFile: join(dir, "other.pem") });
    const { loopbackUrl } = await open();

    for (let i = 0; i < 3; i++) expect(await getThrough(loopbackUrl)).not.toBe("200 stored");

    expect(logged.filter((line) => line.event === "stream.spare_store_refused")).toHaveLength(1);
  });

  it("a pipe refused by the spare's store (wrong client certificate) keeps why; the right certificate clears it", async () => {
    const port = await listen({ peerHostname: "box-9e0d.waitron.local" });
    const { loopbackUrl, problem } = await open();

    expect(await getThrough(loopbackUrl)).not.toBe("200 stored");

    await vi.waitFor(() => expect(problem()).not.toBeNull());
    // A reset or a plain close, by the operating system; macOS gave the plain close (2026-11-13).
    expect(problem()!.reason).toMatch(/^(ECONNRESET|store_closed_before_answer)$/);
    expect(logged.filter((line) => line.event === "stream.spare_store_refused")).toHaveLength(1);
    expect(seen).toEqual([]);

    await listener!.close();
    listener = undefined;
    await listen({ port });
    expect(await getThrough(loopbackUrl)).toBe("200 stored");
    expect(problem()).toBeNull();
  });

  it("logs an address that keeps failing once, while the next one answers", async () => {
    await listen();
    const { loopbackUrl, problem } = await open({
      lookup: async () => ({ addresses: ["::1", "127.0.0.1"], remembered: false }),
    });

    for (let i = 0; i < 5; i++) expect(await getThrough(loopbackUrl)).toBe("200 stored");

    expect(logged.filter((line) => line.event === "stream.spare_store_refused")).toEqual([
      { level: "warn", event: "stream.spare_store_refused", fields: { reason: "ECONNREFUSED" } },
    ]);
    expect(problem()).toBeNull();
  });

  it("moves on from an address that never completes the handshake", async () => {
    const port = await listen();
    const silent = createTcpServer(() => {});
    await new Promise<void>((resolve) => silent.listen(port, "::1", resolve));
    try {
      const { loopbackUrl, problem } = await open({
        connectTimeoutMs: 200,
        lookup: async () => ({ addresses: ["::1", "127.0.0.1"], remembered: false }),
      });

      expect(await getThrough(loopbackUrl)).toBe("200 stored");

      expect(logged).toContainEqual({
        level: "warn",
        event: "stream.spare_store_refused",
        fields: { reason: "ETIMEDOUT" },
      });
      expect(problem()).toBeNull();
    } finally {
      silent.close();
    }
  });

  it("tries the address that last completed a handshake first", async () => {
    const port = await listen();
    let dialed = 0;
    const silent = createTcpServer(() => (dialed += 1));
    await new Promise<void>((resolve) => silent.listen(port, "::1", resolve));
    try {
      const { loopbackUrl } = await open({
        connectTimeoutMs: 200,
        lookup: async () => ({ addresses: ["::1", "127.0.0.1"], remembered: false }),
      });

      expect(await getThrough(loopbackUrl)).toBe("200 stored");
      expect(await getThrough(loopbackUrl)).toBe("200 stored");

      expect(dialed).toBe(1);
    } finally {
      silent.close();
    }
  });

  /** A TCP listener that counts the connections it is offered and records when each one ends. */
  async function counting() {
    const sockets: import("node:net").Socket[] = [];
    const ended: boolean[] = [];
    const server = createTcpServer((socket) => {
      const index = sockets.push(socket) - 1;
      ended[index] = false;
      socket.on("error", () => {});
      socket.on("close", () => (ended[index] = true));
      // Read, or the end of the stream is never seen and the socket never closes.
      socket.resume();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const close = () => {
      for (const socket of sockets) socket.destroy();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    };
    return { port: (server.address() as AddressInfo).port, sockets, ended, close };
  }

  it("a connection still waiting on the name's lookup dials nothing once close has returned", async () => {
    const target = await counting();
    try {
      let release: (addresses: string[]) => void = () => {};
      let asked = false;
      const opened = await open({
        storeUrl: `https://${SPARE_NAME}:${target.port}`,
        lookup: () => {
          asked = true;
          return new Promise(
            (resolve) => (release = (addresses) => resolve({ addresses, remembered: false })),
          );
        },
      });
      const local = connectTcp(Number(new URL(opened.loopbackUrl).port), "127.0.0.1");
      local.on("error", () => {});
      await vi.waitFor(() => expect(asked).toBe(true));

      await opened.close();
      pipe = undefined;
      release(["127.0.0.1"]);

      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(target.sockets).toHaveLength(0);
    } finally {
      await target.close();
    }
  });

  it("close ends a connection to the spare still in its handshake, and logs no refusal for it", async () => {
    const target = await counting();
    try {
      const opened = await open({
        storeUrl: `https://${SPARE_NAME}:${target.port}`,
        connectTimeoutMs: 300,
      });
      const local = connectTcp(Number(new URL(opened.loopbackUrl).port), "127.0.0.1");
      local.on("error", () => {});
      await vi.waitFor(() => expect(target.sockets).toHaveLength(1));

      await opened.close();
      pipe = undefined;

      await vi.waitFor(() => expect(target.ended).toEqual([true]), { timeout: 250 });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(logged.filter((line) => line.event === "stream.spare_store_refused")).toEqual([]);
    } finally {
      await target.close();
    }
  });

  it("close settles a connection still in its handshake without waiting for its time limit", async () => {
    const target = await counting();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const opened = await open({ storeUrl: `https://${SPARE_NAME}:${target.port}` });
      const local = connectTcp(Number(new URL(opened.loopbackUrl).port), "127.0.0.1");
      local.on("error", () => {});
      await vi.waitFor(() => expect(target.sockets).toHaveLength(1));
      expect(vi.getTimerCount()).toBe(1);

      await opened.close();
      pipe = undefined;

      await vi.waitFor(() => expect(vi.getTimerCount()).toBe(0));
    } finally {
      vi.useRealTimers();
      await target.close();
    }
  });

  it("keeps a missing client certificate file as the problem", async () => {
    await listen();
    const { loopbackUrl, problem } = await open({ clientCertFile: join(dir, "absent.crt") });

    expect(await getThrough(loopbackUrl)).not.toBe("200 stored");

    expect(problem()?.reason).toBe("ENOENT");
    expect(seen).toEqual([]);
  });

  it("close ends a held connection and stops accepting", async () => {
    await listen();
    const opened = await open();
    const port = Number(new URL(opened.loopbackUrl).port);
    const held = connectTcp(port, "127.0.0.1");
    held.on("error", () => {});
    const ended = new Promise<void>((resolve) => held.on("close", () => resolve()));
    await new Promise<void>((resolve) => held.once("connect", () => resolve()));

    await opened.close();
    pipe = undefined;

    await ended;
    expect(await getThrough(opened.loopbackUrl)).toBe("ECONNREFUSED");
  });
});
