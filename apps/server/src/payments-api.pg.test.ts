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

function mountApp(venue: Venue, providers: readonly CardProviderContribution[] = PROVIDERS): Hono {
  const app = new Hono();
  mountPaymentsApi(
    app,
    {
      db: suite.admin,
      cfg: cfgOf(venue),
      ring: RING,
      environment: "preproduction",
      pool,
      providers,
    },
    noopLog,
  );
  return app;
}

async function send(
  app: Hono,
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
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
    expect(
      (await status.json()) as { online: boolean; model?: string; pairingStatus?: string },
    ).toEqual({
      online: true,
      model: "bbpos_wisepos_e",
      // A Stripe reference reader is paired the instant it is added, so its status carries this.
      pairingStatus: "paired",
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

  it("connects, adds, reads status and disables with fetch supplied", async () => {
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
        await send(app, "POST", `/management-api/payments/readers/${readerId}/disable`, {
          cookie: venue.managerCookie,
        })
      ).status,
    ).toBe(204);
  });
});

describe("disconnect", () => {
  it("refuses payment.provider_in_use while an active reader remains, then disconnects once disabled", async () => {
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

    const disabled = await send(
      app,
      "POST",
      `/management-api/payments/readers/${readerId}/disable`,
      {
        cookie: venue.managerCookie,
      },
    );
    expect(disabled.status).toBe(204);

    const gone = await send(app, "POST", "/management-api/payments/providers/stripe/disconnect", {
      cookie: venue.managerCookie,
    });
    expect(gone.status).toBe(204);
    expect(await sealedStripe(venue)).toBeNull();
  });
});

describe("add reader — races with a concurrent disconnect", () => {
  it("does NOT leave an active reader whose provider was disconnected mid-add", async () => {
    // The add's provider round-trip (`seat.readers.add`) runs OUTSIDE any transaction. If a disconnect
    // commits between the pre-check and the final INSERT, the provider now holds no sealed credential,
    // so inserting an ACTIVE reader would strand a row whose provider is gone. The insert transaction
    // re-checks the credential and refuses (`reader.provider_disconnected`), best-effort unpairing the
    // just-paired vendor reader. Reproduces the Codex run-it probe (retained
    // /tmp/review-5510d4be-probes.pg.test.ts): pause the add, disconnect, resume the add.
    const venue = await seedVenue();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const removed: string[] = [];
    const ref = nextRef();
    const seat: CardProviderContribution = {
      ...stripeSeat,
      readers: {
        ...stripeSeat.readers,
        add: async () => {
          entered();
          await hold;
          return { providerRef: ref, status: "paired" as const };
        },
        remove: async (_deps, providerRef) => {
          removed.push(providerRef);
        },
      },
    };
    const app = new Hono();
    mountPaymentsApi(
      app,
      {
        db: suite.admin,
        cfg: cfgOf(venue),
        ring: RING,
        environment: "preproduction",
        pool,
        providers: [seat],
      },
      noopLog,
    );
    expect((await connectStripe(app, venue)).status).toBe(200);

    const adding = send(app, "POST", "/management-api/payments/readers", {
      cookie: venue.managerCookie,
      body: { providerId: "stripe", name: "Barra 1", reference: nextRef() },
    });
    await started; // the add is paused inside seat.readers.add
    const disconnected = await send(
      app,
      "POST",
      "/management-api/payments/providers/stripe/disconnect",
      { cookie: venue.managerCookie },
    );
    release();
    const added = await adding;

    // The disconnect wins (204); the add refuses rather than inserting an orphaned active reader.
    expect(disconnected.status).toBe(204);
    expect(added.status).toBe(409);
    expect((await added.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "reader.provider_disconnected" },
    });
    // No reader row was inserted, and the just-paired vendor reader was best-effort unpaired.
    const readers = (await (
      await send(app, "GET", "/management-api/payments/readers", { cookie: venue.managerCookie })
    ).json()) as unknown[];
    expect(readers).toEqual([]);
    expect(removed).toEqual([ref]);
  });
});

