import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, putCredential } from "@waitron/credentials";
import type { IncidentSink } from "@waitron/payments";
import { isAppError } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { SUMUP_CARD_PROVIDER, deferredClient, optionsFromSealed } from "./card-provider.js";

// PGlite (superuser, one backend) is the right target: the seat reads a sealed credential and maps
// SumUp REST calls through an injected `fetch`, so nothing here depends on the deployment role or on
// concurrency. It seeds a sealed `payments.sumup` credential the seat then reads.
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS],
  timeoutMs: 60_000,
});
const ring = loadKeyRing(KEY_ENV);

interface Seen {
  method: string;
  path: string;
  body: string;
}

/** A `fetch` that routes on `"<METHOD> <pathname>"` (query ignored) and records every call. An
 * unrouted request throws, so a test that hits an endpoint it did not set up fails loudly. */
function routedFetch(routes: Record<string, () => Response>, seen: Seen[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    seen.push({
      method,
      path: url.pathname,
      body: typeof init?.body === "string" ? init.body : "",
    });
    const route = routes[`${method} ${url.pathname}`];
    if (route === undefined) throw new Error(`unrouted ${method} ${url.pathname}`);
    return route();
  }) as unknown as typeof fetch;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const memberships = (items: { resource_id: string; resource: { name: string } }[]) => () =>
  json(200, { items });

/** Seeds a `payments.sumup` credential for a fresh tenant and returns its id. */
async function seedSumUp(value: {
  apiKey: string;
  merchantCode: string;
  affiliateAppId: string;
  affiliateKey: string;
}): Promise<TenantId> {
  const tenantId = await seedTenant(suite.db);
  await withTenant(suite.db, tenantId, (tx) =>
    putCredential(tx, ring, { tenantId, purpose: "payments.sumup", value }),
  );
  return tenantId;
}

describe("SUMUP_CARD_PROVIDER seat metadata", () => {
  it("declares the provider id, purpose, form fields and reader-add mode", () => {
    expect(SUMUP_CARD_PROVIDER.providerId).toBe("sumup");
    expect(SUMUP_CARD_PROVIDER.credentialPurpose).toBe("payments.sumup");
    expect(SUMUP_CARD_PROVIDER.readerAdd).toEqual({
      kind: "pairing-poll",
      codeLabelKey: "payments.sumup.pairing_code",
    });
    // The FORM asks for the API key (+ optional affiliate); merchantCode is DERIVED by connect, so
    // it is never a form field.
    const names = SUMUP_CARD_PROVIDER.credentialFields.map((f) => f.name);
    expect(names).toContain("apiKey");
    expect(names).not.toContain("merchantCode");
    const apiKey = SUMUP_CARD_PROVIDER.credentialFields.find((f) => f.name === "apiKey");
    expect(apiKey?.secret).toBe(true);
    const affiliateAppId = SUMUP_CARD_PROVIDER.credentialFields.find(
      (f) => f.name === "affiliateAppId",
    );
    expect(affiliateAppId?.secret).toBe(true);
    expect(affiliateAppId?.optional).toBe(true);
  });
});

