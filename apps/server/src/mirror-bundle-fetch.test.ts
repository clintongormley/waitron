import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { Hono } from "hono";
import type { Context } from "hono";
import { X509Certificate } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { hasCode, isAppError } from "@waitron/shared";
import type { AdoptCredential } from "./adopt.js";
import type { MirrorBundle } from "./mirror-bundle.js";
import { fetchMirrorBundle, fetchPrimaryCertificate } from "./mirror-bundle-fetch.js";
import {
  mintBoxAuthority,
  startBoxServer,
  startSilentServer,
  type BoxAuthority,
  type BoxServer,
  type SilentServer,
} from "./testing/box-authority.js";

// The fetcher only JSON-round-trips it, so the content is immaterial.
const SAMPLE_BUNDLE: MirrorBundle = {
  designated: {
    locationId: "22222222-2222-2222-2222-222222222222",
    nodeId: "44444444-4444-4444-4444-444444444444",
  },
  tenant: { country: "ES", taxId: "B00000000" },
  primaryNode: { name: "Caja 1", filingModule: "fiscal-verifactu", taxModule: null },
  environment: "preproduction",
  boxHostname: "waitron.local",
  boxCaPem: "-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n",
  relayUrl: "https://relay.example/abc",
  accountKey: Buffer.alloc(32, 9).toString("base64"),
  reservedIdentity: {
    modules: {
      "fiscal-verifactu": { nif: "B00000000", idSistemaInformatico: "W1", numeroInstalacion: 7 },
    },
    series: [{ code: "A-7", purpose: "standard" }],
    endorsement: {
      nodeId: "55555555-5555-5555-5555-555555555555",
      publicKey: "STANDBY_PUB",
      endorsedBy: "44444444-4444-4444-4444-444444444444",
      signature: "SIG",
    },
  },
  moduleOverrides: {},
  primaryPublicKey: "PRIMARY_PUB",
  credentialsRing: { key: Buffer.alloc(32, 5).toString("base64"), version: 1 },
  boxCaKeyPem: "-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n",
};

const CREDENTIAL: AdoptCredential = {
  personId: "99999999-9999-9999-9999-999999999999",
  password: "correct-horse-battery",
};

const STANDBY = {
  nodeId: "55555555-5555-5555-5555-555555555555",
  publicKey: "STANDBY_PUB",
  contactUrl: "https://cloud.deli.test",
};

const servers: ServerType[] = [];

