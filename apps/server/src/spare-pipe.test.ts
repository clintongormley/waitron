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
import { startStoreListener } from "./spare-pipe.js";

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

async function listen(): Promise<number> {
  listener = await startStoreListener({
    port: 0,
    host: "127.0.0.1",
    certFile: join(dir, "server.pem"),
    keyFile: join(dir, "server.pem"),
    caFile: join(dir, "ca.crt"),
    peerHostname: MAIN_NAME,
    upstreamPort,
    log: (level, event, fields) => logged.push({ level, event, ...(fields ? { fields } : {}) }),
  });
  return listener.port;
}

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
      fields: { reason },
    }),
  );
  expect(seen).toEqual([]);
}

describe("startStoreListener", () => {
  it("carries a request from the paired main box's client certificate, Host header unchanged", async () => {
    const port = await listen();

    expect(await get(port, clientFor(venue, MAIN_NAME))).toBe("200 stored");

    expect(seen.map((headers) => headers.host)).toEqual([STORE_HOST]);
    expect(logged).toEqual([]);
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
});