describe("SUMUP_CARD_PROVIDER.connect", () => {
  it("returns the merchant name and the complete sealed payload for a single-merchant key", async () => {
    const fetch = routedFetch({
      "GET /v0.1/memberships": memberships([
        { resource_id: "MY2NPHDW", resource: { name: "Test restaurant" } },
      ]),
    });
    const result = await SUMUP_CARD_PROVIDER.connect({ fetch }, { apiKey: "sup_sk_x" });
    expect(result).toEqual({
      merchantName: "Test restaurant",
      sealedPayload: {
        apiKey: "sup_sk_x",
        merchantCode: "MY2NPHDW",
        affiliateAppId: "-",
        affiliateKey: "-",
      },
    });
  });

  it("carries the operator's affiliate values into the sealed payload", async () => {
    const fetch = routedFetch({
      "GET /v0.1/memberships": memberships([
        { resource_id: "MY2NPHDW", resource: { name: "Test restaurant" } },
      ]),
    });
    const result = await SUMUP_CARD_PROVIDER.connect(
      { fetch },
      { apiKey: "sup_sk_x", affiliateAppId: "com.waitron.pos", affiliateKey: "aff-key" },
    );
    expect(result.sealedPayload).toEqual({
      apiKey: "sup_sk_x",
      merchantCode: "MY2NPHDW",
      affiliateAppId: "com.waitron.pos",
      affiliateKey: "aff-key",
    });
  });

  it("throws provider_credential_rejected when the key is rejected (401)", async () => {
    const fetch = routedFetch({
      "GET /v0.1/memberships": () => json(401, { message: "unauthorized" }),
    });
    await expect(SUMUP_CARD_PROVIDER.connect({ fetch }, { apiKey: "bad" })).rejects.toMatchObject({
      code: "payment.provider_credential_rejected",
    });
  });

  it("throws provider_credential_rejected when the key acts as no merchant", async () => {
    const fetch = routedFetch({ "GET /v0.1/memberships": memberships([]) });
    await expect(
      SUMUP_CARD_PROVIDER.connect({ fetch }, { apiKey: "sup_sk_x" }),
    ).rejects.toMatchObject({ code: "payment.provider_credential_rejected" });
  });

  it("throws provider_credential_rejected when no apiKey was entered", async () => {
    await expect(SUMUP_CARD_PROVIDER.connect({}, {})).rejects.toMatchObject({
      code: "payment.provider_credential_rejected",
    });
  });

  it("throws provider_merchant_ambiguous with the pickable list when several merchants and none chosen", async () => {
    const fetch = routedFetch({
      "GET /v0.1/memberships": memberships([
        { resource_id: "M1", resource: { name: "One" } },
        { resource_id: "M2", resource: { name: "Two" } },
      ]),
    });
    const err = await SUMUP_CARD_PROVIDER.connect({ fetch }, { apiKey: "sup_sk_x" }).then(
      () => {
        throw new Error("expected connect to throw");
      },
      (e: unknown) => e,
    );
    expect(err).toMatchObject({
      code: "payment.provider_merchant_ambiguous",
      params: {
        merchants: [
          { code: "M1", name: "One" },
          { code: "M2", name: "Two" },
        ],
      },
    });
  });

  it("seals the chosen merchant when merchantCode names one of several", async () => {
    const fetch = routedFetch({
      "GET /v0.1/memberships": memberships([
        { resource_id: "M1", resource: { name: "One" } },
        { resource_id: "M2", resource: { name: "Two" } },
      ]),
    });
    const result = await SUMUP_CARD_PROVIDER.connect(
      { fetch },
      { apiKey: "sup_sk_x", merchantCode: "M2" },
    );
    expect(result.merchantName).toBe("Two");
    expect(result.sealedPayload.merchantCode).toBe("M2");
  });

  it("re-offers the picker when the chosen merchantCode is not one the key can act as", async () => {
    const fetch = routedFetch({
      "GET /v0.1/memberships": memberships([
        { resource_id: "M1", resource: { name: "One" } },
        { resource_id: "M2", resource: { name: "Two" } },
      ]),
    });
    await expect(
      SUMUP_CARD_PROVIDER.connect({ fetch }, { apiKey: "sup_sk_x", merchantCode: "M9" }),
    ).rejects.toMatchObject({ code: "payment.provider_merchant_ambiguous" });
  });
});

describe("SUMUP_CARD_PROVIDER.build", () => {
  it("builds a SumUpCloudProvider from the sealed credential", async () => {
    const tenantId = await seedSumUp({
      apiKey: "sup_sk_x",
      merchantCode: "MABC123",
      affiliateAppId: "-",
      affiliateKey: "-",
    });
    const incidents: IncidentSink = () => Promise.resolve(true);
    const provider = SUMUP_CARD_PROVIDER.build({
      db: suite.db,
      ring,
      tenantId,
      nodeId: "node-1",
      environment: "preproduction",
      incidents,
    });
    expect(provider.provider).toBe("sumup");
  });
});

