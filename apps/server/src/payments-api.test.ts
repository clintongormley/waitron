import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  asAppUser,
  deviceProfiles,
  devices,
  locations,
  nowIso,
  tenants,
  tills,
  withTransaction,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, persons, startManagementSession } from "@waitron/identity";
import { getCredential, loadKeyRing, tryGetCredential, type KeyRing } from "@waitron/credentials";
import { createStripeCardProvider, type MakeStripe } from "@waitron/payments-stripe";
import { cardReaders, type CardProviderContribution } from "@waitron/payments";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { mountPaymentsApi } from "./payments-api.js";
import type { CardProviderPool } from "./card-provider-pool.js";
import type { TillConfig } from "./till-config.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import "./errors.js";

/**
 * The card-provider and card-reader management routes, on the engine the box now runs.
 *
 * ## The two properties this file was placed here for, and what is left of them
 *
 * Its old header said real PostgreSQL was MANDATORY rather than PGlite, for the table grants the
 * routes need and for the `payments.manage` gate. **The grant half is gone and is replaced by
 * nothing**: SQLite has no roles, one process opens one file, and `asAppUser` is an empty function
 * body (`packages/db/src/testing/roles.ts:25`). The gate half is application logic in the route
 * layer and is unaffected — `gates every new route before reaching the provider` still proves it.
 *
 * Two cases changed with the engine, each recorded where it sits:
 *
 * - `runs as non-superuser app_user` is **DELETED**. It read `current_user` and `rolsuper` out of
 *   `pg_roles` to show the suite itself was not a superuser. There is no catalogue to ask and no
 *   role to ask about, and nothing replaces what it checked.
 * - `does not enable across a concurrent committed unpair` no longer stages a race; see the comment
 *   on the case for what it proves now.
 *
 * ## A broken route this header used to declare is fixed
 *
 * `GET /management-api/payments/readers` served `canEnable` as a NUMBER: the route asked the engine
 * for it with `sql<boolean>`, and that type parameter is a cast rather than a read mapping, so
 * SQLite's integer reached the JSON body unconverted and the dashboard was handed `0` and `1` where
 * it expects `false` and `true`. The route derives the field in JavaScript now
 * (`apps/server/src/payments-api.ts`, `canEnable: unpairedAt === null`), and this file is green —
 * run on its own, 2026-09-22.
 */
const noopLog: Logger = () => {};

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

// Each unique key must not collide within a test, so per-suite counters stand in for the NIF, the
// reader ref and the profile/till names.
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
  locationId: string;
  managerCookie: string;
  staffCookie: string;
}

/** A fresh tenant + location + a manager and a staff person, each with a management session. Each
 * test seeds its OWN venue so reader/credential counts are its own. */
async function seedVenue(): Promise<Venue> {
  // Through the table definitions: `tenants.created_at` and `locations.id` are JavaScript
  // `$defaultFn` generators on this engine, which a raw insert never reaches, and the locale list is
  // encoded by the column's own write mapping — the `array[...]` constructor it replaces is a syntax
  // error here.
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: nextNif(), legalName: "Deli Test SL" });
  const [loc] = await suite.db
    .insert(locations)
    .values({
      name: "Barra",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  const locationId = loc!.id;
  const { managerSid, staffSid } = await withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
    const [mgr] = await tx
      .insert(persons)
      .values({ displayName: "The Manager", pinHash: hashPin("1234"), role: "manager" })
      .returning({ id: persons.id });
    const [stf] = await tx
      .insert(persons)
      .values({ displayName: "The Clerk", pinHash: hashPin("1234"), role: "staff" })
      .returning({ id: persons.id });
    const managerSession = await startManagementSession(tx, {
      personId: mgr!.id,
    });
    const staffSession = await startManagementSession(tx, { personId: stf!.id });
    return { managerSid: managerSession.id, staffSid: staffSession.id };
  });
  return {
    locationId,
    managerCookie: `${MANAGEMENT_COOKIE}=${managerSid}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${staffSid}`,
  };
}

/** A `till`-form-factor device in `venue` — the target the device-default-reader routes point at a
 * reader. A `till` device binds a register (till_id) and no station.
 *
 * Through the table definitions: each `id`, each `created_at` and `devices.enrolled_at` is a
 * `$defaultFn` generator on a NOT NULL column here, which a raw `insert into ... ` never reaches. */