describe("unpair reader — retryable after a failed vendor unpair", () => {
  it("re-attempts the vendor removal on a retry and 204s (unpairing is idempotent)", async () => {
    // Vendor failure leaves the row active; a retry must call the vendor again and disable it.
    const venue = await seedVenue();
    let removes = 0;
    const seat: CardProviderContribution = {
      ...stripeSeat,
      readers: {
        ...stripeSeat.readers,
        canUnpair: true,
        remove: async () => {
          removes += 1;
          if (removes === 1) throw new Error("temporary provider outage");
        },
      },
    };
    const app = new Hono();
    mountPaymentsApi(
      app,
      {
        db: suite.admin,
        cfg: cfgOf(venue),
        ring: RING,
        environment: "preproduction",
        pool,
        providers: [seat],
      },
      noopLog,
    );
    await connectStripe(app, venue);
    const reader = (await (await addReader(app, venue, nextRef())).json()) as { id: string };

    const first = await send(app, "POST", `/management-api/payments/readers/${reader.id}/unpair`, {
      cookie: venue.managerCookie,
    });
    // The vendor call failed, so the first attempt is a server fault (not a clean 204).
    expect(first.status).toBe(500);

    const retry = await send(app, "POST", `/management-api/payments/readers/${reader.id}/unpair`, {
      cookie: venue.managerCookie,
    });
    expect(retry.status).toBe(204);
    // The vendor removal was re-attempted on the retry (2 calls total) and succeeded.
    expect(removes).toBe(2);
  });
});