async function startServer(app: Hono): Promise<string> {
  const port = await new Promise<number>((resolve) => {
    const server = serve(
      { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
      (info: AddressInfo) => resolve(info.port),
    );
    servers.push(server);
  });
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop()!;
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

describe("fetchMirrorBundle — the real HTTP bundle fetcher (C2b Task 9)", () => {
  it("fetches a designated node and location with no cached invoice series", async () => {
    const identity = { ...SAMPLE_BUNDLE.designated };
    const expected = { ...SAMPLE_BUNDLE, designated: identity };
    const app = new Hono();
    app.post("/management-api/mirror-bundle", (c) => c.json(expected));
    const bundle = await fetchMirrorBundle(await startServer(app), CREDENTIAL, STANDBY);
    expect(bundle).toEqual(expected);
    expect(bundle.designated).not.toHaveProperty("seriesId");
  });

  it("keeps a key ring's previous key and version", async () => {
    const rotating = {
      ...SAMPLE_BUNDLE,
      credentialsRing: {
        ...SAMPLE_BUNDLE.credentialsRing,
        previous: { key: Buffer.alloc(32, 6).toString("base64"), version: 2 },
      },
    };
    const app = new Hono();
    app.post("/management-api/mirror-bundle", (c) => c.json(rotating));
    expect(await fetchMirrorBundle(await startServer(app), CREDENTIAL, STANDBY)).toEqual(rotating);
  });

  it("POSTs the credential to /management-api/mirror-bundle and parses a 200 into a MirrorBundle", async () => {
    let seen: { method: string; path: string; body: string } | undefined;
    const app = new Hono();
    app.post("/management-api/mirror-bundle", async (c: Context) => {
      seen = { method: c.req.method, path: c.req.path, body: await c.req.text() };
      return c.json(SAMPLE_BUNDLE);
    });
    const base = await startServer(app);

    const bundle = await fetchMirrorBundle(base, CREDENTIAL, STANDBY);

    expect(bundle).toEqual(SAMPLE_BUNDLE);
    expect(bundle.boxHostname).toBe("waitron.local");
    expect(seen).toEqual({
      method: "POST",
      path: "/management-api/mirror-bundle",
      body: JSON.stringify({
        ...CREDENTIAL,
        standbyNodeId: STANDBY.nodeId,
        standbyPublicKey: STANDBY.publicKey,
        standbyContactUrl: STANDBY.contactUrl,
      }),
    });
  });

  it("tolerates a primaryUrl with a trailing slash (no double-slash path)", async () => {
    let path: string | undefined;
    const app = new Hono();
    app.post("/management-api/mirror-bundle", (c: Context) => {
      path = c.req.path;
      return c.json(SAMPLE_BUNDLE);
    });
    const base = await startServer(app);

    const bundle = await fetchMirrorBundle(`${base}/`, CREDENTIAL, STANDBY);

    expect(bundle).toEqual(SAMPLE_BUNDLE);
    expect(path).toBe("/management-api/mirror-bundle");
  });

  it("sends a typed path or query nowhere over plain http either", async () => {
    let seen: string | undefined;
    const app = new Hono();
    app.all("*", (c: Context) => {
      seen = `${c.req.method} ${new URL(c.req.url).pathname}${new URL(c.req.url).search}`;
      return c.json(SAMPLE_BUNDLE);
    });
    const base = await startServer(app);

    await fetchMirrorBundle(`${base}/admin/reboot?now=1#`, CREDENTIAL, STANDBY);

    expect(seen).toBe("POST /management-api/mirror-bundle");
  });

  it("re-runs the SSRF guard at the fetch boundary: a private/metadata URL throws before any fetch", async () => {
    for (const bad of [
      "http://169.254.169.254/latest",
      "https://10.0.0.5",
      "ftp://x",
      "not-a-url",
    ]) {
      const error = await fetchMirrorBundle(bad, CREDENTIAL, STANDBY).catch((e: unknown) => e);
      expect(isAppError(error) && hasCode(error, "mirror.primary_url_invalid")).toBe(true);
    }
  });

  it("relays the primary's password.invalid as password.invalid, carrying none of its params", async () => {
    const app = new Hono();
    app.post("/management-api/mirror-bundle", (c: Context) =>
      c.json(
        { error: { code: "password.invalid", params: { detail: "https://primary.internal" } } },
        401,
      ),
    );
    const base = await startServer(app);

    const error = await fetchMirrorBundle(base, CREDENTIAL, STANDBY).catch((e: unknown) => e);
    expect(isAppError(error) && hasCode(error, "password.invalid")).toBe(true);
    expect(isAppError(error) && error.params).toEqual({});
  });

  it.each([
    ["totp.invalid", { detail: "https://primary.internal" }],
    ["person.not_found", { personId: "99999999-9999-9999-9999-999999999999" }],
  ])(
    "passes no %s through, so the box never says which part of the login failed",
    async (code, params) => {
      const app = new Hono();
      app.post("/management-api/mirror-bundle", (c: Context) =>
        c.json({ error: { code, params } }, 401),
      );
      const base = await startServer(app);

      const error = await fetchMirrorBundle(base, CREDENTIAL, STANDBY).catch((e: unknown) => e);
      expect(isAppError(error) && hasCode(error, "mirror.bundle_fetch_failed")).toBe(true);
      expect(isAppError(error) && error.params).toEqual({});
    },
  );

  it.each([
    ["an unparseable body", "not json"],
    ["a body that is not an object", JSON.stringify(["totp.invalid"])],
    ["an error that is not an object", JSON.stringify({ error: "totp.invalid" })],
    ["an error with no code", JSON.stringify({ error: {} })],
    ["a code other than password.invalid", JSON.stringify({ error: { code: "person.suspended" } })],
  ])("maps a refusal with %s to mirror.bundle_fetch_failed", async (_shape, body) => {
    const app = new Hono();
    app.post("/management-api/mirror-bundle", (c: Context) => c.body(body, 403));
    const base = await startServer(app);

    const error = await fetchMirrorBundle(base, CREDENTIAL, STANDBY).catch((e: unknown) => e);
    expect(isAppError(error) && hasCode(error, "mirror.bundle_fetch_failed")).toBe(true);
  });

  it("maps a 200 with an unparseable body to mirror.bundle_fetch_failed", async () => {
    const app = new Hono();
    app.post("/management-api/mirror-bundle", (c: Context) =>
      c.body("not json at all", 200, { "content-type": "application/json" }),
    );
    const base = await startServer(app);

    const error = await fetchMirrorBundle(base, CREDENTIAL, STANDBY).catch((e: unknown) => e);
    expect(isAppError(error) && hasCode(error, "mirror.bundle_fetch_failed")).toBe(true);
  });

  it("maps a 200 with JSON null to mirror.bundle_fetch_failed", async () => {
    const app = new Hono();
    app.post("/management-api/mirror-bundle", (c: Context) => c.json(null));
    const base = await startServer(app);

    const error = await fetchMirrorBundle(base, CREDENTIAL, STANDBY).catch((e: unknown) => e);
    expect(isAppError(error) && hasCode(error, "mirror.bundle_fetch_failed")).toBe(true);
  });

  it.each([
    ["a number", 42],
    ["a string", "bundle"],
    ["an array", [SAMPLE_BUNDLE]],
    ["a missing required field", { ...SAMPLE_BUNDLE, tenant: undefined }],
    [
      "a wrong nested field type",
      { ...SAMPLE_BUNDLE, designated: { ...SAMPLE_BUNDLE.designated, nodeId: 42 } },
    ],
    [
      "a wrong series entry type",
      {
        ...SAMPLE_BUNDLE,
        reservedIdentity: {
          ...SAMPLE_BUNDLE.reservedIdentity,
          series: [{ code: 42, purpose: "standard" }],
        },
      },
    ],
    ["a wrong module override type", { ...SAMPLE_BUNDLE, moduleOverrides: { media: "yes" } }],
    ["a numeric CA certificate", { ...SAMPLE_BUNDLE, boxCaPem: 42 }],
    ["a null account key", { ...SAMPLE_BUNDLE, accountKey: null }],
    ["an unknown environment", { ...SAMPLE_BUNDLE, environment: "staging" }],
    ["a numeric optional WireGuard key", { ...SAMPLE_BUNDLE, wireguardPublicKey: 42 }],
    ["a null designated identity", { ...SAMPLE_BUNDLE, designated: null }],
    [
      "a numeric tenant country",
      { ...SAMPLE_BUNDLE, tenant: { ...SAMPLE_BUNDLE.tenant, country: 42 } },
    ],
    ["a null primary node", { ...SAMPLE_BUNDLE, primaryNode: null }],
    [
      "a numeric primary node name",
      { ...SAMPLE_BUNDLE, primaryNode: { ...SAMPLE_BUNDLE.primaryNode, name: 42 } },
    ],
    [
      "a numeric filing module",
      { ...SAMPLE_BUNDLE, primaryNode: { ...SAMPLE_BUNDLE.primaryNode, filingModule: 42 } },
    ],
    [
      "a numeric tax module",
      { ...SAMPLE_BUNDLE, primaryNode: { ...SAMPLE_BUNDLE.primaryNode, taxModule: 42 } },
    ],
    ["a null reserved identity", { ...SAMPLE_BUNDLE, reservedIdentity: null }],
    [
      "an array of module reservations",
      { ...SAMPLE_BUNDLE, reservedIdentity: { ...SAMPLE_BUNDLE.reservedIdentity, modules: [] } },
    ],
    [
      "a non-array series",
      { ...SAMPLE_BUNDLE, reservedIdentity: { ...SAMPLE_BUNDLE.reservedIdentity, series: {} } },
    ],
    [
      "a null endorsement",
      {
        ...SAMPLE_BUNDLE,
        reservedIdentity: { ...SAMPLE_BUNDLE.reservedIdentity, endorsement: null },
      },
    ],
    [
      "a numeric endorsement signature",
      {
        ...SAMPLE_BUNDLE,
        reservedIdentity: {
          ...SAMPLE_BUNDLE.reservedIdentity,
          endorsement: { ...SAMPLE_BUNDLE.reservedIdentity.endorsement, signature: 42 },
        },
      },
    ],
    ["null module overrides", { ...SAMPLE_BUNDLE, moduleOverrides: null }],
    ["no main box public key", { ...SAMPLE_BUNDLE, primaryPublicKey: undefined }],
    ["no authority key", { ...SAMPLE_BUNDLE, boxCaKeyPem: undefined }],
    ["no key ring", { ...SAMPLE_BUNDLE, credentialsRing: undefined }],
    ["an array key ring", { ...SAMPLE_BUNDLE, credentialsRing: [] }],
    [
      "a numeric ring key",
      { ...SAMPLE_BUNDLE, credentialsRing: { ...SAMPLE_BUNDLE.credentialsRing, key: 42 } },
    ],
    [
      "a string ring version",
      { ...SAMPLE_BUNDLE, credentialsRing: { ...SAMPLE_BUNDLE.credentialsRing, version: "1" } },
    ],
    [
      "a null previous key",
      { ...SAMPLE_BUNDLE, credentialsRing: { ...SAMPLE_BUNDLE.credentialsRing, previous: null } },
    ],
    [
      "a previous key with no version",
      {
        ...SAMPLE_BUNDLE,
        credentialsRing: { ...SAMPLE_BUNDLE.credentialsRing, previous: { key: "AAAA" } },
      },
    ],
    [
      "a previous key with a numeric key",
      {
        ...SAMPLE_BUNDLE,
        credentialsRing: { ...SAMPLE_BUNDLE.credentialsRing, previous: { key: 4, version: 2 } },
      },
    ],
  ])("maps 200 JSON with %s to mirror.bundle_fetch_failed", async (_shape, body) => {
    const app = new Hono();
    app.post("/management-api/mirror-bundle", (c: Context) =>
      c.body(JSON.stringify(body), 200, { "content-type": "application/json" }),
    );
    const base = await startServer(app);

    const error = await fetchMirrorBundle(base, CREDENTIAL, STANDBY).catch((e: unknown) => e);
    expect(isAppError(error) && hasCode(error, "mirror.bundle_fetch_failed")).toBe(true);
  });

  it("follows no redirect, so the password reaches no address the guard refuses", async () => {
    let received = "";
    const target = new Hono();
    target.all("*", async (c: Context) => {
      received += await c.req.text();
      return c.json(SAMPLE_BUNDLE);
    });
    // The guard refuses this spelling of loopback, yet this machine still answers it.
    const refused = `http://[::ffff:127.0.0.1]:${new URL(await startServer(target)).port}/`;
    const source = new Hono();
    source.post("/management-api/mirror-bundle", (c: Context) => c.redirect(refused, 307));
    const base = await startServer(source);

    const error = await fetchMirrorBundle(refused, CREDENTIAL, STANDBY).catch((e: unknown) => e);
    expect(isAppError(error) && hasCode(error, "mirror.primary_url_invalid")).toBe(true);

    const redirected = await fetchMirrorBundle(base, CREDENTIAL, STANDBY).catch((e: unknown) => e);

    expect(isAppError(redirected) && hasCode(redirected, "mirror.bundle_fetch_failed")).toBe(true);
    expect(received).toBe("");
  });

  it("maps a network failure (nothing listening) to mirror.bundle_fetch_failed", async () => {
    // A port just closed refuses the connect fast and deterministically.
    const app = new Hono();
    const base = await startServer(app);
    const server = servers.pop()!;
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );

    const error = await fetchMirrorBundle(base, CREDENTIAL, STANDBY).catch((e: unknown) => e);
    expect(isAppError(error) && hasCode(error, "mirror.bundle_fetch_failed")).toBe(true);
  });
});

describe("the spare checks the main box's certificate before it sends a password", () => {
  let x: BoxAuthority;
  let y: BoxAuthority;
  const boxServers: BoxServer[] = [];

  beforeAll(async () => {
    [x, y] = await Promise.all([mintBoxAuthority(), mintBoxAuthority()]);
  });

  afterEach(async () => {
    while (boxServers.length > 0) await boxServers.pop()!.close();
  });

  async function serveBundle(authority: BoxAuthority, boxCaPem: string): Promise<BoxServer> {
    const server = await startBoxServer(authority, () => ({
      status: 200,
      body: JSON.stringify({ ...SAMPLE_BUNDLE, boxCaPem }),
    }));
    boxServers.push(server);
    return server;
  }

  it("with the confirmed authority, the bundle arrives", async () => {
    const server = await serveBundle(x, x.caPem);

    const bundle = await fetchMirrorBundle(server.url, CREDENTIAL, STANDBY, x.caPem);

    expect(bundle).toEqual({ ...SAMPLE_BUNDLE, boxCaPem: x.caPem });
    expect(server.requests).toHaveLength(1);
  });

  it("refuses a bundle whose authority is not the confirmed one, after the box received the request", async () => {
    const server = await serveBundle(x, y.caPem);

    const error = await fetchMirrorBundle(server.url, CREDENTIAL, STANDBY, x.caPem).catch(
      (e: unknown) => e,
    );

    expect(server.requests).toHaveLength(1);
    expect(isAppError(error) && hasCode(error, "mirror.bundle_fetch_failed")).toBe(true);
    expect(isAppError(error) && error.params).toEqual({});
  });

  it("refuses mirror.primary_unconfirmed over https when nothing was confirmed, sending nothing", async () => {
    const server = await serveBundle(x, x.caPem);

    const error = await fetchMirrorBundle(server.url, CREDENTIAL, STANDBY).catch((e: unknown) => e);

    expect(isAppError(error) && hasCode(error, "mirror.primary_unconfirmed")).toBe(true);
    expect(server.requests).toHaveLength(0);
  });

  // A pin, not a failing test: today's default trust refuses Y as well. The first case is its
  // control.
  it("sends nothing to a box whose certificate is not the confirmed one", async () => {
    const server = await serveBundle(y, y.caPem);

    const error = await fetchMirrorBundle(server.url, CREDENTIAL, STANDBY, x.caPem).catch(
      (e: unknown) => e,
    );

    expect(isAppError(error) && hasCode(error, "mirror.bundle_fetch_failed")).toBe(true);
    expect(server.requests).toHaveLength(0);
  });

  it("sends nothing to a box under another authority even with Node's certificate checks switched off", async () => {
    const server = await serveBundle(y, y.caPem);
    vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED", "0");
    try {
      const error = await fetchMirrorBundle(server.url, CREDENTIAL, STANDBY, x.caPem).catch(
        (e: unknown) => e,
      );

      expect(isAppError(error) && hasCode(error, "mirror.bundle_fetch_failed")).toBe(true);
      expect(server.requests).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("reads the authority certificate from a box it does not trust yet, sending no credential", async () => {
    const server = await startBoxServer(x, () => ({
      status: 200,
      body: x.caPem,
      contentType: "application/x-pem-file",
    }));
    boxServers.push(server);

    const read = await fetchPrimaryCertificate(server.url);

    const expected = new X509Certificate(x.caPem);
    expect(read).toEqual({ pem: expected.toString(), fingerprint256: expected.fingerprint256 });
    expect(server.requests).toHaveLength(1);
    const [seen] = server.requests;
    expect(seen!.method).toBe("GET");
    expect(seen!.path).toBe("/ca.crt");
    expect(seen!.body).toBe("");
    expect(seen!.headers).not.toHaveProperty("authorization");
    expect(seen!.headers).not.toHaveProperty("cookie");
  });

  it("answers null for a plain-http loopback main box, which has no certificate to compare", async () => {
    expect(await fetchPrimaryCertificate("http://127.0.0.1:1")).toBeNull();
  });

  it.each([
    ["a refusal", () => ({ status: 404, body: "" })],
    ["the box's leaf, which is no authority", () => ({ status: 200, body: x.certPem })],
    ["two certificates", () => ({ status: 200, body: x.caPem + y.caPem })],
    [
      "a broken certificate",
      () => ({
        status: 200,
        body: "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n",
      }),
    ],
    ["an answer far larger than a certificate", () => ({ status: 200, body: "A".repeat(70_000) })],
  ])("refuses to read the authority from %s", async (_label, answer) => {
    const server = await startBoxServer(x, answer);
    boxServers.push(server);

    const error = await fetchPrimaryCertificate(server.url).catch((e: unknown) => e);
    expect(isAppError(error) && hasCode(error, "mirror.bundle_fetch_failed")).toBe(true);
  });

  it("refuses an authority certificate padded past 64 KiB", async () => {
    const server = await startBoxServer(x, () => ({
      status: 200,
      body: x.caPem + "\n".repeat(70_000),
    }));
    boxServers.push(server);

    const error = await fetchPrimaryCertificate(server.url).catch((e: unknown) => e);
    expect(isAppError(error) && hasCode(error, "mirror.bundle_fetch_failed")).toBe(true);
  });

  it("refuses an authority certificate the box sends with a status other than 200", async () => {
    const server = await startBoxServer(x, () => ({ status: 500, body: x.caPem }));
    boxServers.push(server);

    const error = await fetchPrimaryCertificate(server.url).catch((e: unknown) => e);
    expect(isAppError(error) && hasCode(error, "mirror.bundle_fetch_failed")).toBe(true);
  });

  it("checks the address itself, so an unsafe one reaches no box", async () => {
    const server = await startBoxServer(x, () => ({ status: 200, body: x.caPem }));
    boxServers.push(server);
    const port = new URL(server.url).port;

    // 0.0.0.0 is a refused address that this machine still answers, at the box above.
    for (const unsafe of [`https://0.0.0.0:${port}`, "http://example.com:1"]) {
      const error = await fetchPrimaryCertificate(unsafe).catch((e: unknown) => e);
      expect(isAppError(error) && hasCode(error, "mirror.primary_url_invalid")).toBe(true);
    }
    expect(server.requests).toHaveLength(0);
  });

  it.each([
    ["an empty certificate", () => ""],
    ["two certificates, the wrong one first", () => y.caPem + x.caPem],
    ["the box's leaf, which is no authority", () => y.certPem],
    [
      "a broken certificate",
      () => "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n",
    ],
  ])(
    "refuses mirror.primary_unconfirmed when what was confirmed is %s, sending nothing",
    async (_label, confirmed) => {
      const server = await serveBundle(y, y.caPem);

      const error = await fetchMirrorBundle(server.url, CREDENTIAL, STANDBY, confirmed()).catch(
        (e: unknown) => e,
      );

      expect(isAppError(error) && hasCode(error, "mirror.primary_unconfirmed")).toBe(true);
      expect(server.requests).toHaveLength(0);
    },
  );

  it("refuses a bundle whose authority cannot be read as a certificate", async () => {
    const server = await serveBundle(x, "not a certificate");

    const error = await fetchMirrorBundle(server.url, CREDENTIAL, STANDBY, x.caPem).catch(
      (e: unknown) => e,
    );
    expect(isAppError(error) && hasCode(error, "mirror.bundle_fetch_failed")).toBe(true);
  });

  it("relays a refused login over https as password.invalid", async () => {
    const server = await startBoxServer(x, () => ({
      status: 401,
      body: JSON.stringify({ error: { code: "password.invalid", params: { detail: "x" } } }),
    }));
    boxServers.push(server);

    const error = await fetchMirrorBundle(server.url, CREDENTIAL, STANDBY, x.caPem).catch(
      (e: unknown) => e,
    );
    expect(isAppError(error) && hasCode(error, "password.invalid")).toBe(true);
    expect(isAppError(error) && error.params).toEqual({});
  });

  it("sends a typed path, query or fragment to neither the certificate read nor the bundle request", async () => {
    const server = await startBoxServer(x, (seen) =>
      seen.method === "GET"
        ? { status: 200, body: x.caPem, contentType: "application/x-pem-file" }
        : { status: 200, body: JSON.stringify({ ...SAMPLE_BUNDLE, boxCaPem: x.caPem }) },
    );
    boxServers.push(server);
    const typed = `${server.url}/admin/reboot?now=1#`;

    await fetchPrimaryCertificate(typed);
    await fetchMirrorBundle(typed, CREDENTIAL, STANDBY, x.caPem);

    expect(server.requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "GET /ca.crt",
      "POST /management-api/mirror-bundle",
    ]);
  });
});

describe("a main box that never answers is given up on, so setup is not held", () => {
  const LIMIT_MS = 300;
  // Far above LIMIT_MS: a call still waiting here has no limit at all.
  const DEADLINE_MS = 5_000;
  let x: BoxAuthority;
  const silent: SilentServer[] = [];

  beforeAll(async () => {
    x = await mintBoxAuthority();
  });

  afterEach(async () => {
    while (silent.length > 0) await silent.pop()!.close();
  });

  async function settleWithin(call: Promise<unknown>, ms: number): Promise<unknown> {
    let timer: NodeJS.Timeout | undefined;
    const waiting = new Promise((resolve) => {
      timer = setTimeout(() => resolve("still waiting"), ms);
    });
    try {
      return await Promise.race([call.catch((e: unknown) => e), waiting]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function silentBox(tls: boolean): Promise<SilentServer> {
    const server = await startSilentServer(tls ? x : undefined);
    silent.push(server);
    return server;
  }

  const shapes = [
    ["accepts the connection and sends nothing", false],
    ["completes TLS and never answers the request", true],
  ] as const;

  it.each(shapes)(
    "the certificate read refuses a box that %s within its limit",
    async (_label, tls) => {
      const { port } = await silentBox(tls);

      const error = await settleWithin(
        fetchPrimaryCertificate(`https://localhost:${port}`, { timeoutMs: LIMIT_MS }),
        DEADLINE_MS,
      );

      expect(isAppError(error) && hasCode(error, "mirror.bundle_fetch_failed")).toBe(true);
    },
  );

  it.each(shapes)(
    "the bundle request refuses a box that %s within its limit",
    async (_label, tls) => {
      const { port } = await silentBox(tls);

      const error = await settleWithin(
        fetchMirrorBundle(`https://localhost:${port}`, CREDENTIAL, STANDBY, x.caPem, {
          timeoutMs: LIMIT_MS,
        }),
        DEADLINE_MS,
      );

      expect(isAppError(error) && hasCode(error, "mirror.bundle_fetch_failed")).toBe(true);
    },
  );

  it("the plain-http bundle request refuses a loopback box that never answers within its limit", async () => {
    const { port } = await silentBox(false);

    const error = await settleWithin(
      fetchMirrorBundle(`http://127.0.0.1:${port}`, CREDENTIAL, STANDBY, undefined, {
        timeoutMs: LIMIT_MS,
      }),
      DEADLINE_MS,
    );

    expect(isAppError(error) && hasCode(error, "mirror.bundle_fetch_failed")).toBe(true);
  });

  describe("the limits a caller gets when it names none", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    async function pendingAfter(call: Promise<unknown>, ms: number): Promise<unknown> {
      let settled: unknown = "still waiting";
      void call.then(
        (value) => (settled = value),
        (error: unknown) => (settled = error),
      );
      await vi.advanceTimersByTimeAsync(ms);
      for (let turn = 0; turn < 20; turn += 1) await new Promise((r) => setImmediate(r));
      return settled;
    }

    it("the certificate read waits 10 seconds", async () => {
      const { port } = await silentBox(true);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

      const call = fetchPrimaryCertificate(`https://localhost:${port}`);
      expect(await pendingAfter(call, 9_999)).toBe("still waiting");
      const error = await pendingAfter(call, 1);
      expect(isAppError(error) && hasCode(error, "mirror.bundle_fetch_failed")).toBe(true);
    });

    it("the bundle request waits 60 seconds", async () => {
      const { port } = await silentBox(true);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

      const call = fetchMirrorBundle(`https://localhost:${port}`, CREDENTIAL, STANDBY, x.caPem);
      expect(await pendingAfter(call, 59_999)).toBe("still waiting");
      const error = await pendingAfter(call, 1);
      expect(isAppError(error) && hasCode(error, "mirror.bundle_fetch_failed")).toBe(true);
    });
  });
});