async function seedDevice(venue: Venue): Promise<string> {
  const [profile] = await suite.db
    .insert(deviceProfiles)
    .values({ name: nextName("Perfil caja"), formFactor: "till" })
    .returning({ id: deviceProfiles.id });
  const [till] = await suite.db
    .insert(tills)
    .values({ locationId: venue.locationId, name: nextName("Caja") })
    .returning({ id: tills.id });
  const [dev] = await suite.db
    .insert(devices)
    .values({
      locationId: venue.locationId,
      tillId: till!.id,
      deviceProfileId: profile!.id,
      label: "Registro",
      tokenHash: "x",
    })
    .returning({ id: devices.id });
  return dev!.id;
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
    throw new Error("payments-api.test: pool.get is never called by these routes");
  },
  evict: (providerId) => {
    evicted.push(providerId);
  },
};

function cfgOf(venue: Venue): TillConfig {
  return {
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
      db: suite.db,
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

async function sealedStripe(): Promise<Record<string, string> | null> {
  return withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
    return tryGetCredential(tx, RING, {
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
    const stored = await withTransaction(suite.db, async (tx) => {
      await asAppUser(tx);
      return getCredential(tx, RING, {
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
    expect(await sealedStripe()).toBeNull();
  });

  it("refuses a wrong-environment key with payment.credential_environment_mismatch (environment is passed)", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    // A live key on a preproduction host: the seat's prefix guard fires only because the route passed
    // `environment` through.
    const res = await send(app, "POST", "/management-api/payments/providers/stripe/connect", {
      cookie: venue.managerCookie,
      body: { ...GOOD_KEY, secretKey: "sk_live_ok" },
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "payment.credential_environment_mismatch" },
    });
    expect(await sealedStripe()).toBeNull();
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
    expect(await sealedStripe()).toBeNull();
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
});

describe("an injected fetch is threaded to the seat", () => {
  // The live host omits `fetch` (the seats use the global); a caller that DOES supply one has it
  // passed into `connect` and every `readers.*` call. This exercises that path end to end.
  function mountAppWithFetch(venue: Venue): Hono {
    const app = new Hono();
    mountPaymentsApi(
      app,
      {
        db: suite.db,
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
    expect(await sealedStripe()).toBeNull();
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
        db: suite.db,
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
        db: suite.db,
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
    // Read through the table definition, and `dated` derived in JavaScript: `active` is an integer
    // column with a boolean read mapping here, and `disabled_at is not null` in SQL would come back
    // as 0/1. The assertion below is the one this case has always made.
    const disabled = (
      await suite.db
        .select({ active: cardReaders.active, disabledAt: cardReaders.disabledAt })
        .from(cardReaders)
        .where(eq(cardReaders.id, id))
    ).map(({ active, disabledAt }) => ({ active, dated: disabledAt !== null }));
    expect(disabled).toEqual([{ active: false, dated: true }]);
    const again = await send(app, "POST", `${base}/readers/adopt`, {
      ...opts,
      body: { ...adoption, name: "Terrace" },
    });
    expect(await again.json()).toEqual({ id, status: "paired" });
    const stored = await suite.db
      .select({
        id: cardReaders.id,
        name: cardReaders.name,
        active: cardReaders.active,
        disabledAt: cardReaders.disabledAt,
      })
      .from(cardReaders);
    expect(stored).toEqual([{ id, name: "Terrace", active: true, disabledAt: null }]);
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
    expect(await suite.db.select({ id: cardReaders.id }).from(cardReaders)).toEqual([]);
    expect(removed).toEqual([]);
  });

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
      await suite.db
        .select({
          name: cardReaders.name,
          active: cardReaders.active,
          disabledAt: cardReaders.disabledAt,
        })
        .from(cardReaders)
        .where(eq(cardReaders.id, id)),
    ).toEqual([{ name: "Terrace", active: true, disabledAt: null }]);
    expect(removed).toEqual([]);
    expect((await send(app, "POST", `${base}/readers/${id}/unpair`, opts)).status).toBe(204);
    expect(removed).toEqual([vendor.providerRef]);
    expect(
      await suite.db
        .select({ active: cardReaders.active })
        .from(cardReaders)
        .where(eq(cardReaders.id, id)),
    ).toEqual([{ active: false }]);
  });

  it("refuses local enable after unpair until the provider lists the reader for adoption again", async () => {
    const venue = await seedVenue();
    let paired = true;
    let listings = 0;
    const app = mountApp(venue, [
      discoverySeat(
        async () => {
          listings++;
          return paired ? [vendor] : [];
        },
        async () => {
          paired = false;
        },
      ),
    ]);
    await connectStripe(app, venue);
    const { id } = (await (await addReader(app, venue, vendor.providerRef)).json()) as {
      id: string;
    };
    const opts = { cookie: venue.managerCookie };
    expect((await send(app, "POST", `${base}/readers/${id}/unpair`, opts)).status).toBe(204);
    expect((await send(app, "POST", `${base}/readers/${id}/disable`, opts)).status).toBe(204);
    const enabled = await send(app, "POST", `${base}/readers/${id}/enable`, opts);
    expect(enabled.status).toBe(422);
    expect(await enabled.json()).toEqual({
      error: { code: "reader.not_listed", params: { providerId: "stripe" } },
    });
    expect(listings).toBe(0);
    expect(await (await send(app, "GET", `${base}/readers`, opts)).json()).toEqual([
      { id, provider: "stripe", name: "Barra 1", active: false, canEnable: false, deviceCount: 0 },
    ]);
    paired = true;
    const adopted = await send(app, "POST", `${base}/readers/adopt`, { ...opts, body: adoption });
    expect(await adopted.json()).toEqual({ id, status: "paired" });
    expect((await send(app, "POST", `${base}/readers/${id}/disable`, opts)).status).toBe(204);
    expect((await send(app, "POST", `${base}/readers/${id}/enable`, opts)).status).toBe(204);
    expect(listings).toBe(1);
    expect(await (await send(app, "GET", `${base}/readers`, opts)).json()).toEqual([
      { id, provider: "stripe", name: "Counter", active: true, canEnable: true, deviceCount: 0 },
    ]);
  });

  it("does not enable across a committed unpair the request never saw", async () => {
    // WHAT THIS CASE PROVES NOW, AND WHAT IT LOST. It used to stage a race: an open transaction
    // held the row while the enable request blocked on its lock, and a probe of `pg_stat_activity`
    // asserted the request really was waiting before the hold was released. There is one
    // connection and one writer per file here, so neither half can be staged — the probe has no
    // counterpart and is deleted, and `withWriteLock` (`packages/store/src/write-queue.ts`)
    // serialises the enable behind the unpair rather than making it wait on a lock.
    //
    // What survives is the OUTCOME, and it is not vacuous: the enable is issued while the unpair
    // is still open, so the request cannot have read `unpaired_at` before it was written, and it
    // still answers 422. The route re-reads the row inside its own transaction; that re-read is
    // what the assertion catches. What is NO LONGER checked anywhere is what the route does when
    // the two genuinely overlap.
    const venue = await seedVenue();
    const app = mountApp(venue, [discoverySeat(async () => [vendor])]);
    await connectStripe(app, venue);
    const { id } = (await (await addReader(app, venue, vendor.providerRef)).json()) as {
      id: string;
    };
    let release!: () => void;
    let updated!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      updated = resolve;
    });
    const unpairWrite = withTransaction(suite.db, async (tx) => {
      await asAppUser(tx);
      // ONE clock reading bound to BOTH stamps, so the two columns take the same value. Both are
      // text columns, and `nowIso()` is their canonical spelling.
      const unpaired = nowIso();
      await tx.execute(
        sql`update card_readers set active = false, disabled_at = ${unpaired}, unpaired_at = ${unpaired} where id = ${id}`,
      );
      updated();
      await hold;
    });
    try {
      await ready;
      const enabling = send(app, "POST", `${base}/readers/${id}/enable`, {
        cookie: venue.managerCookie,
      });
      release();
      await unpairWrite;
      expect((await enabling).status).toBe(422);
      expect(
        await suite.db
          .select({ active: cardReaders.active })
          .from(cardReaders)
          .where(eq(cardReaders.id, id)),
      ).toEqual([{ active: false }]);
    } finally {
      release();
      await unpairWrite;
    }
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
    expect(await suite.db.select({ id: cardReaders.id }).from(cardReaders)).toEqual([]);
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

  it("refuses enabling a disabled reader after disconnecting its provider", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue, [discoverySeat(async () => [vendor])]);
    await connectStripe(app, venue);
    const opts = { cookie: venue.managerCookie };
    const added = await send(app, "POST", `${base}/readers/adopt`, { ...opts, body: adoption });
    const { id } = (await added.json()) as { id: string };
    expect((await send(app, "POST", `${base}/readers/${id}/disable`, opts)).status).toBe(204);
    expect((await send(app, "POST", `${base}/providers/stripe/disconnect`, opts)).status).toBe(204);
    const response = await send(app, "POST", `${base}/readers/${id}/enable`, opts);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "reader.provider_disconnected", params: { providerId: "stripe" } },
    });
    const stored = (
      await suite.db
        .select({ active: cardReaders.active, disabledAt: cardReaders.disabledAt })
        .from(cardReaders)
        .where(eq(cardReaders.id, id))
    ).map(({ active, disabledAt }) => ({ active, dated: disabledAt !== null }));
    expect(stored).toEqual([{ active: false, dated: true }]);
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
