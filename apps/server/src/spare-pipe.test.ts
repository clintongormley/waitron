import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingHttpHeaders, type Server } from "node:http";
import { request } from "node:https";
import { connect } from "node:tls";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  issueClientCert,
  mintSelfSignedServerCert,
  reissueServerLeaf,
  type SelfSignedMaterial,
} from "./self-signed-cert.js";
import { startStoreListener, type StoreListenerDeps } from "./spare-pipe.js";

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