describe("SUMUP_CARD_PROVIDER.readers", () => {
  async function readerDeps(fetchImpl: typeof globalThis.fetch) {
    const tenantId = await seedSumUp({
      apiKey: "sup_sk_x",
      merchantCode: "MABC123",
      affiliateAppId: "-",
      affiliateKey: "-",
    });
    return { db: suite.db, ring, tenantId, fetch: fetchImpl };
  }

  it("lists only paired readers with their provider identity", async () => {
    const fetch = routedFetch({
      "GET /v0.1/merchants/MABC123/readers": () =>
        json(200, {
          items: [
            {
              id: "rdr_ready",
              name: "Counter",
              status: "paired",
              device: { identifier: "200101525543", model: "solo" },
              created_at: "2026-09-12T11:03:45.683Z",
            },
            { id: "rdr_minimal", name: "Terrace", status: "paired" },
            { id: "rdr_wait", name: "Waiting", status: "processing" },
            { id: "rdr_expired", name: "Expired", status: "expired" },
          ],
        }),
    });
    expect(await SUMUP_CARD_PROVIDER.readers.list(await readerDeps(fetch))).toEqual([
      {
        providerRef: "rdr_ready",
        name: "Counter",
        model: "solo",
        serial: "200101525543",
        registeredAt: "2026-09-12T11:03:45.683Z",
      },
      { providerRef: "rdr_minimal", name: "Terrace" },
    ]);
    expect(SUMUP_CARD_PROVIDER.readers.canUnpair).toBe(true);
  });

  it("keeps structured status and rounds battery without losing zero", async () => {
    let battery: number | null = 99.6;
    const fetch = routedFetch({
      "GET /v0.1/merchants/MABC123/readers/rdr_x/status": () =>
        json(200, {
          data: {
            status: "ONLINE",
            battery_level: battery,
            connection_type: "Wi-Fi",
            state: "IDLE",
            firmware_version: "3.3.42.2",
            last_activity: "2026-09-12T11:03:48.930Z",
          },
        }),
      "GET /v0.1/merchants/MABC123/readers/rdr_x": () =>
        json(200, {
          id: "rdr_x",
          status: "paired",
          device: { model: "solo", identifier: "200101525543" },
        }),
    });
    const deps = await readerDeps(fetch);
    const expected = {
      online: true,
      batteryPercent: 100,
      connection: "Wi-Fi",
      activity: "IDLE",
      firmwareVersion: "3.3.42.2",
      lastSeenAt: "2026-09-12T11:03:48.930Z",
      model: "solo",
      serial: "200101525543",
      pairingStatus: "paired",
    };
    expect(await SUMUP_CARD_PROVIDER.readers.status(deps, "rdr_x")).toEqual(expected);
    battery = 0;
    expect(await SUMUP_CARD_PROVIDER.readers.status(deps, "rdr_x")).toEqual({
      ...expected,
      batteryPercent: 0,
    });
    battery = null;
    expect(await SUMUP_CARD_PROVIDER.readers.status(deps, "rdr_x")).not.toHaveProperty(
      "batteryPercent",
    );
  });

  it("add pairs a reader and returns its ref and status, sending the code and name to the merchant", async () => {
    const seen: Seen[] = [];
    const fetch = routedFetch(
      {
        "POST /v0.1/merchants/MABC123/readers": () =>
          json(201, { id: "rdr_x", status: "processing" }),
      },
      seen,
    );
    const result = await SUMUP_CARD_PROVIDER.readers.add(await readerDeps(fetch), {
      name: "Counter",
      code: "ABC12345",
    });
    expect(result).toEqual({ providerRef: "rdr_x", status: "processing" });
    expect(seen[0]?.path).toBe("/v0.1/merchants/MABC123/readers");
    expect(seen[0]?.body).toContain("ABC12345");
    expect(seen[0]?.body).toContain("Counter");
  });

  it("add reports a reader that paired immediately as paired", async () => {
    const fetch = routedFetch({
      "POST /v0.1/merchants/MABC123/readers": () => json(201, { id: "rdr_y", status: "paired" }),
    });
    const result = await SUMUP_CARD_PROVIDER.readers.add(await readerDeps(fetch), {
      name: "Counter",
      code: "ABC12345",
    });
    expect(result).toEqual({ providerRef: "rdr_y", status: "paired" });
  });

  it("add rejects a call with no pairing code (a caller-contract violation)", async () => {
    const fetch = routedFetch({});
    await expect(
      SUMUP_CARD_PROVIDER.readers.add(await readerDeps(fetch), { name: "Counter" }),
    ).rejects.toThrow(/pairing code/);
  });

  it("add maps a 4xx pairing refusal to payment.pairing_refused (never a null-ref reader)", async () => {
    // A bad, expired or already-used pairing code (the common operator mistake) is a SumUp 4xx. The
    // seat must surface the actionable `payment.pairing_refused` — carrying only the providerId, never
    // the code or SumUp's body — so the route never inserts a `card_readers` row with a null
    // `provider_ref` (which would be a NOT-NULL violation → opaque 500).
    const seen: Seen[] = [];
    const fetch = routedFetch(
      {
        "POST /v0.1/merchants/MABC123/readers": () =>
          json(409, { title: "pairing code already used" }),
      },
      seen,
    );
    const error = await SUMUP_CARD_PROVIDER.readers
      .add(await readerDeps(fetch), { name: "Counter", code: "USED1234" })
      .catch((e: unknown) => e);
    expect(isAppError(error)).toBe(true);
    if (isAppError(error)) {
      expect(error.code).toBe("payment.pairing_refused");
      expect(error.params).toEqual({ providerId: "sumup" });
    }
  });

  it("add lets a 5xx (an UNKNOWN outcome) propagate as a fault, not as payment.pairing_refused", async () => {
    // A 5xx / transport failure means we do not know whether the reader paired — that is a genuine
    // fault (an opaque 500 to the caller), never the operator-actionable pairing refusal, which is
    // reserved for a DEFINITE 4xx. The seat must re-throw it unchanged.
    const fetch = routedFetch({
      "POST /v0.1/merchants/MABC123/readers": () => json(503, { title: "upstream down" }),
    });
    const error = await SUMUP_CARD_PROVIDER.readers
      .add(await readerDeps(fetch), { name: "Counter", code: "ABC12345" })
      .catch((e: unknown) => e);
    expect(isAppError(error)).toBe(false);
    expect(String(error)).toMatch(/HTTP 503/);
  });

  it("status maps an online reader and its connection and activity", async () => {
    const fetch = routedFetch({
      "GET /v0.1/merchants/MABC123/readers/rdr_x/status": () =>
        json(200, { data: { status: "ONLINE", connection_type: "WIFI", state: "IDLE" } }),
    });
    const result = await SUMUP_CARD_PROVIDER.readers.status(await readerDeps(fetch), "rdr_x");
    expect(result).toEqual({ online: true, connection: "WIFI", activity: "IDLE" });
  });

  it("status marks a failed status call unreachable", async () => {
    const fetch = routedFetch({
      "GET /v0.1/merchants/MABC123/readers/rdr_x/status": () => json(500, { message: "boom" }),
    });
    const result = await SUMUP_CARD_PROVIDER.readers.status(await readerDeps(fetch), "rdr_x");
    expect(result).toEqual({ online: false, unreachable: true });
  });

  it("status reports pairingStatus from getReader, settling processing → paired", async () => {
    let pairing = "processing";
    const fetch = routedFetch({
      "GET /v0.1/merchants/MABC123/readers/rdr_x/status": () =>
        json(200, { data: { status: "OFFLINE" } }),
      "GET /v0.1/merchants/MABC123/readers/rdr_x": () =>
        json(200, { id: "rdr_x", status: pairing }),
    });
    const deps = await readerDeps(fetch);

    const first = await SUMUP_CARD_PROVIDER.readers.status(deps, "rdr_x");
    expect(first).toEqual({ online: false, pairingStatus: "processing" });

    pairing = "paired";
    const second = await SUMUP_CARD_PROVIDER.readers.status(deps, "rdr_x");
    expect(second).toEqual({ online: false, pairingStatus: "paired" });
  });

  it("status tolerates a failing getReader, leaving pairingStatus undefined", async () => {
    const fetch = routedFetch({
      "GET /v0.1/merchants/MABC123/readers/rdr_x/status": () =>
        json(200, { data: { status: "ONLINE", connection_type: "WIFI", state: "IDLE" } }),
      "GET /v0.1/merchants/MABC123/readers/rdr_x": () => json(500, { message: "boom" }),
    });
    const result = await SUMUP_CARD_PROVIDER.readers.status(await readerDeps(fetch), "rdr_x");
    expect(result).toEqual({ online: true, connection: "WIFI", activity: "IDLE" });
    expect(result.pairingStatus).toBeUndefined();
  });

  it("remove unpairs the reader from the merchant account", async () => {
    const seen: Seen[] = [];
    const fetch = routedFetch(
      { "DELETE /v0.1/merchants/MABC123/readers/rdr_x": () => new Response(null, { status: 204 }) },
      seen,
    );
    await SUMUP_CARD_PROVIDER.readers.remove(await readerDeps(fetch), "rdr_x");
    expect(seen[0]).toMatchObject({
      method: "DELETE",
      path: "/v0.1/merchants/MABC123/readers/rdr_x",
    });
  });
});

