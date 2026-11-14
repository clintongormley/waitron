import { createServer as createHttpServer, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { Readable } from "node:stream";
import { existsSync, statSync } from "node:fs";
import * as fs from "node:fs/promises";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import {
  createConnection,
  createServer as createTcpServer,
  type AddressInfo,
  type Server as NetServer,
  type Socket,
} from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTlsServer } from "node:tls";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { Hono } from "hono";
import type { Context } from "hono";
import { createHash, X509Certificate } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, hasCode, isAppError } from "@waitron/shared";
import { CHECKED_ADDRESSES_FILE } from "@waitron/store";
import type { AdoptCredential } from "./adopt.js";
import { lookupBoxName, type BoxAddresses, type MdnsQuerySocket } from "./box-lookup.js";
import type { MirrorBundle } from "./mirror-bundle.js";
import {
  boxDownload,
  boxExchange,
  fetchMirrorBundle,
  fetchPrimaryCertificate,
  CheckedAddresses,
  CheckedAddressUnreached,
  type BoxLookup,
} from "./mirror-bundle-fetch.js";
import {
  mintBoxAuthority,
  startBoxServer,
  startSilentServer,
  type BoxAuthority,
  type BoxServer,
  type SilentServer,
} from "./testing/box-authority.js";
import { PAIR_STORE } from "./testing/pair-bundle.js";

vi.mock("node:fs/promises", { spy: true });

// The fetcher only JSON-round-trips it, so the content is immaterial.
const SAMPLE_BUNDLE: MirrorBundle = {
  designated: {
    nodeId: "44444444-4444-4444-4444-444444444444",
  },
  tenant: { country: "ES", taxId: "B00000000" },
  primaryNode: { name: "Caja 1", filingModule: "fiscal-verifactu", taxModule: null },
  environment: "preproduction",
  boxHostname: "waitron.local",
  boxCaPem: "-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n",
  primaryUrl: "https://box-4444.waitron.local",
  store: PAIR_STORE,
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
  backupSettings: null,
  boxCaKeyPem: "-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n",
};

const CREDENTIAL: AdoptCredential = {
  email: "owner@example.test",
  password: "correct-horse-battery",
};

