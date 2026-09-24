import { createServer, type Server } from "node:https";
import { rootCertificates } from "node:tls";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import forge from "node-forge";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServerTrustingFetch } from "./server-ca.js";

/** A CA + a leaf for `commonName`/`127.0.0.1`, returned as PEMs and a usable key. */
function mintCa(leafCn: string): { caPem: string; serverKeyPem: string; serverCertPem: string } {
  const caKeys = forge.pki.rsa.generateKeyPair(2048);
  const ca = forge.pki.createCertificate();
  ca.publicKey = caKeys.publicKey;
  ca.serialNumber = "01";
  ca.validity.notBefore = new Date(2026, 0, 1);
  ca.validity.notAfter = new Date(2030, 0, 1);
  ca.setSubject([{ name: "commonName", value: "test-ca" }]);
  ca.setIssuer([{ name: "commonName", value: "test-ca" }]);
  ca.setExtensions([
    { name: "basicConstraints", cA: true },
    { name: "keyUsage", keyCertSign: true, digitalSignature: true },
  ]);
  ca.sign(caKeys.privateKey, forge.md.sha256.create());

  const serverKeys = forge.pki.rsa.generateKeyPair(2048);
  const leaf = forge.pki.createCertificate();
  leaf.publicKey = serverKeys.publicKey;
  leaf.serialNumber = "02";
  leaf.validity.notBefore = new Date(2026, 0, 1);
  leaf.validity.notAfter = new Date(2030, 0, 1);
  leaf.setSubject([{ name: "commonName", value: leafCn }]);
  leaf.setIssuer([{ name: "commonName", value: "test-ca" }]);
  leaf.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "extKeyUsage", serverAuth: true },
    {
      name: "subjectAltName",
      altNames: [
        { type: 2, value: "localhost" },
        { type: 7, ip: "127.0.0.1" },
      ],
    },
  ]);
  leaf.sign(caKeys.privateKey, forge.md.sha256.create());

  return {
    caPem: forge.pki.certificateToPem(ca),
    serverKeyPem: forge.pki.privateKeyToPem(serverKeys.privateKey),
    serverCertPem: forge.pki.certificateToPem(leaf),
  };
}

function startHttps(material: {
  serverKeyPem: string;
  serverCertPem: string;
}): Promise<{ server: Server; origin: string }> {
  return new Promise((resolve) => {
    const server = createServer(
      { key: material.serverKeyPem, cert: material.serverCertPem },
      (_req, res) => {
        res.writeHead(200);
        res.end("ok");
      },
    );
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, origin: `https://localhost:${port}` });
    });
  });
}

/** A caEndpointFetch stub. `pem` is a fixed string or a getter (for rotation, where the served CA
 * changes over the test); `status` overrides the 200 for the error-path cases. Records every URL. */
function caResponder(
  pem: string | (() => string),
  opts: { status?: number } = {},
): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const body = typeof pem === "function" ? pem() : pem;
    return new Response(body, { status: opts.status ?? 200 });
  }) as typeof fetch;
  return { fetch: fn, calls };
}

