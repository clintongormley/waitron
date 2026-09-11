import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPin, startManagementSession } from "@waitron/identity";
import { getCredential, loadKeyRing, tryGetCredential, type KeyRing } from "@waitron/credentials";
import { createStripeCardProvider, type MakeStripe } from "@waitron/payments-stripe";
import type { CardProviderContribution } from "@waitron/payments";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import { mountPaymentsApi } from "./payments-api.js";
import type { CardProviderPool } from "./card-provider-pool.js";
import type { TillConfig } from "./till-config.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import "./errors.js";

// Real Postgres (a manifest template clone), NOT PGlite — mandatory for THIS surface (CLAUDE.md §4).
// These routes read and write as `app_user` (the credential vault put/delete, the card_readers +
// device_card_readers writes, the payments.manage gate proven by DELETION), and the properties this
// suite is FOR — the table grants, the by-id tenant isolation, the gate — are exactly what PGlite's
// all-superuser connection false-passes.
const noopLog: Logger = () => {};

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const suite = useTemplateDb({ template: "manifest" });

// Tenants accumulate for the life of the shared clone and each unique key must not collide, so
// per-suite counters stand in for the NIF, the reader ref and the profile/till names.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(78_000_000 + nifCounter).padStart(8, "0")}K`;
}
let refCounter = 0;
function nextRef(): string {
  refCounter += 1;
  return `tmr_${refCounter}`;
}
let nameCounter = 0;
function nextName(prefix: string): string {
  nameCounter += 1;
  return `${prefix} ${nameCounter}`;
}

interface Venue {
  tenantId: string;
  locationId: string;
  managerCookie: string;
  staffCookie: string;
}

/** A fresh tenant + location + a manager and a staff person, each with a management session. Each
 * test seeds its OWN venue so reader/credential counts are order-independent across the shared clone. */
async function seedVenue(): Promise<Venue> {
  const tenantId = randomUUID();
  await suite.admin.execute(sql`
    insert into tenants (id, country, tax_id, legal_name)
    values (${tenantId}, 'ES', ${nextNif()}, 'Deli Test SL')`);
  const loc = await suite.admin.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array['es-ES'], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  const { managerSid, staffSid } = await withTenant(suite.admin, tenantId, async (tx) => {
    await asAppUser(tx);
    const mgr = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${tenantId}, 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
    const stf = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${tenantId}, 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
    const managerSession = await startManagementSession(tx, {
      tenantId,
      personId: mgr.rows[0]!.id,
    });
    const staffSession = await startManagementSession(tx, { tenantId, personId: stf.rows[0]!.id });
    return { managerSid: managerSession.id, staffSid: staffSession.id };
  });
  return {
    tenantId,
    locationId,
    managerCookie: `${MANAGEMENT_COOKIE}=${managerSid}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${staffSid}`,
  };
}

/** A `till`-form-factor device in `venue` (owner SQL for setup) — the target the device-default-reader
 * routes point at a reader. A `till` device binds a register (till_id) and no station, per the
 * device_binding_rule trigger. */
