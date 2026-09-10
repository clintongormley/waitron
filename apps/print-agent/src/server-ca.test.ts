import { createServer, type Server } from "node:https";
import { rootCertificates } from "node:tls";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "agent-ca-"));
  });
  afterEach(() => {
    for (const s of servers) s.close();
    servers.length = 0;
  });

  it("without the box CA, a request to the self-signed server fails verification (the bug this fixes)", async () => {
    const material = mintCa("localhost");
    const { server, origin } = await startHttps(material);
    servers.push(server);
    // caEndpointFetch hands back a DIFFERENT, unrelated CA — so the box's real CA is never trusted
    // and verification must fail. This is the negative control: it proves we are verifying, not
    // accepting every certificate.
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
    // It asked the plain-HTTP landing route on port 80 of the server's host.
    expect(responder.calls).toEqual(["http://localhost/ca.crt"]);
    // And it persisted the CA for a restart to trust immediately.
    expect(await readFile(join(stateDir, "server-ca.crt"), "utf8")).toBe(material.caPem);
  });

  it("retains Node's public roots (does not disable verification)", async () => {
    // A server whose CA is NOT the one we fetch must still fail — proving the trust set is
    // (public roots + box CA), not "accept anything". Public roots are present because the module
    // spreads tls.rootCertificates; this asserts the negative half on real TLS.
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
    // The reimaged-box path, exercised for real — the ONLY case that runs the catch → refresh → retry
    // branch. Boot pins the OLD CA (the endpoint still serves old at clock=0, so no change at boot),
    // while the HTTPS server already presents the NEW leaf. An hour later the endpoint serves the NEW
    // CA. The first request FAILS verification (the pinned old CA cannot verify the new leaf), the
    // module refetches, sees the CA changed, rebuilds trust, and the retry succeeds.
    //
    // Boot must serve OLD (not NEW): if the endpoint served NEW at boot, boot's own refresh() would
    // pin it before any request and the retry branch would never run — the vacuous-pass this case
    // exists to avoid (fresh-review I1).
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
    // The endpoint keeps handing back an UNRELATED CA, so every request fails verification and would
    // refetch every time if unthrottled. The clock must ADVANCE between boot and the first failure —
    // a constant clock collides boot's own refresh() (which sets lastFetchAt) with the post-failure
    // refetch, throttling it away and making the .toBe(2) below impossible (fresh-review B1). So:
    // boot fetches at clock=0 (lastFetchAt=0); advance past the hour so the FIRST failure refetches;
    // the SECOND failure is inside that new hour and must NOT.
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
    // Covers refresh()'s `!res.ok` branch. A 404 must not pin a body; the agent falls back to public
    // roots, so the self-signed server still fails verification — proving nothing was pinned.
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
    // Covers refresh()'s `pem.trim() === ""` branch: a blank body is not a CA and is never persisted.
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
});