const STANDBY = {
  nodeId: "55555555-5555-5555-5555-555555555555",
  publicKey: "STANDBY_PUB",
  contactUrl: "https://cloud.deli.test",
  storeUrl: "https://cloud.deli.test:7443",
  at: 1_800_000_000_000,
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
  it("fetches a designated node and venue with no cached invoice series", async () => {
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
        standbyStoreUrl: STANDBY.storeUrl,
        standbyAt: STANDBY.at,
      }),
    });
  });

  it("accepts a bundle carrying the main box's backup settings", async () => {
    const withSettings: MirrorBundle = {
      ...SAMPLE_BUNDLE,
      backupSettings: { WAITRON_BACKUP_RECOVERY_KEY: "recovery-0123456789abcdef" },
    };
    const app = new Hono();
    app.post("/management-api/mirror-bundle", (c: Context) => c.json(withSettings));
    const base = await startServer(app);

    expect(await fetchMirrorBundle(base, CREDENTIAL, STANDBY)).toEqual(withSettings);
  });

  it.each([
    ["name anything but a WAITRON_BACKUP_ setting", { WAITRON_CREDENTIALS_KEY: "x" }],
    ["hold a tab", { WAITRON_BACKUP_RECOVERY_KEY: "recovery\t0123456789" }],
  ])("refuses a bundle whose backup settings %s", async (_shape, backupSettings) => {
    const app = new Hono();
    app.post("/management-api/mirror-bundle", (c: Context) =>
      c.json({ ...SAMPLE_BUNDLE, backupSettings }),
    );
    const base = await startServer(app);

    const error = await fetchMirrorBundle(base, CREDENTIAL, STANDBY).catch((e: unknown) => e);
    expect(isAppError(error) && hasCode(error, "mirror.bundle_fetch_failed")).toBe(true);
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

  async function refusalFor(body: unknown): Promise<unknown> {
    const app = new Hono();
    app.post("/management-api/mirror-bundle", (c: Context) => c.json(body, 409));
    const base = await startServer(app);
    return fetchMirrorBundle(base, CREDENTIAL, STANDBY).catch((e: unknown) => e);
  }

  it.each([
    "mirror.bucket_stream_active",
    "mirror.standby_name_taken",
    "mirror.spare_already_joined",
  ])("passes on %s, carrying none of its parameters", async (code) => {
    const error = await refusalFor({
      error: { code, params: { detail: "https://primary.internal" } },
    });
    expect(isAppError(error) && error.code).toBe(code);
    expect(isAppError(error) && error.params).toEqual({});
  });

  it("passes on backup.recovery_key_missing, carrying no parameters", async () => {
    const error = await refusalFor({
      error: {
        code: "backup.recovery_key_missing",
        params: { detail: "https://primary.internal" },
      },
    });
    expect(isAppError(error) && error.code).toBe("backup.recovery_key_missing");
    expect(isAppError(error) && error.params).toEqual({});
  });

  it("passes on mirror.clocks_apart with its two times only, and not with a time that is not one", async () => {
    const primaryAt = "2026-11-10T12:00:00.000Z";
    const standbyAt = "2026-11-10T12:05:00.000Z";
    const relayed = await refusalFor({
      error: {
        code: "mirror.clocks_apart",
        params: { primaryAt, standbyAt, detail: "https://primary.internal" },
      },
    });
    expect(isAppError(relayed) && relayed.code).toBe("mirror.clocks_apart");
    expect(isAppError(relayed) && relayed.params).toEqual({ primaryAt, standbyAt });

    for (const params of [
      { primaryAt, standbyAt: "https://primary.internal" },
      { primaryAt: "2026-11-10", standbyAt },
      { primaryAt, standbyAt: Date.parse(standbyAt) },
      { primaryAt },
    ]) {
      const error = await refusalFor({ error: { code: "mirror.clocks_apart", params } });
      expect(isAppError(error) && error.code).toBe("mirror.bundle_fetch_failed");
      expect(isAppError(error) && error.params).toEqual({});
    }
  });

  it("passes on password.throttled with its whole-second wait only, and not with a wait that is not one", async () => {
    const relayed = await refusalFor({
      error: {
        code: "password.throttled",
        params: { retryAfterSeconds: 2, detail: "https://primary.internal" },
      },
    });
    expect(isAppError(relayed) && relayed.code).toBe("password.throttled");
    expect(isAppError(relayed) && relayed.params).toEqual({ retryAfterSeconds: 2 });

    for (const params of [
      { retryAfterSeconds: "2" },
      { retryAfterSeconds: 0 },
      { retryAfterSeconds: -1 },
      { retryAfterSeconds: 1.5 },
      {},
    ]) {
      const error = await refusalFor({ error: { code: "password.throttled", params } });
      expect(isAppError(error) && error.code).toBe("mirror.bundle_fetch_failed");
      expect(isAppError(error) && error.params).toEqual({});
    }
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
    ["no main box address", { ...SAMPLE_BUNDLE, primaryUrl: undefined }],
    ["no pair key", { ...SAMPLE_BUNDLE, store: undefined }],
    ["a null pair key", { ...SAMPLE_BUNDLE, store: null }],
    [
      "a pair key with no secret",
      { ...SAMPLE_BUNDLE, store: { ...SAMPLE_BUNDLE.store, secretAccessKey: undefined } },
    ],
    [
      "a pair key with a numeric access key id",
      { ...SAMPLE_BUNDLE, store: { ...SAMPLE_BUNDLE.store, accessKeyId: 42 } },
    ],
    [
      "a pair key with no venue id",
      { ...SAMPLE_BUNDLE, store: { ...SAMPLE_BUNDLE.store, venueId: undefined } },
    ],
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

describe("boxExchange", () => {
  it("on a signal already stopped sends nothing and refuses at once", async () => {
    let asked = 0;
    const server = createHttpServer((req, res) => {
      asked++;
      req.resume();
      res.end("answered");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
      await expect(
        boxExchange(url, { method: "POST", trust: {}, signal: AbortSignal.abort(), body: "{}" }),
      ).rejects.toThrow("no answer in time");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(asked).toBe(0);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("a box named on the venue's network is found by asking it", () => {
  const NAME = "box-7f3a.waitron.local";
  const closers: (() => Promise<void>)[] = [];
  let named: BoxAuthority;
  let unnamed: BoxAuthority;

  beforeAll(async () => {
    [named, unnamed] = await Promise.all([mintBoxAuthority([NAME]), mintBoxAuthority()]);
  });

  afterEach(async () => {
    while (closers.length > 0) await closers.pop()!();
  });

  async function serve(authority: BoxAuthority): Promise<BoxServer> {
    const server = await startBoxServer(authority, () => ({ status: 200, body: "answered" }));
    closers.push(server.close);
    return server;
  }

  const portOf = (server: BoxServer) => new URL(server.url).port;
  const pinned = (authority: BoxAuthority) => ({ ca: authority.caPem, rejectUnauthorized: true });

  it("connects to the address the lookup gave and checks the certificate against the name", async () => {
    const box = await serve(named);
    const lookup = vi.fn(() => Promise.resolve({ addresses: ["127.0.0.1"], remembered: false }));

    const answer = await boxExchange(new URL(`https://${NAME}:${portOf(box)}/x`), {
      method: "GET",
      trust: pinned(named),
      signal: AbortSignal.timeout(5_000),
      lookup,
    });

    expect(answer).toEqual({ status: 200, text: "answered" });
    expect(lookup).toHaveBeenCalledWith(NAME, { fresh: false });
    expect(box.requests.map((r) => r.headers.host)).toEqual([`${NAME}:${portOf(box)}`]);
  });

  it("refuses a box under the same authority whose certificate does not carry the name", async () => {
    const box = await serve(unnamed);

    await expect(
      boxExchange(new URL(`https://${NAME}:${portOf(box)}/x`), {
        method: "GET",
        trust: pinned(unnamed),
        signal: AbortSignal.timeout(5_000),
        lookup: () => Promise.resolve({ addresses: ["127.0.0.1"], remembered: false }),
      }),
    ).rejects.toMatchObject({ code: "ERR_TLS_CERT_ALTNAME_INVALID" });
    expect(box.requests).toHaveLength(0);
  });

  it("a false first answer costs one connection, not the call", async () => {
    const box = await serve(named);
    // Nothing listens on the IPv6 loopback at this port: the box listens on 127.0.0.1 alone.
    const lookup = () => Promise.resolve({ addresses: ["::1", "127.0.0.1"], remembered: false });

    const answer = await boxExchange(new URL(`https://${NAME}:${portOf(box)}/x`), {
      method: "POST",
      trust: pinned(named),
      signal: AbortSignal.timeout(5_000),
      body: '{"once":true}',
      lookup,
    });

    expect(answer).toEqual({ status: 200, text: "answered" });
    expect(box.requests.map((r) => r.body)).toEqual(['{"once":true}']);
  });

  it("an answer whose certificate fails is passed over for the next one", async () => {
    const wrong = await serve(unnamed);
    const right = await serve(named);
    const otherPort = Number(portOf(right));
    // The two boxes listen on different ports; the call names one, so the first answer is made to
    // reach the wrong box by giving it the right box's port through a forwarding listener.
    const forward = createTcpServer((socket) => {
      const onward = createConnection(Number(portOf(wrong)), "127.0.0.1");
      socket.pipe(onward).pipe(socket);
      socket.on("error", () => onward.destroy());
      onward.on("error", () => socket.destroy());
    });
    await new Promise<void>((resolve) => forward.listen(otherPort, "::1", resolve));
    closers.push(() => new Promise<void>((resolve) => forward.close(() => resolve())));

    const answer = await boxExchange(new URL(`https://${NAME}:${otherPort}/x`), {
      method: "GET",
      trust: { ca: [named.caPem, unnamed.caPem], rejectUnauthorized: true },
      signal: AbortSignal.timeout(5_000),
      lookup: () => Promise.resolve({ addresses: ["::1", "127.0.0.1"], remembered: false }),
    });

    expect(answer).toEqual({ status: 200, text: "answered" });
    expect(wrong.requests).toHaveLength(0);
    expect(right.requests).toHaveLength(1);
  });

  it("refuses with the last address's failure when no answer completes the handshake", async () => {
    const box = await serve(unnamed);
    // Nothing listens on the IPv6 loopback at this port, so that address is refused outright, while
    // 127.0.0.1 fails its certificate: the two failures differ.
    const call = (addresses: string[]) =>
      boxExchange(new URL(`https://${NAME}:${portOf(box)}/x`), {
        method: "GET",
        trust: pinned(unnamed),
        signal: AbortSignal.timeout(5_000),
        lookup: () => Promise.resolve({ addresses, remembered: false }),
      });

    await expect(call(["::1", "127.0.0.1"])).rejects.toMatchObject({
      code: "ERR_TLS_CERT_ALTNAME_INVALID",
    });
    await expect(call(["127.0.0.1", "::1"])).rejects.toMatchObject({ code: "ECONNREFUSED" });
    expect(box.requests).toHaveLength(0);
  });

  /** Listens on the IPv6 loopback at `port`, beside a box on 127.0.0.1 at the same port. */
  async function onIpv6Loopback(server: NetServer, port: number): Promise<void> {
    const sockets = new Set<Socket>();
    server.on("connection", (socket: Socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(port, "::1", resolve));
    closers.push(
      () =>
        new Promise<void>((resolve) => {
          for (const socket of sockets) socket.destroy();
          server.close(() => resolve());
        }),
    );
  }

  it("a request whose connection finished goes to no other address, even when its answer is cut short", async () => {
    const box = await serve(named);
    let reached = 0;
    const cutShort = createTlsServer({ key: named.keyPem, cert: named.certPem }, (socket) => {
      socket.once("data", () => {
        reached++;
        socket.end("HTTP/1.1 200 OK\r\ncontent-type: appl");
      });
    });
    await onIpv6Loopback(cutShort, Number(portOf(box)));
    const lookup = vi.fn<BoxLookup>(() =>
      Promise.resolve({ addresses: ["::1", "127.0.0.1"], remembered: true }),
    );

    await expect(
      boxExchange(new URL(`https://${NAME}:${portOf(box)}/x`), {
        method: "POST",
        trust: pinned(named),
        signal: AbortSignal.timeout(5_000),
        body: '{"once":true}',
        lookup,
      }),
    ).rejects.toMatchObject({ code: "ECONNRESET" });
    expect(reached).toBe(1);
    expect(box.requests).toHaveLength(0);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  /** A lookup that hands out `kept` as remembered, and `heard` (or its refusal) when asked afresh. */
  function rememberedThen(kept: string[], heard: string[] | Error | "never") {
    const asks: boolean[] = [];
    let markFreshAsk = () => {};
    const freshAsked = new Promise<void>((resolve) => (markFreshAsk = resolve));
    const lookup: BoxLookup = (_, { fresh }) => {
      asks.push(fresh);
      if (!fresh) return Promise.resolve({ addresses: kept, remembered: true });
      markFreshAsk();
      if (heard === "never") return new Promise<BoxAddresses>(() => {});
      if (heard instanceof Error) return Promise.reject(heard);
      return Promise.resolve({ addresses: heard, remembered: false });
    };
    return { lookup, asks, freshAsked };
  }

  it("when no remembered address takes the call, the network is asked once more and its answer used", async () => {
    const box = await serve(named);
    const net = rememberedThen(["::1"], ["127.0.0.1"]);

    const answer = await boxExchange(new URL(`https://${NAME}:${portOf(box)}/x`), {
      method: "POST",
      trust: pinned(named),
      signal: AbortSignal.timeout(5_000),
      body: '{"once":true}',
      lookup: net.lookup,
    });

    expect(answer).toEqual({ status: 200, text: "answered" });
    expect(box.requests.map((r) => r.body)).toEqual(['{"once":true}']);
    expect(net.asks).toEqual([false, true]);
  });

  it("the answer asked for afresh is the last: when no address takes the call either, it fails", async () => {
    const box = await serve(named);
    const net = rememberedThen(["::1"], ["::1"]);

    await expect(
      boxExchange(new URL(`https://${NAME}:${portOf(box)}/x`), {
        method: "GET",
        trust: pinned(named),
        signal: AbortSignal.timeout(5_000),
        lookup: net.lookup,
      }),
    ).rejects.toMatchObject({ code: "ECONNREFUSED" });
    expect(net.asks).toEqual([false, true]);
    expect(box.requests).toHaveLength(0);
  });

  it("a name nobody answers for when asked afresh is the lookup's refusal", async () => {
    const box = await serve(named);
    const refused = new AppError("mirror.peer_unresolved", {});
    const net = rememberedThen(["::1"], refused);

    await expect(
      boxExchange(new URL(`https://${NAME}:${portOf(box)}/x`), {
        method: "GET",
        trust: pinned(named),
        signal: AbortSignal.timeout(5_000),
        lookup: net.lookup,
      }),
    ).rejects.toBe(refused);
    expect(net.asks).toEqual([false, true]);
  });

  it("a stop while the name is asked afresh ends the call without waiting for the answer", async () => {
    const box = await serve(named);
    const net = rememberedThen(["::1"], "never");
    const stopping = new AbortController();

    const call = boxExchange(new URL(`https://${NAME}:${portOf(box)}/x`), {
      method: "GET",
      trust: pinned(named),
      signal: stopping.signal,
      lookup: net.lookup,
    });
    await net.freshAsked;
    stopping.abort();

    await expect(call).rejects.toThrow("no answer in time");
  });

  it("an answer just heard that no address takes is the call's failure, without asking again", async () => {
    const box = await serve(named);
    const lookup = vi.fn<BoxLookup>(() =>
      Promise.resolve({ addresses: ["::1"], remembered: false }),
    );

    await expect(
      boxExchange(new URL(`https://${NAME}:${portOf(box)}/x`), {
        method: "GET",
        trust: pinned(named),
        signal: AbortSignal.timeout(5_000),
        lookup,
      }),
    ).rejects.toMatchObject({ code: "ECONNREFUSED" });
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  describe("an address that does not finish its handshake", () => {
    /** Accepts connections on the IPv6 loopback at `port` and never sends a byte. */
    async function silentAt(port: number): Promise<{ connected: Promise<void> }> {
      let markConnected = () => {};
      const connected = new Promise<void>((resolve) => (markConnected = resolve));
      await onIpv6Loopback(
        createTcpServer(() => markConnected()),
        port,
      );
      return { connected };
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it("is passed over after two seconds when another address follows", async () => {
      const box = await serve(named);
      const silent = await silentAt(Number(portOf(box)));
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

      const call = boxExchange(new URL(`https://${NAME}:${portOf(box)}/x`), {
        method: "GET",
        trust: pinned(named),
        signal: AbortSignal.timeout(5_000),
        lookup: () => Promise.resolve({ addresses: ["::1", "127.0.0.1"], remembered: false }),
      });
      await silent.connected;
      await vi.advanceTimersByTimeAsync(1_999);
      expect(box.requests).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);

      await expect(call).resolves.toEqual({ status: 200, text: "answered" });
    });

    it("is passed over after two seconds when it was remembered, for the network's fresh answer", async () => {
      const box = await serve(named);
      const silent = await silentAt(Number(portOf(box)));
      const net = rememberedThen(["::1"], ["127.0.0.1"]);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

      const call = boxExchange(new URL(`https://${NAME}:${portOf(box)}/x`), {
        method: "GET",
        trust: pinned(named),
        signal: AbortSignal.timeout(5_000),
        lookup: net.lookup,
      });
      await silent.connected;
      await vi.advanceTimersByTimeAsync(2_000);

      await expect(call).resolves.toEqual({ status: 200, text: "answered" });
      expect(net.asks).toEqual([false, true]);
    });

    it("is waited for until the call's own limit when it is the last address to try", async () => {
      const box = await serve(named);
      let release = () => {};
      const released = new Promise<void>((resolve) => (release = resolve));
      let markHeld = () => {};
      const held = new Promise<void>((resolve) => (markHeld = resolve));
      // Holds each connection, passing nothing on, until released; then joins it to the box.
      const slow = createTcpServer((socket) => {
        socket.pause();
        markHeld();
        void released.then(() => {
          const onward = createConnection(Number(portOf(box)), "127.0.0.1");
          socket.on("error", () => onward.destroy());
          onward.on("error", () => socket.destroy());
          socket.pipe(onward).pipe(socket);
          socket.resume();
        });
      });
      await onIpv6Loopback(slow, Number(portOf(box)));
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

      const call = boxExchange(new URL(`https://${NAME}:${portOf(box)}/x`), {
        method: "GET",
        trust: pinned(named),
        signal: AbortSignal.timeout(5_000),
        lookup: () => Promise.resolve({ addresses: ["::1"], remembered: false }),
      });
      await held;
      await vi.advanceTimersByTimeAsync(10_000);
      release();

      await expect(call).resolves.toEqual({ status: 200, text: "answered" });
    });
  });

  it("a final copy is asked for at the address the lookup gave", async () => {
    const refusal = '{"error":{"code":"handover.not_ready"}}';
    const box = await startBoxServer(named, () => ({ status: 409, body: refusal }));
    closers.push(box.close);
    const folder = await mkdtemp(join(tmpdir(), "waitron-box-lookup-"));
    closers.push(() => rm(folder, { recursive: true, force: true }));

    const answer = await boxDownload(
      new URL(`https://${NAME}:${portOf(box)}/copy`),
      {
        trust: pinned(named),
        signal: AbortSignal.timeout(5_000),
        body: "{}",
        lookup: () => Promise.resolve({ addresses: ["::1", "127.0.0.1"], remembered: false }),
      },
      join(folder, "received.db"),
    );

    expect(answer).toEqual({ status: 409, text: refusal });
    expect(box.requests).toHaveLength(1);
  });

  it("a stop while the name is being asked ends the call without waiting for the answer", async () => {
    const stopping = new AbortController();
    let markAsked = () => {};
    const asked = new Promise<void>((resolve) => (markAsked = resolve));
    const call = boxExchange(new URL(`https://${NAME}/x`), {
      method: "GET",
      trust: pinned(named),
      signal: stopping.signal,
      lookup: () => {
        markAsked();
        return new Promise<BoxAddresses>(() => {});
      },
    });
    await asked;
    stopping.abort();
    await expect(call).rejects.toThrow("no answer in time");
  });

  it("an unanswered name is the lookup's refusal, sent to no address", async () => {
    const refused = new AppError("mirror.peer_unresolved", {});
    await expect(
      boxExchange(new URL(`https://${NAME}/x`), {
        method: "GET",
        trust: pinned(named),
        signal: AbortSignal.timeout(5_000),
        lookup: () => Promise.reject(refused),
      }),
    ).rejects.toBe(refused);
  });

  describe("the address this box last reached the other box at under its pinned authority", () => {
    const refused = () => Promise.reject(new AppError("mirror.peer_unresolved", {}));
    const fresh = (...addresses: string[]) => ({ addresses, remembered: false });
    const switchOff = async (box: BoxServer) => {
      closers.splice(closers.indexOf(box.close), 1);
      await box.close();
    };

    /** One GET to `box`'s port under `trust`, remembering checked addresses in `checked`. */
    const call = (
      box: BoxServer | string,
      checked: CheckedAddresses,
      lookup: BoxLookup,
      trust: { ca?: string; rejectUnauthorized: boolean } = pinned(named),
      timeoutMs = 5_000,
    ) =>
      boxExchange(new URL(`https://${NAME}:${typeof box === "string" ? box : portOf(box)}/x`), {
        method: "GET",
        trust,
        signal: AbortSignal.timeout(timeoutMs),
        lookup,
        checked,
      });
    const failureOf = (promise: Promise<unknown>) =>
      promise.then(
        () => undefined,
        (error: unknown) => error,
      );

    it("is tried first next time, before the network is asked", async () => {
      const box = await serve(named);
      const checked = new CheckedAddresses();
      await call(box, checked, () => Promise.resolve(fresh("127.0.0.1")));
      const lookup = vi.fn<BoxLookup>(() => Promise.resolve(fresh("::1")));

      await expect(call(box, checked, lookup)).resolves.toEqual({
        status: 200,
        text: "answered",
      });
      expect(lookup).not.toHaveBeenCalled();
      expect(box.requests).toHaveLength(2);
    });

    it("is tried when nobody answers for the name, and its failure says so", async () => {
      const box = await serve(named);
      const checked = new CheckedAddresses();
      await call(box, checked, () => Promise.resolve(fresh("127.0.0.1")));
      const port = portOf(box);
      await switchOff(box);

      const failure = await failureOf(call(port, checked, refused));
      expect(failure).toBeInstanceOf(CheckedAddressUnreached);
    });

    it("its failure, then a claimed address that refuses too, still says the checked address was not reached", async () => {
      const box = await serve(named);
      const checked = new CheckedAddresses();
      await call(box, checked, () => Promise.resolve(fresh("127.0.0.1")));
      const port = portOf(box);
      await switchOff(box);
      const lookup = vi.fn<BoxLookup>(() => Promise.resolve(fresh("::1")));

      expect(await failureOf(call(port, checked, lookup))).toBeInstanceOf(CheckedAddressUnreached);
      expect(lookup).toHaveBeenCalled();
    });

    it("its failure does not count when a claimed address accepted the connection", async () => {
      const box = await serve(named);
      const checked = new CheckedAddresses();
      await call(box, checked, () => Promise.resolve(fresh("127.0.0.1")));
      const port = portOf(box);
      await switchOff(box);
      let accepted = 0;
      await onIpv6Loopback(
        createTcpServer(() => accepted++),
        Number(port),
      );

      const failure = await failureOf(
        call(port, checked, () => Promise.resolve(fresh("::1")), pinned(named), 500),
      );
      expect(accepted).toBe(1);
      expect(failure).toBeDefined();
      expect(failure).not.toBeInstanceOf(CheckedAddressUnreached);
    });

    it("a failure with no checked address remembered never says one was not reached", async () => {
      const box = await serve(named);
      const port = portOf(box);
      await switchOff(box);

      for (const lookup of [refused, () => Promise.resolve(fresh("127.0.0.1"))]) {
        const failure = await failureOf(call(port, new CheckedAddresses(), lookup));
        expect(failure).toBeDefined();
        expect(failure).not.toBeInstanceOf(CheckedAddressUnreached);
      }
    });

    it("is not taken from a connection whose certificate the pinned authority refused", async () => {
      const nameless = await serve(unnamed);
      const port = portOf(nameless);
      const checked = new CheckedAddresses();
      await expect(
        call(nameless, checked, () => Promise.resolve(fresh("127.0.0.1")), pinned(unnamed)),
      ).rejects.toMatchObject({ code: "ERR_TLS_CERT_ALTNAME_INVALID" });
      await switchOff(nameless);

      const failure = await failureOf(call(port, checked, refused, pinned(unnamed)));
      expect(failure).not.toBeInstanceOf(CheckedAddressUnreached);
      expect(failure).toMatchObject({ code: "mirror.peer_unresolved" });
    });

    it("counts only under the authority that checked it", async () => {
      const box = await serve(named);
      const checked = new CheckedAddresses();
      await call(box, checked, () => Promise.resolve(fresh("127.0.0.1")));
      const port = portOf(box);
      await switchOff(box);

      expect(await failureOf(call(port, checked, refused, pinned(unnamed)))).toMatchObject({
        code: "mirror.peer_unresolved",
      });
      expect(await failureOf(call(port, checked, refused))).toBeInstanceOf(CheckedAddressUnreached);
    });

    it.each([
      ["no authority", () => ({ rejectUnauthorized: false })],
      ["an authority it does not insist on", (ca: string) => ({ ca, rejectUnauthorized: false })],
    ])("is never kept by a call under %s", async (_label, trustIn) => {
      const box = await serve(named);
      const checked = new CheckedAddresses();
      const unchecked = trustIn(named.caPem);
      await call(box, checked, () => Promise.resolve(fresh("127.0.0.1")), unchecked);
      const port = portOf(box);
      await switchOff(box);

      const failure = await failureOf(call(port, checked, refused, unchecked));
      expect(failure).toMatchObject({ code: "mirror.peer_unresolved" });
    });

    it("is not used by a call that checks no certificate", async () => {
      const box = await serve(named);
      const checked = new CheckedAddresses();
      await call(box, checked, () => Promise.resolve(fresh("127.0.0.1")));
      const port = portOf(box);
      await switchOff(box);

      const failure = await failureOf(call(port, checked, refused, { rejectUnauthorized: false }));
      expect(failure).toMatchObject({ code: "mirror.peer_unresolved" });
    });

    it("is passed over for a duplicate the network answers with", async () => {
      const box = await serve(named);
      const checked = new CheckedAddresses();
      await call(box, checked, () => Promise.resolve(fresh("127.0.0.1")));
      const port = portOf(box);
      await switchOff(box);
      let tried = 0;
      const counting = createTcpServer((socket) => {
        tried++;
        socket.destroy();
      });
      await new Promise<void>((resolve) => counting.listen(Number(port), "127.0.0.1", resolve));
      closers.push(() => new Promise<void>((resolve) => counting.close(() => resolve())));
      // The remembered address drops each connection; the network then claims it again, then ::1.
      await failureOf(call(port, checked, () => Promise.resolve(fresh("127.0.0.1", "::1"))));
      expect(tried).toBe(1);
    });

    describe("kept in the state folder", () => {
      let stateDir: string;
      beforeEach(async () => {
        stateDir = await mkdtemp(join(tmpdir(), "waitron-checked-"));
        closers.push(() => rm(stateDir, { recursive: true, force: true }));
      });
      const loaded = async (onWriteFailed: (error: unknown) => void = () => {}) => {
        const checked = new CheckedAddresses();
        await checked.rememberIn(stateDir, onWriteFailed);
        return checked;
      };
      const stored = () => join(stateDir, CHECKED_ADDRESSES_FILE);

      it("is recalled after a restart, and a call to it that reaches nothing says so", async () => {
        const box = await serve(named);
        const before = await loaded();
        await call(box, before, () => Promise.resolve(fresh("127.0.0.1")));
        await before.written();
        const port = portOf(box);
        await switchOff(box);

        const failure = await failureOf(call(port, await loaded(), refused));
        expect(failure).toBeInstanceOf(CheckedAddressUnreached);
      });

      it("holds no authority's certificate", async () => {
        const box = await serve(named);
        const checked = await loaded();
        await call(box, checked, () => Promise.resolve(fresh("127.0.0.1")));
        await checked.written();

        const text = await readFile(stored(), "utf8");
        expect(text).toContain("127.0.0.1");
        expect(text).not.toContain("BEGIN CERTIFICATE");
      });

      it("is written again only when the address changes", async () => {
        const checked = await loaded();
        checked.keep("box", "127.0.0.1");
        await checked.written();
        const first = (await stat(stored())).ino;

        checked.keep("box", "127.0.0.1");
        await checked.written();
        expect((await stat(stored())).ino).toBe(first);

        checked.keep("box", "::1");
        await checked.written();
        expect((await stat(stored())).ino).not.toBe(first);
        expect((await loaded()).recall("box")).toBe("::1");
      });

      it("keeps the latest of two quick changes", async () => {
        const checked = await loaded();
        checked.keep("box", "127.0.0.1");
        checked.keep("box", "::1");
        await checked.written();

        expect((await loaded()).recall("box")).toBe("::1");
      });

      const digest = createHash("sha256").update("box").digest("hex");
      it.each([
        ["not JSON", "{not json"],
        ["a non-text address", JSON.stringify({ [digest]: 5 })],
      ])("loads as empty from a file that is %s", async (_label, text) => {
        await writeFile(stored(), text);
        const checked = await loaded();

        expect(checked.recall("box")).toBeUndefined();
      });

      it("a failed write is reported and the address still holds in memory", async () => {
        const gone = join(stateDir, "gone");
        const failures: unknown[] = [];
        const checked = new CheckedAddresses();
        await checked.rememberIn(gone, (error) => failures.push(error));

        checked.keep("box", "127.0.0.1");
        await checked.written();
        expect(failures).toHaveLength(1);
        expect(checked.recall("box")).toBe("127.0.0.1");
      });

      it("a write that failed is made again when the same address is next kept", async () => {
        const failures: unknown[] = [];
        const checked = await loaded((error) => failures.push(error));
        checked.keep("box", "127.0.0.1");
        await checked.written();
        const away = `${stateDir}-away`;
        await fs.rename(stateDir, away);
        checked.keep("box", "127.0.0.2");
        await checked.written();
        await fs.rename(away, stateDir);
        expect(failures).toHaveLength(1);
        // The control: the failed write left the earlier address in the file.
        expect((await loaded()).recall("box")).toBe("127.0.0.1");

        checked.keep("box", "127.0.0.2");
        await checked.written();
        expect((await loaded()).recall("box")).toBe("127.0.0.2");
        const repaired = (await stat(stored())).ino;
        checked.keep("box", "127.0.0.2");
        await checked.written();
        expect((await stat(stored())).ino).toBe(repaired);
      });

      it("a failure reporter that throws leaves later writes to go ahead", async () => {
        const later = join(stateDir, "later");
        const checked = new CheckedAddresses();
        await checked.rememberIn(later, () => {
          throw new Error("reporter failed");
        });
        checked.keep("box", "127.0.0.1");
        await expect(checked.written()).resolves.toBeUndefined();

        await mkdir(later);
        checked.keep("box", "::1");
        await expect(checked.written()).resolves.toBeUndefined();
        const after = new CheckedAddresses();
        await after.rememberIn(later, () => {});
        expect(after.recall("box")).toBe("::1");
      });

      it("once let go, writes nothing more to the folder, after the writes already asked for", async () => {
        const checked = new CheckedAddresses();
        const letGo = await checked.rememberIn(stateDir, () => {});
        checked.keep("box", "127.0.0.1");
        await letGo();
        expect((await loaded()).recall("box")).toBe("127.0.0.1");

        checked.keep("box", "::1");
        await checked.written();
        expect(checked.recall("box")).toBe("::1");
        expect((await loaded()).recall("box")).toBe("127.0.0.1");
      });

      it("a write asked for before it moved to another folder holds only the first folder's addresses", async () => {
        const newer = await mkdtemp(join(tmpdir(), "waitron-checked-newer-"));
        closers.push(() => rm(newer, { recursive: true, force: true }));
        const other = new CheckedAddresses();
        await other.rememberIn(newer, () => {});
        other.keep("other box", "10.0.0.9");
        await other.written();
        const real = await vi.importActual<typeof fs>("node:fs/promises");
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        vi.mocked(fs.rename).mockImplementationOnce(async (from, to) => {
          await held;
          return real.rename(from, to);
        });
        try {
          const checked = await loaded();
          checked.keep("box", "127.0.0.1");
          checked.keep("box", "::1");
          await checked.rememberIn(newer, () => {});
          release();
          await checked.written();
        } finally {
          vi.mocked(fs.rename).mockReset();
        }

        const first = await loaded();
        expect(first.recall("box")).toBe("::1");
        expect(first.recall("other box")).toBeUndefined();
      });

      it("letting go of a folder it has moved on from leaves the newer folder written", async () => {
        const newer = await mkdtemp(join(tmpdir(), "waitron-checked-newer-"));
        closers.push(() => rm(newer, { recursive: true, force: true }));
        const checked = new CheckedAddresses();
        const letGoOfFirst = await checked.rememberIn(stateDir, () => {});
        await checked.rememberIn(newer, () => {});
        await letGoOfFirst();

        checked.keep("box", "::1");
        await checked.written();
        const after = new CheckedAddresses();
        await after.rememberIn(newer, () => {});
        expect(after.recall("box")).toBe("::1");
      });
    });
  });

  const lanAddress = Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry?.family === "IPv4" && !entry.internal)?.address;

  // Needs an address other than loopback, which the lookup never takes as another box's.
  it.skipIf(lanAddress === undefined && process.env.CI === undefined)(
    "the setup app's certificate read by https://waitron.local reaches the other box, not this one",
    async () => {
      if (lanAddress === undefined) throw new Error("no non-loopback IPv4 address on this machine");
      const other = unnamed;
      const self = named;
      const listenAt = async (authority: BoxAuthority, host: string, port: number) => {
        const server = createHttpsServer(
          { key: authority.keyPem, cert: authority.certPem },
          (_, res) => res.end(authority.caPem),
        );
        await new Promise<void>((resolve) => server.listen(port, host, resolve));
        closers.push(
          () =>
            new Promise<void>((resolve) => {
              server.closeAllConnections();
              server.close(() => resolve());
            }),
        );
        return (server.address() as AddressInfo).port;
      };
      const port = await listenAt(other, lanAddress, 0);
      await listenAt(self, "127.0.0.1", port);
      const handlers: { response?: (r: { answers: unknown[] }) => void } = {};
      const socket = {
        on(event: string, handler: never) {
          if (event === "response") handlers.response = handler;
        },
        query() {
          queueMicrotask(() =>
            handlers.response?.({
              answers: [
                { name: "waitron.local", type: "A", data: "127.0.0.1" },
                { name: "waitron.local", type: "A", data: lanAddress },
              ],
            }),
          );
        },
        destroy(cb?: () => void) {
          cb?.();
        },
      } as MdnsQuerySocket;

      const read = await fetchPrimaryCertificate(`https://waitron.local:${port}`, {
        lookup: (hostname) =>
          lookupBoxName(hostname, {
            timeoutMs: 20,
            makeSocket: () => socket,
            ownAddresses: () => ["127.0.0.1"],
          }),
      });

      expect(read?.fingerprint256).toBe(new X509Certificate(other.caPem).fingerprint256);
    },
  );
});

describe("boxDownload streams one answer to a file", () => {
  const BYTES = Buffer.from(Array.from({ length: 70_000 }, (_, i) => i % 256));
  let folder: string;
  let destination: string;
  let partial: string;
  const closers: (() => Promise<void>)[] = [];

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "waitron-box-download-"));
    destination = join(folder, "received.db");
    partial = `${destination}.partial`;
  });

  afterEach(async () => {
    while (closers.length > 0) await closers.pop()!();
    await rm(folder, { recursive: true, force: true });
  });

  /** A plain-http box whose answer is whatever `handle` writes, so it can stop part way. */
  async function httpBox(handle: (res: ServerResponse) => void): Promise<URL> {
    const server = createHttpServer((req, res) => {
      req.resume();
      req.on("end", () => handle(res));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closers.push(
      () =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((err) => (err ? reject(err) : resolve()));
        }),
    );
    return new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/copy`);
  }

  /** A box that writes `raw` as its whole answer and hangs up, the way no real server would. */
  async function rawBox(raw: string): Promise<URL> {
    const server = createTcpServer((socket) => {
      socket.once("data", () => socket.end(raw));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closers.push(
      () =>
        new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
    );
    return new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/copy`);
  }

  function options(signal: AbortSignal = AbortSignal.timeout(5_000)) {
    return { trust: { rejectUnauthorized: true }, signal, body: '{"signed":true}' };
  }

  it("a box silent before its answer is given up on within the silence limit", async () => {
    const url = await httpBox(() => {});
    await expect(
      boxDownload(url, { ...options(), silenceLimitMs: 100 }, destination),
    ).rejects.toThrow("no bytes in time");
    expect(existsSync(partial)).toBe(false);
  });

  it("a box silent part way through its answer is given up on, with neither file left", async () => {
    const url = await httpBox((res) => {
      res.writeHead(200, { "content-length": String(BYTES.length) });
      res.write(BYTES.subarray(0, 100));
    });
    await expect(
      boxDownload(url, { ...options(), silenceLimitMs: 100 }, destination),
    ).rejects.toThrow();
    expect(existsSync(partial)).toBe(false);
    expect(existsSync(destination)).toBe(false);
  });

  it("an answer taking far longer than the silence limit lands whole while its bytes keep coming", async () => {
    const url = await httpBox((res) => {
      res.writeHead(200, { "content-length": "20" });
      let sent = 0;
      const timer = setInterval(() => {
        res.write("x");
        if (++sent === 20) {
          clearInterval(timer);
          res.end();
        }
      }, 25);
    });
    const answer = await boxDownload(url, { ...options(), silenceLimitMs: 200 }, destination);
    expect(answer.status).toBe(200);
    expect(statSync(destination).size).toBe(20);
  });

  it("a whole answer from a box under the pinned authority lands byte for byte, and its body was sent", async () => {
    const authority = await mintBoxAuthority();
    const seen: { method?: string; url?: string; type?: string; body: string }[] = [];
    const server = createHttpsServer(
      { key: authority.keyPem, cert: authority.certPem },
      (req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          seen.push({
            method: req.method,
            url: req.url,
            type: req.headers["content-type"],
            body: Buffer.concat(chunks).toString("utf8"),
          });
          res.writeHead(200, { "content-length": String(BYTES.length) });
          res.end(BYTES);
        });
      },
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closers.push(
      () =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((err) => (err ? reject(err) : resolve()));
        }),
    );
    const answer = await boxDownload(
      new URL(`https://localhost:${(server.address() as AddressInfo).port}/copy`),
      {
        trust: { ca: authority.caPem, rejectUnauthorized: true },
        signal: AbortSignal.timeout(5_000),
        body: '{"signed":true}',
      },
      destination,
    );
    expect(answer).toEqual({ status: 200, text: "" });
    expect((await readFile(destination)).equals(BYTES)).toBe(true);
    expect(existsSync(partial)).toBe(false);
    expect(seen).toEqual([
      { method: "POST", url: "/copy", type: "application/json", body: '{"signed":true}' },
    ]);
  });

  it("the answer the final-copy route gives, a declared stream through the real server, lands whole", async () => {
    const app = new Hono();
    app.post("/copy", (c) =>
      c.body(Readable.toWeb(Readable.from([BYTES])) as ReadableStream, 200, {
        "content-type": "application/octet-stream",
        "content-length": String(BYTES.length),
      }),
    );
    const base = await startServer(app);
    expect(await boxDownload(new URL(`${base}/copy`), options(), destination)).toEqual({
      status: 200,
      text: "",
    });
    expect((await readFile(destination)).equals(BYTES)).toBe(true);
  });

  it("a box under another authority gets no request and leaves no file", async () => {
    const box = await startBoxServer(await mintBoxAuthority(), () => ({ status: 200, body: "x" }));
    closers.push(box.close);
    const other = await mintBoxAuthority();
    await expect(
      boxDownload(
        new URL(`${box.url}/copy`),
        {
          trust: { ca: other.caPem, rejectUnauthorized: true },
          signal: AbortSignal.timeout(5_000),
          body: "{}",
        },
        destination,
      ),
    ).rejects.toThrow();
    expect(box.requests).toEqual([]);
    expect(await existingFiles()).toEqual([]);
  });

  async function existingFiles(): Promise<string[]> {
    return [destination, partial].filter((path) => existsSync(path));
  }

  it("the bytes go to the partial file as they arrive, and the destination appears only at the end", async () => {
    let answer: ServerResponse | undefined;
    const url = await httpBox((res) => {
      res.writeHead(200, { "content-length": String(BYTES.length) });
      res.write(BYTES.subarray(0, 1_000));
      answer = res;
    });
    const download = boxDownload(url, options(), destination);
    await vi.waitFor(async () => {
      expect((await readFile(partial)).length).toBe(1_000);
    });
    expect(existsSync(destination)).toBe(false);
    answer!.end(BYTES.subarray(1_000));
    expect(await download).toEqual({ status: 200, text: "" });
    expect((await readFile(destination)).equals(BYTES)).toBe(true);
    expect(existsSync(partial)).toBe(false);
  });

  it("a connection lost before the declared length is a failure, with neither file left", async () => {
    const url = await httpBox((res) => {
      res.writeHead(200, { "content-length": String(BYTES.length) });
      res.write(BYTES.subarray(0, 1_000), () => res.destroy());
    });
    await expect(boxDownload(url, options(), destination)).rejects.toThrow();
    expect(await existingFiles()).toEqual([]);
  });

  it("an answer that declares no length is a failure, since its end cannot be told from a lost connection", async () => {
    const url = await rawBox("HTTP/1.1 200 OK\r\nconnection: close\r\n\r\npart of a file");
    await expect(boxDownload(url, options(), destination)).rejects.toThrow("no length");
    expect(await existingFiles()).toEqual([]);
  });

  it("a stopped download is a failure, with neither file left", async () => {
    const url = await httpBox((res) => {
      res.writeHead(200, { "content-length": String(BYTES.length) });
      res.write(BYTES.subarray(0, 1_000));
    });
    const controller = new AbortController();
    const download = boxDownload(url, options(controller.signal), destination);
    await vi.waitFor(() => expect(existsSync(partial)).toBe(true));
    controller.abort();
    await expect(download).rejects.toThrow();
    expect(await existingFiles()).toEqual([]);
  });

  it("a download on a signal already stopped asks nothing and leaves no file", async () => {
    let asked = 0;
    const url = await httpBox((res) => {
      asked++;
      res.writeHead(200, { "content-length": String(BYTES.length) });
      res.end(BYTES);
    });
    await expect(boxDownload(url, options(AbortSignal.abort()), destination)).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(asked).toBe(0);
    expect(await existingFiles()).toEqual([]);
  });

  it("a box that never answers is given up on at the signal", async () => {
    const silent = await startSilentServer();
    closers.push(silent.close);
    await expect(
      boxDownload(
        new URL(`http://127.0.0.1:${silent.port}/copy`),
        options(AbortSignal.timeout(100)),
        destination,
      ),
    ).rejects.toThrow();
    expect(await existingFiles()).toEqual([]);
  });

  it("what an earlier attempt left in the partial file does not reach the destination", async () => {
    await writeFile(partial, Buffer.alloc(BYTES.length + 500, 0xee));
    const url = await httpBox((res) => {
      res.writeHead(200, { "content-length": String(BYTES.length) });
      res.end(BYTES);
    });
    await boxDownload(url, options(), destination);
    expect((await readFile(destination)).equals(BYTES)).toBe(true);
  });

  it("a refusal comes back with its status and words, and writes no file", async () => {
    const refusal = '{"error":{"code":"handover.not_stepped_down","params":{}}}';
    const url = await httpBox((res) => {
      res.writeHead(409, { "content-type": "application/json" });
      res.end(refusal);
    });
    expect(await boxDownload(url, options(), destination)).toEqual({ status: 409, text: refusal });
    expect(await existingFiles()).toEqual([]);
  });

  it("a refusal far too long to be one is a failure", async () => {
    const url = await httpBox((res) => {
      res.writeHead(500);
      res.end(Buffer.alloc(64 * 1024 + 1, 0x78));
    });
    await expect(boxDownload(url, options(), destination)).rejects.toThrow("too large");
    expect(await existingFiles()).toEqual([]);
  });

  it("a refusal of the longest allowed length is still read", async () => {
    const url = await httpBox((res) => {
      res.writeHead(500);
      res.end(Buffer.alloc(64 * 1024, 0x78));
    });
    const answer = await boxDownload(url, options(), destination);
    expect(answer.status).toBe(500);
    expect(answer.text.length).toBe(64 * 1024);
  });

  it("a destination that cannot be replaced is a failure, and the partial file is removed", async () => {
    await mkdir(join(destination, "in-the-way"), { recursive: true });
    const url = await httpBox((res) => {
      res.writeHead(200, { "content-length": String(BYTES.length) });
      res.end(BYTES);
    });
    await expect(boxDownload(url, options(), destination)).rejects.toThrow();
    expect(existsSync(partial)).toBe(false);
  });

  function wholeAnswer(): Promise<URL> {
    return httpBox((res) => {
      res.writeHead(200, { "content-length": String(BYTES.length) });
      res.end(BYTES);
    });
  }

  /** While `run` runs: each flush of an opened file (with its size then) or folder and each rename, in order. */
  async function flushesAndRenames(run: () => Promise<unknown>): Promise<string[]> {
    const events: string[] = [];
    const real = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.open).mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await real.open(...args);
      const flush = handle.sync.bind(handle);
      handle.sync = async () => {
        const now = await handle.stat();
        events.push(`flush ${String(args[0])}${now.isFile() ? ` at ${now.size} bytes` : ""}`);
        return flush();
      };
      return handle;
    });
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      events.push(`rename ${String(from)} to ${String(to)}`);
      return real.rename(from, to);
    });
    try {
      await run();
    } finally {
      vi.mocked(fs.open).mockReset();
      vi.mocked(fs.rename).mockReset();
    }
    return events;
  }

  /** While `run` runs, a flush of the file or folder at `failing` fails with EIO. */
  async function withFailingFlush(failing: string, run: () => Promise<unknown>): Promise<void> {
    const real = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.open).mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await real.open(...args);
      if (String(args[0]) === failing) {
        handle.sync = () => Promise.reject(Object.assign(new Error("no"), { code: "EIO" }));
      }
      return handle;
    });
    try {
      await run();
    } finally {
      vi.mocked(fs.open).mockReset();
    }
  }

  it("the whole file is flushed before the rename, and the folder after it", async () => {
    const url = await wholeAnswer();
    const events = await flushesAndRenames(() => boxDownload(url, options(), destination));
    expect(events).toEqual([
      `flush ${partial} at ${BYTES.length} bytes`,
      `rename ${partial} to ${destination}`,
      `flush ${folder}`,
    ]);
    expect((await readFile(destination)).equals(BYTES)).toBe(true);
  });

  it("a file that cannot be flushed is a failure, with neither file left", async () => {
    const url = await wholeAnswer();
    await withFailingFlush(partial, async () => {
      await expect(boxDownload(url, options(), destination)).rejects.toMatchObject({
        code: "EIO",
      });
    });
    expect(await existingFiles()).toEqual([]);
  });

  it("a folder that cannot be flushed is a failure, with the whole file at its final name", async () => {
    const url = await wholeAnswer();
    await withFailingFlush(folder, async () => {
      await expect(boxDownload(url, options(), destination)).rejects.toMatchObject({
        code: "EIO",
      });
    });
    expect(await existingFiles()).toEqual([destination]);
    expect((await readFile(destination)).equals(BYTES)).toBe(true);
  });

  it("only the owner can read the partial file and the final file", async () => {
    let answer: ServerResponse | undefined;
    const url = await httpBox((res) => {
      res.writeHead(200, { "content-length": String(BYTES.length) });
      res.write(BYTES.subarray(0, 1_000));
      answer = res;
    });
    // Under this mask a file created with no stated mode comes out 644.
    const mask = process.umask(0o022);
    let partialMode: number;
    try {
      const download = boxDownload(url, options(), destination);
      await vi.waitFor(async () => {
        expect((await readFile(partial)).length).toBe(1_000);
      });
      partialMode = (await stat(partial)).mode & 0o777;
      answer!.end(BYTES.subarray(1_000));
      await download;
    } finally {
      process.umask(mask);
    }
    expect(partialMode).toBe(0o600);
    expect((await stat(destination)).mode & 0o777).toBe(0o600);
  });

  it("a partial file an earlier attempt left readable by others does not pass that on", async () => {
    await writeFile(partial, "left behind");
    await chmod(partial, 0o644);
    await boxDownload(await wholeAnswer(), options(), destination);
    expect((await stat(destination)).mode & 0o777).toBe(0o600);
    expect((await readFile(destination)).equals(BYTES)).toBe(true);
  });

  it("a connection lost straight after the headers is a failure, with neither file left", async () => {
    const url = await httpBox((res) => {
      res.writeHead(200, { "content-length": String(BYTES.length) });
      res.flushHeaders();
      res.destroy();
    });
    await expect(boxDownload(url, options(), destination)).rejects.toThrow();
    expect(await existingFiles()).toEqual([]);
  });

  /** A box that sends part of its answer and holds the rest, so only the client can close it. */
  async function boxHoldingItsAnswer(): Promise<{ url: URL; closed: () => boolean }> {
    let closed = false;
    const url = await httpBox((res) => {
      res.on("close", () => {
        closed = true;
      });
      res.writeHead(200, { "content-length": String(BYTES.length) });
      res.write(BYTES.subarray(0, 1_000));
    });
    return { url, closed: () => closed };
  }

  it("a folder that is not there is a failure: the caller makes it, and the connection closes", async () => {
    const box = await boxHoldingItsAnswer();
    await expect(
      boxDownload(box.url, options(), join(folder, "missing", "received.db")),
    ).rejects.toThrow("ENOENT");
    await vi.waitFor(() => expect(box.closed()).toBe(true));
  });

  it("a partial path that cannot be cleared is a failure, and the connection closes", async () => {
    await mkdir(join(partial, "in-the-way"), { recursive: true });
    const box = await boxHoldingItsAnswer();
    await expect(boxDownload(box.url, options(), destination)).rejects.toMatchObject({
      code: "ERR_FS_EISDIR",
    });
    await vi.waitFor(() => expect(box.closed()).toBe(true));
  });
});