async function seedDevice(venue: Venue): Promise<string> {
  const profile = await suite.admin.execute<{ id: string }>(sql`
    insert into device_profiles (tenant_id, name, form_factor)
    values (${venue.tenantId}, ${nextName("Perfil caja")}, 'till') returning id`);
  const till = await suite.admin.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${venue.tenantId}, ${venue.locationId}, ${nextName("Caja")}) returning id`);
  const dev = await suite.admin.execute<{ id: string }>(sql`
    insert into devices (tenant_id, location_id, till_id, device_profile_id, label, token_hash)
    values (${venue.tenantId}, ${venue.locationId}, ${till.rows[0]!.id}, ${profile.rows[0]!.id}, 'Registro', 'x')
    returning id`);
  return dev.rows[0]!.id;
}

/** A fake Stripe SDK: a good key answers with an account + an online reader; a key carrying `bad`
 * throws on the account read (the rejected-credential signal). No network — the seat's SDK factory is
 * injected, so the route path is exercised without reaching Stripe. */
function fakeStripeFor(secretKey: string): unknown {
  if (secretKey.includes("bad")) {
    return {
      accounts: {
        retrieve: async () => {
          throw new Error("Invalid API Key");
        },
      },
      terminal: {
        readers: {
          retrieve: async () => {
            throw new Error("No such reader");
          },
        },
      },
    };
  }
  return {
    accounts: {
      retrieve: async () => ({
        id: "acct_test",
        settings: { dashboard: { display_name: "Deli Stripe SL" } },
      }),
    },
    terminal: {
      readers: {
        retrieve: async (id: string) => ({ id, status: "online", device_type: "bbpos_wisepos_e" }),
      },
    },
  };
}
const fakeMakeStripe = ((secretKey: string) => fakeStripeFor(secretKey)) as unknown as MakeStripe;
const stripeSeat: CardProviderContribution = createStripeCardProvider(fakeMakeStripe);
const PROVIDERS: readonly CardProviderContribution[] = [stripeSeat];

const evicted: string[] = [];
const pool: CardProviderPool = {
  get: async () => {
    throw new Error("payments-api.pg.test: pool.get is never called by these routes");
  },
  evict: (providerId) => {
    evicted.push(providerId);
  },
};

function cfgOf(venue: Venue): TillConfig {
  return {
    tenantId: brandTenantId(venue.tenantId),
    tillId: brandTillId(randomUUID()),
    nodeId: brandNodeId(randomUUID()),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(venue.locationId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    orderFlow: "ticket_then_pay",
  };
}

function mountApp(venue: Venue): Hono {
  const app = new Hono();
  mountPaymentsApi(
    app,
    {
      db: suite.admin,
      cfg: cfgOf(venue),
      ring: RING,
      environment: "preproduction",
      pool,
      providers: PROVIDERS,
    },
    noopLog,
  );
  return app;
}

async function send(
  app: Hono,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  opts: { body?: unknown; cookie?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie !== undefined) headers["cookie"] = opts.cookie;
  return app.request(path, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
}

const GOOD_KEY = {
  secretKey: "sk_test_ok",
  webhookSecret: "whsec_x",
  successUrl: "https://x/s",
  cancelUrl: "https://x/c",
};

async function connectStripe(app: Hono, venue: Venue): Promise<Response> {
  return send(app, "POST", "/management-api/payments/providers/stripe/connect", {
    cookie: venue.managerCookie,
    body: GOOD_KEY,
  });
}

async function addReader(
  app: Hono,
  venue: Venue,
  ref: string,
  name = "Barra 1",
): Promise<Response> {
  return send(app, "POST", "/management-api/payments/readers", {
    cookie: venue.managerCookie,
    body: { providerId: "stripe", name, reference: ref },
  });
}

async function sealedStripe(venue: Venue): Promise<Record<string, string> | null> {
  return withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    return tryGetCredential(tx, RING, {
      tenantId: brandTenantId(venue.tenantId),
      purpose: "payments.stripe",
    });
  });
}

describe("connect", () => {
  it("seals the credential, returns the merchant name and NO secret, and evicts the pool", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    const before = evicted.length;
    const res = await connectStripe(app, venue);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // The merchant name is confirmed; NO field value is echoed back.
    expect(body).toEqual({ merchantName: "Deli Stripe SL" });
    expect(evicted.slice(before)).toEqual(["stripe"]);
    // The sealed payload exists and is exactly the four declared fields.
    const stored = await withTenant(suite.admin, venue.tenantId, async (tx) => {
      await asAppUser(tx);
      return getCredential(tx, RING, {
        tenantId: brandTenantId(venue.tenantId),
        purpose: "payments.stripe",
      });
    });
    expect(stored).toEqual(GOOD_KEY);
  });

  it("rejects a bad key with payment.provider_credential_rejected and seals nothing", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    const res = await send(app, "POST", "/management-api/payments/providers/stripe/connect", {
      cookie: venue.managerCookie,
      body: { ...GOOD_KEY, secretKey: "sk_test_bad" },
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "payment.provider_credential_rejected" },
    });
    expect(await sealedStripe(venue)).toBeNull();
  });

  it("refuses a wrong-environment key with payment.credential_environment_mismatch (environment is passed)", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    // A live key on a preproduction host: the seat's prefix guard fires only because the route passed
    // `environment` AND `tenantId` through.
    const res = await send(app, "POST", "/management-api/payments/providers/stripe/connect", {
      cookie: venue.managerCookie,
      body: { ...GOOD_KEY, secretKey: "sk_live_ok" },
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "payment.credential_environment_mismatch" },
    });
    expect(await sealedStripe(venue)).toBeNull();
  });

  it("refuses a staff session with authorization.not_permitted", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    const res = await send(app, "POST", "/management-api/payments/providers/stripe/connect", {
      cookie: venue.staffCookie,
      body: GOOD_KEY,
    });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
    expect(await sealedStripe(venue)).toBeNull();
  });
});

describe("providers list", () => {
  it("reports not_connected before and connected after, with the seat's fields", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    const before = await send(app, "GET", "/management-api/payments/providers", {
      cookie: venue.managerCookie,
    });
    expect(before.status).toBe(200);
    const beforeBody = (await before.json()) as {
      providerId: string;
      state: string;
      credentialFields: unknown[];
      readerAdd: unknown;
    }[];
    const stripeBefore = beforeBody.find((p) => p.providerId === "stripe")!;
    expect(stripeBefore.state).toBe("not_connected");
    expect(stripeBefore.credentialFields.length).toBeGreaterThan(0);
    expect(stripeBefore.readerAdd).toBeDefined();

    await connectStripe(app, venue);
    const after = await send(app, "GET", "/management-api/payments/providers", {
      cookie: venue.managerCookie,
    });
    const afterBody = (await after.json()) as { providerId: string; state: string }[];
    expect(afterBody.find((p) => p.providerId === "stripe")!.state).toBe("connected");
  });
});

describe("readers — tenant isolation", () => {
  it("hides tenant A's reader from tenant B's list", async () => {
    const a = await seedVenue();
    const b = await seedVenue();
    const appA = mountApp(a);
    const appB = mountApp(b);
    await connectStripe(appA, a);
    const ref = nextRef();
    const added = await addReader(appA, a, ref, "Barra A");
    expect(added.status).toBe(201);
    const addedBody = (await added.json()) as { id: string; status: string };
    const readerId = addedBody.id;
    expect(addedBody.status).toBe("paired");

    const listA = (await (
      await send(appA, "GET", "/management-api/payments/readers", { cookie: a.managerCookie })
    ).json()) as { id: string }[];
    expect(listA.some((r) => r.id === readerId)).toBe(true);

    const listB = (await (
      await send(appB, "GET", "/management-api/payments/readers", { cookie: b.managerCookie })
    ).json()) as { id: string }[];
    expect(listB.some((r) => r.id === readerId)).toBe(false);
  });

  it("404s reader.not_found on a status read of another tenant's reader id", async () => {
    const a = await seedVenue();
    const b = await seedVenue();
    const appA = mountApp(a);
    const appB = mountApp(b);
    await connectStripe(appB, b);
    const bReaderId = (
      (await (await addReader(appB, b, nextRef(), "Barra B")).json()) as {
        id: string;
      }
    ).id;
    const res = await send(appA, "GET", `/management-api/payments/readers/${bReaderId}/status`, {
      cookie: a.managerCookie,
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "reader.not_found" },
    });
  });

  it("404s reader.not_found when a device default names another tenant's reader", async () => {
    const a = await seedVenue();
    const b = await seedVenue();
    const appA = mountApp(a);
    const appB = mountApp(b);
    await connectStripe(appB, b);
    const bReaderId = (
      (await (await addReader(appB, b, nextRef(), "Barra B")).json()) as {
        id: string;
      }
    ).id;
    const deviceA = await seedDevice(a);
    const res = await send(appA, "PUT", `/management-api/payments/devices/${deviceA}/reader`, {
      cookie: a.managerCookie,
      body: { readerId: bReaderId },
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "reader.not_found" },
    });
  });
});

describe("device default reader", () => {
  it("sets, reads back and clears a device's default reader", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    await connectStripe(app, venue);
    const readerId = (
      (await (await addReader(app, venue, nextRef(), "Barra")).json()) as {
        id: string;
      }
    ).id;
    const device = await seedDevice(venue);

    const empty = await send(app, "GET", `/management-api/payments/devices/${device}/reader`, {
      cookie: venue.managerCookie,
    });
    expect((await empty.json()) as { readerId: string | null }).toEqual({ readerId: null });

    const set = await send(app, "PUT", `/management-api/payments/devices/${device}/reader`, {
      cookie: venue.managerCookie,
      body: { readerId },
    });
    expect(set.status).toBe(204);
    const read = await send(app, "GET", `/management-api/payments/devices/${device}/reader`, {
      cookie: venue.managerCookie,
    });
    expect((await read.json()) as { readerId: string | null }).toEqual({ readerId });

    const cleared = await send(app, "PUT", `/management-api/payments/devices/${device}/reader`, {
      cookie: venue.managerCookie,
      body: { readerId: null },
    });
    expect(cleared.status).toBe(204);
    const afterClear = await send(app, "GET", `/management-api/payments/devices/${device}/reader`, {
      cookie: venue.managerCookie,
    });
    expect((await afterClear.json()) as { readerId: string | null }).toEqual({ readerId: null });
  });
});

describe("readers — lifecycle and screens", () => {
  it("refuses adding a reader for a provider that is not connected", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    const res = await addReader(app, venue, nextRef(), "Barra");
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "reader.provider_disconnected" },
    });
  });

  it("reports a reader's live status through the seat, and its device count in the list", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    await connectStripe(app, venue);
    const readerId = (
      (await (await addReader(app, venue, nextRef(), "Barra")).json()) as {
        id: string;
      }
    ).id;

    const status = await send(app, "GET", `/management-api/payments/readers/${readerId}/status`, {
      cookie: venue.managerCookie,
    });
    expect(status.status).toBe(200);
    expect((await status.json()) as { online: boolean; detail?: string }).toEqual({
      online: true,
      detail: "bbpos_wisepos_e",
    });

    // Point a device at the reader, then the list's deviceCount reflects it.
    const device = await seedDevice(venue);
    await send(app, "PUT", `/management-api/payments/devices/${device}/reader`, {
      cookie: venue.managerCookie,
      body: { readerId },
    });
    const list = (await (
      await send(app, "GET", "/management-api/payments/readers", { cookie: venue.managerCookie })
    ).json()) as { id: string; deviceCount: number }[];
    expect(list.find((r) => r.id === readerId)!.deviceCount).toBe(1);
  });
});

describe("device default reader — screens", () => {
  it("400s management.request_invalid when the body omits readerId", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    const device = await seedDevice(venue);
    const res = await send(app, "PUT", `/management-api/payments/devices/${device}/reader`, {
      cookie: venue.managerCookie,
      body: {},
    });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "readerId" } },
    });
  });

  it("404s device.not_found for a device id that is not this tenant's", async () => {
    const a = await seedVenue();
    const b = await seedVenue();
    const appA = mountApp(a);
    const deviceB = await seedDevice(b);
    const res = await send(appA, "PUT", `/management-api/payments/devices/${deviceB}/reader`, {
      cookie: a.managerCookie,
      body: { readerId: null },
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.not_found" },
    });
  });
});

describe("an injected fetch is threaded to the seat", () => {
  // The live host omits `fetch` (the seats use the global); a caller that DOES supply one has it
  // passed into `connect` and every `readers.*` call. This exercises that path end to end.
  function mountAppWithFetch(venue: Venue): Hono {
    const app = new Hono();
    mountPaymentsApi(
      app,
      {
        db: suite.admin,
        cfg: cfgOf(venue),
        ring: RING,
        environment: "preproduction",
        pool,
        providers: PROVIDERS,
        fetch: globalThis.fetch,
      },
      noopLog,
    );
    return app;
  }

  it("connects, adds, reads status and retires with fetch supplied", async () => {
    const venue = await seedVenue();
    const app = mountAppWithFetch(venue);
    expect((await connectStripe(app, venue)).status).toBe(200);
    const readerId = (
      (await (await addReader(app, venue, nextRef(), "Barra")).json()) as {
        id: string;
      }
    ).id;
    expect(
      (
        await send(app, "GET", `/management-api/payments/readers/${readerId}/status`, {
          cookie: venue.managerCookie,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send(app, "POST", `/management-api/payments/readers/${readerId}/retire`, {
          cookie: venue.managerCookie,
        })
      ).status,
    ).toBe(204);
  });
});

describe("disconnect", () => {
  it("refuses payment.provider_in_use while an active reader remains, then disconnects once retired", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    await connectStripe(app, venue);
    const readerId = (
      (await (await addReader(app, venue, nextRef(), "Barra")).json()) as {
        id: string;
      }
    ).id;

    const inUse = await send(app, "POST", "/management-api/payments/providers/stripe/disconnect", {
      cookie: venue.managerCookie,
    });
    expect(inUse.status).toBe(409);
    expect(
      (await inUse.json()) as { error: { code: string; params: { activeReaders: number } } },
    ).toMatchObject({ error: { code: "payment.provider_in_use", params: { activeReaders: 1 } } });

    const retired = await send(app, "POST", `/management-api/payments/readers/${readerId}/retire`, {
      cookie: venue.managerCookie,
    });
    expect(retired.status).toBe(204);

    const gone = await send(app, "POST", "/management-api/payments/providers/stripe/disconnect", {
      cookie: venue.managerCookie,
    });
    expect(gone.status).toBe(204);
    expect(await sealedStripe(venue)).toBeNull();
  });
});