describe("reader adoption and local management", () => {
  function discoverySeat(
    list: CardProviderContribution["readers"]["list"],
    remove: CardProviderContribution["readers"]["remove"] = async () => {},
  ) {
    return { ...stripeSeat, readers: { ...stripeSeat.readers, canUnpair: true, list, remove } };
  }
  const base = "/management-api/payments";
  const vendor = {
    providerRef: "tmr_existing",
    name: "My Reader",
    model: "solo",
    serial: "serial-1",
  };
  const adoption = { providerId: "stripe", providerRef: vendor.providerRef, name: "Counter" };

  it("runs as non-superuser app_user", async () => {
    await withTenant(suite.admin, randomUUID(), async (tx) => {
      await asAppUser(tx);
      const result = await tx.execute(
        sql`select current_user as role, rolsuper from pg_roles where rolname = current_user`,
      );
      expect(result.rows).toEqual([{ role: "app_user", rolsuper: false }]);
    });
  });

  it("labels available, added and disabled and reuses the disabled id and device default", async () => {
    const venue = await seedVenue();
    const removed: string[] = [];
    const app = mountApp(venue, [
      discoverySeat(
        async () => [vendor],
        async (_deps, ref) => {
          removed.push(ref);
        },
      ),
    ]);
    await connectStripe(app, venue);
    const opts = { cookie: venue.managerCookie };
    const available = async () =>
      (await send(app, "GET", `${base}/providers/stripe/available-readers`, opts)).json();
    expect(await available()).toEqual([{ ...vendor, status: "available" }]);
    const first = await send(app, "POST", `${base}/readers/adopt`, { ...opts, body: adoption });
    expect(first.status).toBe(201);
    const { id } = (await first.json()) as { id: string };
    expect(await available()).toEqual([{ ...vendor, status: "added" }]);
    const device = await seedDevice(venue);
    expect(
      (
        await send(app, "PUT", `${base}/devices/${device}/reader`, {
          ...opts,
          body: { readerId: id },
        })
      ).status,
    ).toBe(204);
    expect((await send(app, "POST", `${base}/readers/${id}/disable`, opts)).status).toBe(204);
    expect(await available()).toEqual([{ ...vendor, status: "disabled" }]);
    const disabled = await suite.admin.execute(
      sql`select active, disabled_at is not null as dated from card_readers where id = ${id}`,
    );
    expect(disabled.rows).toEqual([{ active: false, dated: true }]);
    const again = await send(app, "POST", `${base}/readers/adopt`, {
      ...opts,
      body: { ...adoption, name: "Terrace" },
    });
    expect(await again.json()).toEqual({ id, status: "paired" });
    const stored = await suite.admin.execute(
      sql`select id, name, active, disabled_at from card_readers where tenant_id = ${venue.tenantId}`,
    );
    expect(stored.rows).toEqual([{ id, name: "Terrace", active: true, disabled_at: null }]);
    expect(await (await send(app, "GET", `${base}/devices/${device}/reader`, opts)).json()).toEqual(
      { readerId: id },
    );
    expect(removed).toEqual([]);
  });

  it("refuses an unlisted reference without inserting or removing anything", async () => {
    const venue = await seedVenue();
    const removed: string[] = [];
    const app = mountApp(venue, [
      discoverySeat(
        async () => [vendor],
        async (_deps, ref) => {
          removed.push(ref);
        },
      ),
    ]);
    await connectStripe(app, venue);
    const result = await send(app, "POST", `${base}/readers/adopt`, {
      cookie: venue.managerCookie,
      body: { ...adoption, providerRef: "forged" },
    });
    expect(result.status).toBe(422);
    expect(await result.json()).toEqual({
      error: { code: "reader.not_listed", params: { providerId: "stripe" } },
    });
    expect(
      (
        await suite.admin.execute(
          sql`select id from card_readers where tenant_id = ${venue.tenantId}`,
        )
      ).rows,
    ).toEqual([]);
    expect(removed).toEqual([]);
  });

  it("keeps another tenant's same provider reference out of comparison and adoption", async () => {
    const a = await seedVenue();
    const b = await seedVenue();
    const seat = discoverySeat(async () => [vendor]);
    const appA = mountApp(a, [seat]);
    const appB = mountApp(b, [seat]);
    await connectStripe(appA, a);
    await connectStripe(appB, b);
    const bReader = (await (await addReader(appB, b, vendor.providerRef, "Tenant B")).json()) as {
      id: string;
    };
    expect(
      await (
        await send(appA, "GET", `${base}/providers/stripe/available-readers`, {
          cookie: a.managerCookie,
        })
      ).json(),
    ).toEqual([{ ...vendor, status: "available" }]);
    const adopted = (await (
      await send(appA, "POST", `${base}/readers/adopt`, { cookie: a.managerCookie, body: adoption })
    ).json()) as { id: string };
    expect(adopted).toEqual({ id: expect.any(String), status: "paired" });
    expect(adopted.id).not.toBe(bReader.id);
    expect(
      (
        await suite.admin.execute(
          sql`select name, active from card_readers where id = ${bReader.id}`,
        )
      ).rows,
    ).toEqual([{ name: "Tenant B", active: true }]);
  });

  it.each(["rename", "disable", "enable", "unpair"] as const)(
    "isolates %s by tenant before any vendor call",
    async (action) => {
      const a = await seedVenue();
      const b = await seedVenue();
      let removes = 0;
      const seat = discoverySeat(
        async () => [vendor],
        async () => {
          removes++;
        },
      );
      const appA = mountApp(a, [seat]);
      const appB = mountApp(b, [seat]);
      await connectStripe(appB, b);
      const { id } = (await (await addReader(appB, b, nextRef())).json()) as { id: string };
      const result = await send(
        appA,
        action === "rename" ? "PATCH" : "POST",
        `${base}/readers/${id}${action === "rename" ? "" : `/${action}`}`,
        { cookie: a.managerCookie, body: { name: "Changed" } },
      );
      expect(result.status).toBe(404);
      expect(await result.json()).toEqual({ error: { code: "reader.not_found", params: { id } } });
      expect(removes).toBe(0);
      expect(
        (await suite.admin.execute(sql`select name, active from card_readers where id = ${id}`))
          .rows,
      ).toEqual([{ name: "Barra 1", active: true }]);
    },
  );

  it("renames, disables and enables locally, while unpair alone calls the vendor", async () => {
    const venue = await seedVenue();
    const removed: string[] = [];
    const app = mountApp(venue, [
      discoverySeat(
        async () => [vendor],
        async (_deps, ref) => {
          removed.push(ref);
        },
      ),
    ]);
    await connectStripe(app, venue);
    const { id } = (await (await addReader(app, venue, vendor.providerRef)).json()) as {
      id: string;
    };
    const opts = { cookie: venue.managerCookie };
    expect(
      (await send(app, "PATCH", `${base}/readers/${id}`, { ...opts, body: { name: "Terrace" } }))
        .status,
    ).toBe(204);
    expect((await send(app, "POST", `${base}/readers/${id}/disable`, opts)).status).toBe(204);
    expect((await send(app, "POST", `${base}/readers/${id}/enable`, opts)).status).toBe(204);
    expect(
      (
        await suite.admin.execute(
          sql`select name, active, disabled_at from card_readers where id = ${id}`,
        )
      ).rows,
    ).toEqual([{ name: "Terrace", active: true, disabled_at: null }]);
    expect(removed).toEqual([]);
    expect((await send(app, "POST", `${base}/readers/${id}/unpair`, opts)).status).toBe(204);
    expect(removed).toEqual([vendor.providerRef]);
    expect(
      (await suite.admin.execute(sql`select active from card_readers where id = ${id}`)).rows,
    ).toEqual([{ active: false }]);
  });

  it.each(["adopt", "rename"] as const)(
    "refuses an empty %s name at the server boundary",
    async (action) => {
      const venue = await seedVenue();
      const app = mountApp(venue, [discoverySeat(async () => [vendor])]);
      await connectStripe(app, venue);
      const { id } = (await (await addReader(app, venue, nextRef())).json()) as { id: string };
      const response = await send(
        app,
        action === "adopt" ? "POST" : "PATCH",
        action === "adopt" ? `${base}/readers/adopt` : `${base}/readers/${id}`,
        {
          cookie: venue.managerCookie,
          body: { ...adoption, name: "   " },
        },
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "name" } },
      });
    },
  );

  it("rejects unpair when the provider does not support it", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    await connectStripe(app, venue);
    const { id } = (await (await addReader(app, venue, nextRef())).json()) as { id: string };
    const response = await send(app, "POST", `${base}/readers/${id}/unpair`, {
      cookie: venue.managerCookie,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "providerId" } },
    });
  });

  it("rechecks the credential after the vendor list round-trip without vendor rollback", async () => {
    const venue = await seedVenue();
    let removes = 0;
    const seat = discoverySeat(
      async () => {
        expect(
          (
            await send(app, "POST", `${base}/providers/stripe/disconnect`, {
              cookie: venue.managerCookie,
            })
          ).status,
        ).toBe(204);
        return [vendor];
      },
      async () => {
        removes++;
      },
    );
    const app = mountApp(venue, [seat]);
    await connectStripe(app, venue);
    const response = await send(app, "POST", `${base}/readers/adopt`, {
      cookie: venue.managerCookie,
      body: adoption,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "reader.provider_disconnected", params: { providerId: "stripe" } },
    });
    expect(
      (
        await suite.admin.execute(
          sql`select id from card_readers where tenant_id = ${venue.tenantId}`,
        )
      ).rows,
    ).toEqual([]);
    expect(removes).toBe(0);
  });

  it("gates every new route before reaching the provider", async () => {
    const venue = await seedVenue();
    let listed = 0;
    let removed = 0;
    const app = mountApp(venue, [
      discoverySeat(
        async () => {
          listed++;
          return [vendor];
        },
        async () => {
          removed++;
        },
      ),
    ]);
    await connectStripe(app, venue);
    const { id } = (await (await addReader(app, venue, nextRef())).json()) as { id: string };
    const routes = [
      ["GET", `${base}/providers/stripe/available-readers`],
      ["POST", `${base}/readers/adopt`],
      ["PATCH", `${base}/readers/${id}`],
      ...["disable", "enable", "unpair"].map((a) => ["POST", `${base}/readers/${id}/${a}`]),
    ] as const;
    for (const [method, path] of routes) {
      const response = await send(app, method as "GET" | "POST" | "PATCH", path!, {
        cookie: venue.staffCookie,
        body: method === "GET" ? undefined : adoption,
      });
      expect(response.status, path).toBe(403);
    }
    expect([listed, removed]).toEqual([0, 0]);
  });

  it.each(["available-readers", "adopt"])(
    "refuses disconnected %s before the vendor call",
    async (action) => {
      const venue = await seedVenue();
      let listed = 0;
      const app = mountApp(venue, [
        discoverySeat(async () => {
          listed++;
          return [vendor];
        }),
      ]);
      const response = await send(
        app,
        action === "adopt" ? "POST" : "GET",
        action === "adopt" ? `${base}/readers/adopt` : `${base}/providers/stripe/available-readers`,
        { cookie: venue.managerCookie, ...(action === "adopt" ? { body: adoption } : {}) },
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: { code: "reader.provider_disconnected", params: { providerId: "stripe" } },
      });
      expect(listed).toBe(0);
    },
  );
});