describe("optionsFromSealed", () => {
  it("builds the affiliate block when both affiliate fields carry real values", () => {
    expect(
      optionsFromSealed({
        apiKey: "k",
        merchantCode: "M",
        affiliateAppId: "com.waitron.pos",
        affiliateKey: "aff-key",
      }),
    ).toEqual({
      apiKey: "k",
      merchantCode: "M",
      affiliate: { appId: "com.waitron.pos", key: "aff-key" },
    });
  });

  it("rejects a sealed payload missing a field it needs", () => {
    // putCredential seals all four fields, so this is a stale/forged payload driven straight
    // through the pure validator — the server's stripeSecretKeyFrom convention.
    expect(() =>
      optionsFromSealed({ apiKey: "k", affiliateAppId: "-", affiliateKey: "-" }),
    ).toThrow(/payment.provider_credential_rejected/);
  });
});

describe("deferredClient", () => {
  it("reads the sealed credential on first use, then reuses the resolved client", async () => {
    const tenantId = await seedSumUp({
      apiKey: "sup_sk_x",
      merchantCode: "MABC123",
      affiliateAppId: "-",
      affiliateKey: "-",
    });
    const fetch = routedFetch({
      "GET /v0.1/memberships": memberships([
        { resource_id: "MABC123", resource: { name: "Test restaurant" } },
      ]),
      "GET /v0.1/merchants/MABC123/readers": () => json(200, { items: [] }),
    });
    const client = deferredClient({ db: suite.db, ring, tenantId, fetch });
    expect(await client.memberships()).toEqual([
      { merchantCode: "MABC123", name: "Test restaurant" },
    ]);
    // A second call reuses the cached client (a different method to show the wrapper dispatches).
    expect(await client.listReaders()).toEqual([]);
  });

  it("does not cache a failed read, so a later call retries once the credential exists", async () => {
    const tenantId = await seedTenant(suite.db); // no payments.sumup credential yet
    const fetch = routedFetch({
      "GET /v0.1/memberships": memberships([{ resource_id: "M", resource: { name: "x" } }]),
    });
    const client = deferredClient({ db: suite.db, ring, tenantId, fetch });
    await expect(client.memberships()).rejects.toMatchObject({ code: "credentials.missing" });
    await withTenant(suite.db, tenantId, (tx) =>
      putCredential(tx, ring, {
        tenantId,
        purpose: "payments.sumup",
        value: { apiKey: "k", merchantCode: "M", affiliateAppId: "-", affiliateKey: "-" },
      }),
    );
    expect(await client.memberships()).toEqual([{ merchantCode: "M", name: "x" }]);
  });
});