describe("createServerTrustingFetch", () => {
  let stateDir: string;
  const servers: Server[] = [];
  const stateDirs: string[] = [];
  const makeStateDir = async (): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), "print-agent-ca-"));
    stateDirs.push(dir);
    return dir;
  };
  beforeEach(async () => {
    stateDir = await makeStateDir();
  });
  afterEach(async () => {
    for (const s of servers) s?.close();
    servers.length = 0;
    for (const dir of stateDirs) await rm(dir, { recursive: true, force: true });
    stateDirs.length = 0;
  });

  it("without the box CA, a request to the self-signed server fails verification (the bug this fixes)", async () => {
    const material = mintCa("localhost");
    const { server, origin } = await startHttps(material);
    servers.push(server);
    // The negative control: the endpoint hands back an unrelated CA, so verification must fail.
    const unrelated = mintCa("localhost").caPem;
    const trusting = await createServerTrustingFetch({
      serverUrl: origin,
      stateDir,
      caEndpointFetch: caResponder(unrelated).fetch,
    });
    await expect(trusting(`${origin}/x`)).rejects.toThrow();
  });

  it("with the box CA fetched from /ca.crt, the same request succeeds", async () => {
    const material = mintCa("localhost");
    const { server, origin } = await startHttps(material);
    servers.push(server);
    const responder = caResponder(material.caPem);
    const trusting = await createServerTrustingFetch({
      serverUrl: origin,
      stateDir,
      caEndpointFetch: responder.fetch,
    });
    const res = await trusting(`${origin}/x`);
    expect(res.status).toBe(200);
    expect(responder.calls).toEqual(["http://localhost/ca.crt"]);
    expect(await readFile(join(stateDir, "server-ca.crt"), "utf8")).toBe(material.caPem);
  });

  it("rejects a server whose CA was not fetched (verification stays on, not accept-all)", async () => {
    // Guards only the negative half: deleting `...rootCertificates` from the dispatcher's `ca`
    // would not fail this case, because public-root retention needs a real public-root-signed
    // server.
    const boxMaterial = mintCa("localhost");
    const otherServer = mintCa("localhost"); // a different CA, not fetched
    const { server, origin } = await startHttps(otherServer);
    servers.push(server);
    const trusting = await createServerTrustingFetch({
      serverUrl: origin,
      stateDir,
      caEndpointFetch: caResponder(boxMaterial.caPem).fetch,
    });
    await expect(trusting(`${origin}/x`)).rejects.toThrow();
    expect(rootCertificates.length).toBeGreaterThan(0); // guards the spread source exists
  });

  it("on a verification failure, refetches the CA and retries once when it changed (rotation)", async () => {
    // The ONLY case that runs the catch → refresh → retry branch. Boot must serve the OLD CA:
    // served NEW, boot's own refresh() would pin it and the retry branch would never run.
    const oldMaterial = mintCa("localhost");
    await writeFile(join(stateDir, "server-ca.crt"), oldMaterial.caPem, { mode: 0o644 });
    const newMaterial = mintCa("localhost");
    const { server, origin } = await startHttps(newMaterial);
    servers.push(server);
    let clock = 0;
    let served = oldMaterial.caPem; // the box is not reimaged yet
    const responder = caResponder(() => served);
    const trusting = await createServerTrustingFetch({
      serverUrl: origin,
      stateDir,
      caEndpointFetch: responder.fetch,
      now: () => clock,
    });
    clock = 60 * 60 * 1000 + 1; // an hour passes; the box is reimaged and now serves the new CA
    served = newMaterial.caPem;
    const res = await trusting(`${origin}/x`);
    expect(res.status).toBe(200);
    // boot fetch (old, no change) + one refetch on the verify failure (new).
    expect(responder.calls.length).toBe(2);
  });

  it("throttles the refetch to at most once per hour", async () => {
    const material = mintCa("localhost");
    const { server, origin } = await startHttps(material);
    servers.push(server);
    // The clock must ADVANCE between boot and the first failure, or boot's own refresh() would
    // throttle the post-failure refetch away too.
    let clock = 0;
    const responder = caResponder(mintCa("localhost").caPem);
    const trusting = await createServerTrustingFetch({
      serverUrl: origin,
      stateDir,
      caEndpointFetch: responder.fetch,
      now: () => clock,
    });
    clock = 60 * 60 * 1000 + 1; // past the hour, so the next failure is allowed to refetch
    await expect(trusting(`${origin}/x`)).rejects.toThrow();
    await expect(trusting(`${origin}/x`)).rejects.toThrow();
    // boot fetch (clock=0) + one refetch on the first failure; the second is inside the hour → no fetch.
    expect(responder.calls.length).toBe(2);
  });

  it("is a pass-through for an http server URL (no CA to fetch)", async () => {
    const base = (async () => new Response("plain", { status: 200 })) as typeof fetch;
    const responder = caResponder("unused");
    const trusting = await createServerTrustingFetch({
      serverUrl: "http://127.0.0.1:8080",
      stateDir,
      fetch: base,
      caEndpointFetch: responder.fetch,
    });
    const res = await trusting("http://127.0.0.1:8080/x");
    expect(res.status).toBe(200);
    expect(responder.calls).toEqual([]); // never asked for a CA
  });

  it("is a pass-through when serverUrl is undefined (unconfigured agent)", async () => {
    const base = (async () => new Response(null, { status: 204 })) as typeof fetch;
    const trusting = await createServerTrustingFetch({
      serverUrl: undefined,
      stateDir,
      fetch: base,
    });
    expect((await trusting("http://x/y")).status).toBe(204);
  });

  it("ignores a non-200 from /ca.crt and pins nothing (operator-cert box has no CA to serve)", async () => {
    // The self-signed server still failing verification proves nothing was pinned.
    const material = mintCa("localhost");
    const { server, origin } = await startHttps(material);
    servers.push(server);
    const trusting = await createServerTrustingFetch({
      serverUrl: origin,
      stateDir,
      caEndpointFetch: caResponder("not found", { status: 404 }).fetch,
    });
    await expect(trusting(`${origin}/x`)).rejects.toThrow();
    await expect(readFile(join(stateDir, "server-ca.crt"), "utf8")).rejects.toThrow();
  });

  it("ignores an empty /ca.crt body", async () => {
    const material = mintCa("localhost");
    const { server, origin } = await startHttps(material);
    servers.push(server);
    const trusting = await createServerTrustingFetch({
      serverUrl: origin,
      stateDir,
      caEndpointFetch: caResponder("   ").fetch,
    });
    await expect(trusting(`${origin}/x`)).rejects.toThrow();
    await expect(readFile(join(stateDir, "server-ca.crt"), "utf8")).rejects.toThrow();
  });

  it("a failed first-boot fetch retries after the short interval, not an hour", async () => {
    // Were the interval an hour, the refresh at clock=10s would be throttled away and the request
    // would throw.
    const material = mintCa("localhost");
    const { server, origin } = await startHttps(material);
    servers.push(server);
    const calls: string[] = [];
    const responder = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      if (calls.length === 1) return new Response("landing not up yet", { status: 500 });
      return new Response(material.caPem, { status: 200 });
    }) as typeof fetch;
    let clock = 0;
    const trusting = await createServerTrustingFetch({
      serverUrl: origin,
      stateDir,
      caEndpointFetch: responder,
      now: () => clock,
    });
    expect(calls.length).toBe(1); // boot fetch failed (500), nothing pinned
    clock = 10_000; // INITIAL_RETRY_INTERVAL_MS — the short interval, NOT an hour
    const res = await trusting(`${origin}/x`);
    expect(res.status).toBe(200);
    expect(calls.length).toBe(2); // refetched after the short interval and now trusts the box
  });

  it("with a usable cached CA, boot does not block on a hung /ca.crt", async () => {
    const material = mintCa("localhost");
    const { server, origin } = await startHttps(material);
    servers.push(server);
    await writeFile(join(stateDir, "server-ca.crt"), material.caPem, { mode: 0o644 });
    const hung = (() => new Promise<Response>(() => {})) as typeof fetch;
    const trusting = await createServerTrustingFetch({
      serverUrl: origin,
      stateDir,
      caEndpointFetch: hung,
      caFetchTimeoutMs: 50, // the background refresh's abort fires quickly; boot never waits on it
    });
    const res = await trusting(`${origin}/x`);
    expect(res.status).toBe(200); // verified against the cached CA, no wait on the hung endpoint
  });

  it("with no cached CA, boot is bounded and returns a working pass-through when /ca.crt hangs", async () => {
    const base = (async () => new Response("ok", { status: 200 })) as typeof fetch;
    const hung = (() => new Promise<Response>(() => {})) as typeof fetch;
    const trusting = await createServerTrustingFetch({
      serverUrl: "https://127.0.0.1",
      stateDir,
      fetch: base,
      caEndpointFetch: hung,
      caFetchTimeoutMs: 50,
    });
    const res = await trusting("https://127.0.0.1/x");
    expect(res.status).toBe(200); // factory resolved (bounded) and passes requests through
  });

  it("keeps in-memory trust when the CA cannot be persisted (best-effort cache)", async () => {
    // A child of a regular file, so mkdir/write/rename throw.
    const material = mintCa("localhost");
    const { server, origin } = await startHttps(material);
    servers.push(server);
    const parent = await makeStateDir(); // tracked for cleanup
    const notADir = join(parent, "not-a-dir");
    await writeFile(notADir, "x");
    const badStateDir = join(notADir, "sub"); // child of a file — unwritable
    const trusting = await createServerTrustingFetch({
      serverUrl: origin,
      stateDir: badStateDir,
      caEndpointFetch: caResponder(material.caPem).fetch,
    });
    const res = await trusting(`${origin}/x`);
    expect(res.status).toBe(200); // in-memory CA trusts the box despite the failed persist
  });
});
