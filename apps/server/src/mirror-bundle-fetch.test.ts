import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { Hono } from "hono";
import type { Context } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { hasCode, isAppError } from "@waitron/shared";
import type { AdoptCredential } from "./adopt.js";
import type { MirrorBundle } from "./mirror-bundle.js";
import { fetchMirrorBundle } from "./mirror-bundle-fetch.js";

// The fetcher only JSON-round-trips it, so the content is immaterial.
const SAMPLE_BUNDLE: MirrorBundle = {
  designated: {
    locationId: "22222222-2222-2222-2222-222222222222",
    tillId: "33333333-3333-3333-3333-333333333333",
    nodeId: "44444444-4444-4444-4444-444444444444",
    seriesId: "66666666-6666-6666-6666-666666666666",
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

  it("maps a non-2xx response to mirror.bundle_fetch_failed", async () => {
    const app = new Hono();
    app.post("/management-api/mirror-bundle", (c: Context) =>
      c.json({ error: { code: "password.invalid", params: {} } }, 401),
    );
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
