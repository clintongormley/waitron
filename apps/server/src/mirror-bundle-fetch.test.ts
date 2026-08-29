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

// A representative bundle the primary's endpoint would return. The fetcher only JSON-round-trips it,
// so the exact row content is immaterial; what matters is that a 200 body deep-equals the input.
const SAMPLE_BUNDLE: MirrorBundle = {
  rows: {
    tenant: { id: "11111111-1111-1111-1111-111111111111", legalName: "Waitron SL" },
    locations: [{ id: "22222222-2222-2222-2222-222222222222" }],
    nodes: [{ id: "44444444-4444-4444-4444-444444444444" }],
    tills: [{ id: "33333333-3333-3333-3333-333333333333" }],
    invoiceSeries: [{ id: "66666666-6666-6666-6666-666666666666" }],
  },
  designated: {
    tenantId: "11111111-1111-1111-1111-111111111111",
    locationId: "22222222-2222-2222-2222-222222222222",
    tillId: "33333333-3333-3333-3333-333333333333",
    nodeId: "44444444-4444-4444-4444-444444444444",
    seriesId: "66666666-6666-6666-6666-666666666666",
  },
  environment: "preproduction",
  boxHostname: "waitron.local",
  boxCaPem: "-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n",
  relayUrl: "https://relay.example/abc",
  syncToken: "plaintext-sync-token",
};

// The admin login the primary authenticates — the structured `AdoptCredential` the fetcher serialises
// as the JSON request body (`{ personId, password, totp? }`, the dashboard-login shape).
const CREDENTIAL: AdoptCredential = {
  personId: "99999999-9999-9999-9999-999999999999",
  password: "correct-horse-battery",
};

const servers: ServerType[] = [];

/** Boot a throwaway HTTP Hono app on an ephemeral loopback port and return its base URL. Every server
 * is torn down in `afterEach`, so no socket leaks between tests. */
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

    const bundle = await fetchMirrorBundle(base, CREDENTIAL);

    // The body parsed back to the exact bundle the primary served — including a scalar field read, so
    // this is a real MirrorBundle and not merely a deep-equal on opaque JSON.
    expect(bundle).toEqual(SAMPLE_BUNDLE);
    expect(bundle.syncToken).toBe("plaintext-sync-token");
    // The request the fetcher made: a POST to the primary's mirror-bundle path carrying the credential
    // OBJECT serialised as the JSON body (the shape the primary's dashboard-login screen authenticates).
    expect(seen).toEqual({
      method: "POST",
      path: "/management-api/mirror-bundle",
      body: JSON.stringify(CREDENTIAL),
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

    const bundle = await fetchMirrorBundle(`${base}/`, CREDENTIAL);

    expect(bundle).toEqual(SAMPLE_BUNDLE);
    expect(path).toBe("/management-api/mirror-bundle");
  });

  it("maps a non-2xx response to mirror.bundle_fetch_failed", async () => {
    const app = new Hono();
    app.post("/management-api/mirror-bundle", (c: Context) =>
      c.json({ error: { code: "password.invalid", params: {} } }, 401),
    );
    const base = await startServer(app);

    const error = await fetchMirrorBundle(base, CREDENTIAL).catch((e: unknown) => e);
    expect(isAppError(error) && hasCode(error, "mirror.bundle_fetch_failed")).toBe(true);
  });

  it("maps a 200 with an unparseable body to mirror.bundle_fetch_failed", async () => {
    const app = new Hono();
    app.post("/management-api/mirror-bundle", (c: Context) =>
      c.body("not json at all", 200, { "content-type": "application/json" }),
    );
    const base = await startServer(app);

    const error = await fetchMirrorBundle(base, CREDENTIAL).catch((e: unknown) => e);
    expect(isAppError(error) && hasCode(error, "mirror.bundle_fetch_failed")).toBe(true);
  });

  it("maps a network failure (nothing listening) to mirror.bundle_fetch_failed", async () => {
    // Boot a server, capture its port, then shut it down: a connect to that port now refuses fast and
    // deterministically, exercising the fetcher's network-error catch without a real network round-trip.
    const app = new Hono();
    const base = await startServer(app);
    const server = servers.pop()!;
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );

    const error = await fetchMirrorBundle(base, CREDENTIAL).catch((e: unknown) => e);
    expect(isAppError(error) && hasCode(error, "mirror.bundle_fetch_failed")).toBe(true);
  });
});
