import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  deviceProfiles,
  devices,
  locations,
  nowIso,
  tenants,
  withTransaction,
  workingOrders,
  type Database,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, persons, startManagementSession } from "@waitron/identity";
import { getCredential, loadKeyRing, tryGetCredential, type KeyRing } from "@waitron/credentials";
import { createStripeCardProvider, type MakeStripe } from "@waitron/payments-stripe";
import { SUMUP_CARD_PROVIDER } from "@waitron/payments-sumup";
import {
  DEMO_READER_ID,
  cardReaderHolders,
  cardReaders,
  deviceProfileCardReaders,
  deviceCardReaders,
  payments,
  type CardProviderContribution,
} from "@waitron/payments";
import {
  AppError,
  type DeleteImpact,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
} from "@waitron/shared";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import { mountPaymentsApi } from "./payments-api.js";
import { deleteDevice } from "./device-delete.js";
import { systemClock } from "./till-backend.js";
import type { CardProviderPool } from "./card-provider-pool.js";
import type { TillConfig } from "./till-config.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import "./errors.js";

/**
 * The card-provider and card-reader management routes: the `payments.manage` gate, credential
 * sealing, and reader add/adopt/enable/unpair against fake provider seats.
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

async function seedVenue(): Promise<Venue> {
  // Through the table definitions: `$defaultFn` generators and the locale list's write mapping are
  // never reached by a raw insert.
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
    return { managerSid: managerSession.token, staffSid: staffSession.token };
  });
  return {
    locationId,
    managerCookie: `${MANAGEMENT_COOKIE}=${managerSid}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${staffSid}`,
  };
}

async function seedDevice(venue: Venue): Promise<string> {
  const [profile] = await suite.db
    .insert(deviceProfiles)
    .values({ name: nextName("Perfil caja"), formFactor: "till" })
    .returning({ id: deviceProfiles.id });
  const [dev] = await suite.db
    .insert(devices)
    .values({
      locationId: venue.locationId,
      deviceProfileId: profile!.id,
      label: nextName("Registro"),
      tokenHash: "x",
    })
    .returning({ id: devices.id });
  return dev!.id;
}

/** Puts `readerId` on the list of the device's profile, so the device may choose it. */
async function listOnProfile(deviceId: string, readerId: string): Promise<void> {
  const [device] = await suite.db
    .select({ profileId: devices.deviceProfileId })
    .from(devices)
    .where(eq(devices.id, deviceId));
  await suite.db
    .insert(deviceProfileCardReaders)
    .values({ deviceProfileId: device!.profileId, readerId, position: 0 });
}

/** A fake Stripe SDK: a key carrying `bad` throws on the account read (a rejected credential). */
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

// These routes file no sale; the stuck-payment routes that do are in payments-api.stuck.test.ts.
function saleDeps() {
  return { backend: new FakeFiscalBackend(suite.db), clock: systemClock() };
}

function cfgOf(venue: Venue): TillConfig {
  return {
    nodeId: brandNodeId(randomUUID()),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(venue.locationId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
}

function mountApp(
  venue: Venue,
  providers: readonly CardProviderContribution[] = PROVIDERS,
  db: Database = suite.db,
): Hono {
  const app = new Hono();
  mountPaymentsApi(
    app,
    {
      db,
      ...saleDeps(),
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

describe("device and profile readers", () => {
  it("keeps the demo reader out of ordinary reader management", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    const device = await seedDevice(venue);
    await suite.db.insert(cardReaders).values({
      id: DEMO_READER_ID,
      provider: "simulator",
      providerRef: "waitron-demo-reader",
      name: "Demo reader",
    });

    const listed = await send(app, "GET", "/management-api/payments/readers", {
      cookie: venue.managerCookie,
    });
    expect(await listed.json()).toEqual([]);

    const assigned = await send(app, "PUT", `/management-api/payments/devices/${device}/reader`, {
      cookie: venue.managerCookie,
      body: { readerId: DEMO_READER_ID },
    });
    expect((await assigned.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "reader.not_found" },
    });
    const status = await send(
      app,
      "GET",
      `/management-api/payments/readers/${DEMO_READER_ID}/status`,
      {
        cookie: venue.managerCookie,
      },
    );
    expect((await status.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "reader.not_found" },
    });
  });
  it("sets, reads back and clears a device's chosen reader", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    await connectStripe(app, venue);
    const readerId = (
      (await (await addReader(app, venue, nextRef(), "Barra")).json()) as {
        id: string;
      }
    ).id;
    const device = await seedDevice(venue);
    await listOnProfile(device, readerId);

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

  async function seedReaders(...names: string[]): Promise<string[]> {
    const rows = await suite.db
      .insert(cardReaders)
      .values(names.map((name) => ({ provider: "stripe", providerRef: nextRef(), name })))
      .returning({ id: cardReaders.id });
    return rows.map((row) => row.id);
  }

  async function readerHolder(readerId: string): Promise<string | null> {
    const [row] = await suite.db
      .select({ deviceId: cardReaderHolders.deviceId })
      .from(cardReaderHolders)
      .where(eq(cardReaderHolders.readerId, readerId));
    return row?.deviceId ?? null;
  }

  it("PUT a device's reader null puts it on Use default", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    const [counter, terrace] = await seedReaders("Barra", "Terraza");
    const device = await seedDevice(venue);
    const [row] = await suite.db
      .select({ profileId: devices.deviceProfileId })
      .from(devices)
      .where(eq(devices.id, device));
    const opts = { cookie: venue.managerCookie };
    const profilePath = `/management-api/payments/device-profiles/${row!.profileId}/readers`;
    expect(
      (
        await send(app, "PUT", profilePath, {
          ...opts,
          body: { readerIds: [counter, terrace], defaultReaderId: counter },
        })
      ).status,
    ).toBe(200);
    const path = `/management-api/payments/devices/${device}/reader`;
    expect((await send(app, "PUT", path, { ...opts, body: { readerId: terrace } })).status).toBe(
      204,
    );
    expect([await readerHolder(counter), await readerHolder(terrace)]).toEqual([null, device]);

    const cleared = await send(app, "PUT", path, { ...opts, body: { readerId: null } });

    expect(cleared.status).toBe(204);
    expect(await (await send(app, "GET", path, opts)).json()).toEqual({ readerId: null });
    expect([await readerHolder(counter), await readerHolder(terrace)]).toEqual([device, null]);
  });

  it("a reader another device holds is device.equipment_held, and nothing moves", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    const [reader] = await seedReaders("Barra");
    const first = await seedDevice(venue);
    const second = await seedDevice(venue);
    await listOnProfile(first, reader!);
    await listOnProfile(second, reader!);
    const opts = { cookie: venue.managerCookie };
    const put = (deviceId: string) =>
      send(app, "PUT", `/management-api/payments/devices/${deviceId}/reader`, {
        ...opts,
        body: { readerId: reader },
      });
    expect((await put(first)).status).toBe(204);

    const taken = await put(second);

    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({
      error: {
        code: "device.equipment_held",
        params: { field: "cardReaderId", holderDeviceId: first, holderPersonName: null },
      },
    });
    expect(await readerHolder(reader!)).toBe(first);
    expect(
      await (
        await send(app, "GET", `/management-api/payments/devices/${second}/reader`, opts)
      ).json(),
    ).toEqual({ readerId: null });
  });

  it("a deleted device's reader choice is device.not_found, for a reader and for the default, and nothing moves", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    const [reader] = await seedReaders("Barra");
    const device = await seedDevice(venue);
    await listOnProfile(device, reader!);
    await withTransaction(suite.db, (tx) => deleteDevice(tx, cfgOf(venue), device));
    const choices = () => suite.db.select().from(deviceCardReaders);
    const before = { choices: await choices(), holder: await readerHolder(reader!) };

    for (const readerId of [reader!, null]) {
      const res = await send(app, "PUT", `/management-api/payments/devices/${device}/reader`, {
        cookie: venue.managerCookie,
        body: { readerId },
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({
        error: { code: "device.not_found", params: { deviceId: device } },
      });
    }
    expect({ choices: await choices(), holder: await readerHolder(reader!) }).toEqual(before);
  });

  it("reading a deleted or unknown device's reader choice is device.not_found, as the PUT answers", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    const [reader] = await seedReaders("Barra");
    const device = await seedDevice(venue);
    await listOnProfile(device, reader!);
    const opts = { cookie: venue.managerCookie };
    const path = (id: string) => `/management-api/payments/devices/${id}/reader`;
    expect(
      (await send(app, "PUT", path(device), { ...opts, body: { readerId: reader } })).status,
    ).toBe(204);
    await withTransaction(suite.db, (tx) => deleteDevice(tx, cfgOf(venue), device));

    for (const id of [device, randomUUID()]) {
      const res = await send(app, "GET", path(id), opts);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({
        error: { code: "device.not_found", params: { deviceId: id } },
      });
    }
  });

  it("profile readers: stores the list and default, and refuses a default not in the list", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    const [counter, terrace] = await seedReaders("Barra", "Terraza");
    const [profile] = await suite.db
      .insert(deviceProfiles)
      .values({ name: nextName("Perfil lectores"), formFactor: "till" })
      .returning({ id: deviceProfiles.id });
    const path = `/management-api/payments/device-profiles/${profile!.id}/readers`;
    const opts = { cookie: venue.managerCookie };

    const stored = await send(app, "PUT", path, {
      ...opts,
      body: { readerIds: [terrace, counter], defaultReaderId: counter },
    });
    expect(stored.status).toBe(200);
    expect(await (await send(app, "GET", path, opts)).json()).toEqual({
      readerIds: [terrace, counter],
      defaultReaderId: counter,
    });

    const refused = await send(app, "PUT", path, {
      ...opts,
      body: { readerIds: [terrace], defaultReaderId: counter },
    });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({
      error: {
        code: "device_profile.invalid",
        params: { reason: "default_not_listed", field: "defaultReaderId" },
      },
    });
    expect(await (await send(app, "GET", path, opts)).json()).toEqual({
      readerIds: [terrace, counter],
      defaultReaderId: counter,
    });
  });

  it("profile readers: refuses an unknown profile and an unknown reader", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    const [profile] = await suite.db
      .insert(deviceProfiles)
      .values({ name: nextName("Perfil lectores"), formFactor: "till" })
      .returning({ id: deviceProfiles.id });
    const opts = { cookie: venue.managerCookie };
    const unknownReader = randomUUID();

    const noProfile = await send(
      app,
      "GET",
      `/management-api/payments/device-profiles/${randomUUID()}/readers`,
      opts,
    );
    const noReader = await send(
      app,
      "PUT",
      `/management-api/payments/device-profiles/${profile!.id}/readers`,
      { ...opts, body: { readerIds: [unknownReader], defaultReaderId: null } },
    );

    expect(noProfile.status).toBe(404);
    expect(await noProfile.json()).toMatchObject({ error: { code: "device_profile.not_found" } });
    expect(noReader.status).toBe(404);
    expect(await noReader.json()).toEqual({
      error: { code: "reader.not_found", params: { id: unknownReader } },
    });
  });
});

describe("reader holders", () => {
  const path = "/management-api/payments/reader-holders";

  it("names each held reader's device, and the devices with a payment in progress on a reader", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    const [held, busy, idle] = (
      await suite.db
        .insert(cardReaders)
        .values(
          ["Barra", "Terraza", "Almacén"].map((name) => ({
            provider: "stripe",
            providerRef: nextRef(),
            name,
          })),
        )
        .returning({ id: cardReaders.id })
    ).map((row) => row.id);
    const holder = await seedDevice(venue);
    const payer = await seedDevice(venue);
    const [holderRow] = await suite.db
      .select({ label: devices.label })
      .from(devices)
      .where(eq(devices.id, holder));
    await suite.db.insert(cardReaderHolders).values({ readerId: held!, deviceId: holder });
    let orderNumber = 0;
    const order = async () => {
      orderNumber += 1;
      const [row] = await suite.db
        .insert(workingOrders)
        .values({ source: "dashboard", locationId: venue.locationId, orderNumber })
        .returning({ id: workingOrders.id });
      return row!.id;
    };
    const payment = async (state: "attempting" | "captured", readerId: string) => ({
      workingOrderId: await order(),
      source: "device" as const,
      deviceId: payer,
      readerId,
      provider: "stripe",
      paymentRef: randomUUID(),
      amount: 500,
      state,
    });
    await suite.db
      .insert(payments)
      .values([await payment("attempting", busy!), await payment("captured", idle!)]);

    const response = await send(app, "GET", path, { cookie: venue.managerCookie });

    expect(response.status).toBe(200);
    const rows = (await response.json()) as { readerId: string }[];
    expect(rows.sort((a, b) => a.readerId.localeCompare(b.readerId))).toEqual(
      [
        {
          readerId: held,
          holder: { deviceId: holder, deviceName: holderRow!.label, personName: null },
          paymentInProgressDeviceIds: [],
        },
        { readerId: busy, holder: null, paymentInProgressDeviceIds: [payer] },
      ].sort((a, b) => a.readerId!.localeCompare(b.readerId!)),
    );
  });

  it("is refused without the payments permission", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    expect((await send(app, "GET", path, { cookie: venue.staffCookie })).status).toBe(403);
    expect((await send(app, "GET", path)).status).toBe(401);
  });
});

describe("readers — lifecycle and screens", () => {
  it("lists configured device names from choices and profile defaults, with choices taking precedence", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    const first = randomUUID();
    const second = randomUUID();
    const unused = randomUUID();
    await suite.db.insert(cardReaders).values([
      { id: first, provider: "stripe", providerRef: nextRef(), name: "Default reader" },
      { id: second, provider: "stripe", providerRef: nextRef(), name: "Chosen reader" },
      { id: unused, provider: "stripe", providerRef: nextRef(), name: "Unused reader" },
    ]);
    const [profile] = await suite.db
      .insert(deviceProfiles)
      .values({ name: "Shared tills", formFactor: "till" })
      .returning({ id: deviceProfiles.id });
    await suite.db.insert(deviceProfileCardReaders).values([
      { deviceProfileId: profile!.id, readerId: first, position: 0, isDefault: true },
      { deviceProfileId: profile!.id, readerId: second, position: 1 },
      { deviceProfileId: profile!.id, readerId: unused, position: 2 },
    ]);
    const rows = await suite.db
      .insert(devices)
      .values([
        {
          locationId: venue.locationId,
          deviceProfileId: profile!.id,
          label: "Terrace till",
          tokenHash: "a",
        },
        {
          locationId: venue.locationId,
          deviceProfileId: profile!.id,
          label: "Bar till",
          tokenHash: "b",
        },
        {
          locationId: venue.locationId,
          deviceProfileId: profile!.id,
          label: "Own choice",
          tokenHash: "c",
        },
        {
          locationId: venue.locationId,
          deviceProfileId: profile!.id,
          label: "Disabled till",
          tokenHash: "d",
          active: false,
        },
      ])
      .returning({ id: devices.id, label: devices.label });
    await suite.db.insert(deviceCardReaders).values({
      deviceId: rows.find((row) => row.label === "Own choice")!.id,
      readerId: second,
    });
    const response = await send(app, "GET", "/management-api/payments/readers", {
      cookie: venue.managerCookie,
    });
    expect(response.status).toBe(200);
    const listed = (await response.json()) as {
      id: string;
      deviceCount: number;
      deviceNames: string[];
    }[];
    expect(listed.find((row) => row.id === first)).toMatchObject({
      deviceCount: 2,
      deviceNames: ["Bar till", "Terrace till"],
    });
    expect(listed.find((row) => row.id === second)).toMatchObject({
      deviceCount: 1,
      deviceNames: ["Own choice"],
    });
    expect(listed.find((row) => row.id === unused)).toMatchObject({
      deviceCount: 0,
      deviceNames: [],
    });
  });

  it("does not repeat a device whose explicit reader is also its profile default", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    const readerId = randomUUID();
    await suite.db
      .insert(cardReaders)
      .values({ id: readerId, provider: "stripe", providerRef: nextRef(), name: "One reader" });
    const deviceId = await seedDevice(venue);
    await suite.db.update(devices).set({ label: "Counter" }).where(eq(devices.id, deviceId));
    await listOnProfile(deviceId, readerId);
    await suite.db.update(deviceProfileCardReaders).set({ isDefault: true });
    await suite.db.insert(deviceCardReaders).values({ deviceId, readerId });
    const response = await send(app, "GET", "/management-api/payments/readers", {
      cookie: venue.managerCookie,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        id: readerId,
        provider: "stripe",
        name: "One reader",
        active: true,
        canEnable: true,
        deviceCount: 1,
        deviceNames: ["Counter"],
      },
    ]);
  });

  it("refuses the reader-name list without a manager's permission", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    for (const [cookie, status, code] of [
      [undefined, 401, "management_session.required"],
      [venue.staffCookie, 403, "authorization.not_permitted"],
    ] as const) {
      const response = await send(app, "GET", "/management-api/payments/readers", { cookie });
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
  });

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
    await listOnProfile(device, readerId);
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

describe("device's chosen reader — screens", () => {
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
  function mountAppWithFetch(venue: Venue): Hono {
    const app = new Hono();
    mountPaymentsApi(
      app,
      {
        db: suite.db,
        ...saleDeps(),
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
    // Pause the add inside its provider round-trip (outside any transaction), disconnect, resume.
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
        ...saleDeps(),
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
        ...saleDeps(),
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
    expect(first.status).toBe(502);

    const retry = await send(app, "POST", `/management-api/payments/readers/${reader.id}/unpair`, {
      cookie: venue.managerCookie,
    });
    expect(retry.status).toBe(204);
    // The vendor removal was re-attempted on the retry (2 calls total) and succeeded.
    expect(removes).toBe(2);
  });
});

describe("unpair reader — a failed provider call answers as Delete does", () => {
  const base = "/management-api/payments";

  function mountLogged(
    venue: Venue,
    providers: readonly CardProviderContribution[],
    fetchImpl?: typeof fetch,
  ): { app: Hono; lines: { level: string; event: string; fields: Record<string, unknown> }[] } {
    const lines: { level: string; event: string; fields: Record<string, unknown> }[] = [];
    const app = new Hono();
    mountPaymentsApi(
      app,
      {
        db: suite.db,
        ...saleDeps(),
        cfg: cfgOf(venue),
        ring: RING,
        environment: "preproduction",
        pool,
        providers,
        ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
      },
      (level, event, fields) => lines.push({ level, event, fields: fields ?? {} }),
    );
    return { app, lines };
  }

  function failingSeat(error: unknown): CardProviderContribution {
    return {
      ...stripeSeat,
      readers: {
        ...stripeSeat.readers,
        canUnpair: true,
        remove: async () => {
          throw error;
        },
      },
    };
  }

  async function pairedStripeReader(app: Hono, venue: Venue): Promise<string> {
    expect((await connectStripe(app, venue)).status).toBe(200);
    const added = await addReader(app, venue, nextRef());
    expect(added.status).toBe(201);
    return ((await added.json()) as { id: string }).id;
  }

  async function activeOf(id: string): Promise<boolean> {
    const [row] = await suite.db.select().from(cardReaders).where(eq(cardReaders.id, id));
    return row!.active;
  }

  it("answers reader.provider_disconnected when the seat finds no credential during the call", async () => {
    const venue = await seedVenue();
    const { app } = mountLogged(venue, [
      failingSeat(new AppError("credentials.missing", { purpose: "payments.stripe" })),
    ]);
    const id = await pairedStripeReader(app, venue);

    const res = await send(app, "POST", `${base}/readers/${id}/unpair`, {
      cookie: venue.managerCookie,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "reader.provider_disconnected", params: { providerId: "stripe" } },
    });
    expect(await activeOf(id)).toBe(true);
  });

  it("answers reader.unpair_failed for a provider fault, leaving the reader as it was", async () => {
    const venue = await seedVenue();
    const { app, lines } = mountLogged(venue, [failingSeat(new Error("outage"))]);
    const id = await pairedStripeReader(app, venue);

    const res = await send(app, "POST", `${base}/readers/${id}/unpair`, {
      cookie: venue.managerCookie,
    });

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: { code: "reader.unpair_failed", params: { providerId: "stripe" } },
    });
    expect(lines.filter((l) => l.event === "reader.unpair_failed")).toEqual([
      expect.objectContaining({
        level: "warn",
        fields: expect.objectContaining({ logReason: "unknown" }),
      }),
    ]);
    expect(await activeOf(id)).toBe(true);
  });

  it("passes a provider's own refusal through unwrapped", async () => {
    const venue = await seedVenue();
    const { app } = mountLogged(venue, [
      failingSeat(new AppError("payment.provider_credential_rejected", { providerId: "stripe" })),
    ]);
    const id = await pairedStripeReader(app, venue);

    const res = await send(app, "POST", `${base}/readers/${id}/unpair`, {
      cookie: venue.managerCookie,
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: { code: "payment.provider_credential_rejected", params: { providerId: "stripe" } },
    });
  });

  describe("through the real SumUp client", () => {
    /** SumUp's API as far as connect, pair and unpair reach it; `onDelete` answers the unpair. */
    function sumupFetch(onDelete: () => Promise<Response>): typeof fetch {
      return async (input, init) => {
        const url = new URL(typeof input === "string" ? input : (input as Request).url);
        const method = init?.method ?? "GET";
        if (method === "GET" && url.pathname === "/v0.1/memberships")
          return Response.json({ items: [{ resource_id: "MC", resource: { name: "Bar" } }] });
        if (method === "POST" && url.pathname === "/v0.1/merchants/MC/readers")
          return Response.json({ id: "rdr_1", status: "paired" });
        if (method === "DELETE" && url.pathname === "/v0.1/merchants/MC/readers/rdr_1")
          return onDelete();
        return new Response(null, { status: 404 });
      };
    }

    async function unpairLogReason(
      route: "unpair" | "delete",
      onDelete: () => Promise<Response>,
    ): Promise<{ status: number; body: unknown; reasons: unknown[] }> {
      const venue = await seedVenue();
      const { app, lines } = mountLogged(venue, [SUMUP_CARD_PROVIDER], sumupFetch(onDelete));
      const connected = await send(app, "POST", `${base}/providers/sumup/connect`, {
        cookie: venue.managerCookie,
        body: { apiKey: "sup_sk_test" },
      });
      expect(connected.status).toBe(200);
      const added = await send(app, "POST", `${base}/readers`, {
        cookie: venue.managerCookie,
        body: { providerId: "sumup", name: "Barra", code: "ABC123" },
      });
      expect(added.status).toBe(201);
      const { id } = (await added.json()) as { id: string };

      const res =
        route === "unpair"
          ? await send(app, "POST", `${base}/readers/${id}/unpair`, { cookie: venue.managerCookie })
          : await send(app, "DELETE", `${base}/readers/${id}`, { cookie: venue.managerCookie });
      return {
        status: res.status,
        body: await res.json(),
        reasons: lines
          .filter((l) => l.event === "reader.unpair_failed")
          .map((l) => l.fields.logReason),
      };
    }

    const unpairFailed = {
      error: { code: "reader.unpair_failed", params: { providerId: "sumup" } },
    };

    it.each([
      ["a refused key (401)", 401, "credential_rejected"],
      ["a refused key (403)", 403, "credential_rejected"],
      ["an outage (503)", 503, "provider_unavailable"],
      ["another refusal (429)", 429, "http_429"],
    ])("logs %s on Unpair with its own reason", async (_label, status, reason) => {
      const result = await unpairLogReason("unpair", async () =>
        Response.json({ title: "Refused" }, { status }),
      );
      expect(result).toEqual({ status: 502, body: unpairFailed, reasons: [reason] });
    });

    it("logs a refused key on Unpair as credential_rejected when the answer is an HTML page", async () => {
      const result = await unpairLogReason(
        "unpair",
        async () =>
          new Response("<html><body>Unauthorized</body></html>", {
            status: 401,
            headers: { "content-type": "text/html" },
          }),
      );
      expect(result).toEqual({ status: 502, body: unpairFailed, reasons: ["credential_rejected"] });
    });

    it("logs a dropped connection on Unpair as unreachable", async () => {
      const result = await unpairLogReason("unpair", async () => {
        throw new TypeError("fetch failed");
      });
      expect(result).toEqual({ status: 502, body: unpairFailed, reasons: ["unreachable"] });
    });

    it("logs the same reasons on Delete", async () => {
      const result = await unpairLogReason("delete", async () =>
        Response.json({ title: "Unauthorized" }, { status: 401 }),
      );
      expect(result).toEqual({ status: 502, body: unpairFailed, reasons: ["credential_rejected"] });
    });
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

  it("labels available, added and disabled and reuses the disabled id and the device's chosen reader", async () => {
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
    await listOnProfile(device, id);
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
    // `dated` is derived in JavaScript: `disabled_at is not null` in SQL would come back as 0/1.
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

  it("adopting a deleted reader's provider id creates a new reader and leaves the deleted row as it was", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue, [discoverySeat(async () => [vendor])]);
    await connectStripe(app, venue);
    const opts = { cookie: venue.managerCookie };
    const first = await send(app, "POST", `${base}/readers/adopt`, { ...opts, body: adoption });
    expect(first.status).toBe(201);
    const { id: oldId } = (await first.json()) as { id: string };
    await suite.db
      .update(cardReaders)
      .set({ active: false, deletedAt: "2026-10-10T10:00:00.000Z" })
      .where(eq(cardReaders.id, oldId));
    const before = await suite.db.select().from(cardReaders).where(eq(cardReaders.id, oldId));
    const again = await send(app, "POST", `${base}/readers/adopt`, {
      ...opts,
      body: { ...adoption, name: "Terrace" },
    });
    expect(again.status).toBe(201);
    const { id: newId } = (await again.json()) as { id: string };
    expect(newId).not.toBe(oldId);
    expect(await suite.db.select().from(cardReaders).where(eq(cardReaders.id, oldId))).toEqual(
      before,
    );
    expect(
      await suite.db
        .select({ name: cardReaders.name, active: cardReaders.active })
        .from(cardReaders)
        .where(eq(cardReaders.id, newId)),
    ).toEqual([{ name: "Terrace", active: true }]);
  });

  it("drizzle 0.45 prints a conflict target's targetWhere before do update", async () => {
    await withTransaction(suite.db, async (tx) => {
      const statement = tx
        .insert(cardReaders)
        .values({ provider: "stripe", providerRef: "tmr_x", name: "Counter" })
        .onConflictDoUpdate({
          target: [cardReaders.provider, cardReaders.providerRef],
          targetWhere: isNull(cardReaders.deletedAt),
          set: { name: "Counter", active: true, disabledAt: null, unpairedAt: null },
        });
      expect(statement.toSQL().sql).toContain(
        'on conflict ("card_readers"."provider", "card_readers"."provider_ref") ' +
          'where "card_readers"."deleted_at" is null do update set',
      );
    });
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
      {
        id,
        provider: "stripe",
        name: "Barra 1",
        active: false,
        canEnable: false,
        deviceCount: 0,
        deviceNames: [],
      },
    ]);
    paired = true;
    const adopted = await send(app, "POST", `${base}/readers/adopt`, { ...opts, body: adoption });
    expect(await adopted.json()).toEqual({ id, status: "paired" });
    expect((await send(app, "POST", `${base}/readers/${id}/disable`, opts)).status).toBe(204);
    expect((await send(app, "POST", `${base}/readers/${id}/enable`, opts)).status).toBe(204);
    expect(listings).toBe(1);
    expect(await (await send(app, "GET", `${base}/readers`, opts)).json()).toEqual([
      {
        id,
        provider: "stripe",
        name: "Counter",
        active: true,
        canEnable: true,
        deviceCount: 0,
        deviceNames: [],
      },
    ]);
  });

  it("does not enable across a committed unpair the request never saw", async () => {
    // The enable is issued while the unpair's write transaction is still open, so it is serialised
    // behind it and must read the committed `unpaired_at`. This pins the outcome, not an overlap.
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

describe("screens and unknown ids", () => {
  it("refuses a connect form value that is not a string, naming the field, and seals nothing", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    const res = await send(app, "POST", "/management-api/payments/providers/stripe/connect", {
      cookie: venue.managerCookie,
      body: { ...GOOD_KEY, webhookSecret: 42 },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "webhookSecret" } },
    });
    expect(await sealedStripe()).toBeNull();
  });

  it.each([
    ["PATCH", "", { name: "Nuevo" }],
    ["POST", "/disable", undefined],
    ["POST", "/enable", undefined],
    ["POST", "/unpair", undefined],
    ["GET", "/status", undefined],
  ] as const)(
    "404s %s on an unknown reader%s with reader.not_found",
    async (method, suffix, body) => {
      const venue = await seedVenue();
      const app = mountApp(venue);
      await connectStripe(app, venue);
      const id = randomUUID();
      const res = await send(app, method, `/management-api/payments/readers/${id}${suffix}`, {
        cookie: venue.managerCookie,
        ...(body === undefined ? {} : { body }),
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: { code: "reader.not_found", params: { id } } });
    },
  );

  it("hands the seat a pairing code without a reference when only a code is given", async () => {
    const venue = await seedVenue();
    const calls: unknown[] = [];
    const seat: CardProviderContribution = {
      ...stripeSeat,
      readers: {
        ...stripeSeat.readers,
        add: async (_deps, input) => {
          calls.push(input);
          return { providerRef: nextRef(), status: "paired" as const };
        },
      },
    };
    const app = mountApp(venue, [seat]);
    await connectStripe(app, venue);
    const res = await send(app, "POST", "/management-api/payments/readers", {
      cookie: venue.managerCookie,
      body: { providerId: "stripe", name: "Barra 2", code: "PAIR-123" },
    });
    expect(res.status).toBe(201);
    expect(calls).toEqual([{ name: "Barra 2", code: "PAIR-123" }]);
  });

  it("still refuses a mid-add disconnect when the best-effort vendor unpair itself fails", async () => {
    const venue = await seedVenue();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const hold = new Promise<void>((r) => {
      release = r;
    });
    let removeAttempts = 0;
    const seat: CardProviderContribution = {
      ...stripeSeat,
      readers: {
        ...stripeSeat.readers,
        add: async () => {
          entered();
          await hold;
          return { providerRef: nextRef(), status: "paired" as const };
        },
        remove: async () => {
          removeAttempts += 1;
          throw new Error("vendor unreachable");
        },
      },
    };
    const app = mountApp(venue, [seat]);
    expect((await connectStripe(app, venue)).status).toBe(200);
    const adding = send(app, "POST", "/management-api/payments/readers", {
      cookie: venue.managerCookie,
      body: { providerId: "stripe", name: "Barra 1", reference: nextRef() },
    });
    await started;
    const disconnected = await send(
      app,
      "POST",
      "/management-api/payments/providers/stripe/disconnect",
      { cookie: venue.managerCookie },
    );
    release();
    const added = await adding;
    expect(disconnected.status).toBe(204);
    expect(added.status).toBe(409);
    expect(await added.json()).toEqual({
      error: { code: "reader.provider_disconnected", params: { providerId: "stripe" } },
    });
    expect(removeAttempts).toBe(1);
    expect(await suite.db.select({ id: cardReaders.id }).from(cardReaders)).toEqual([]);
  });

  it("refuses a chosen reader for an unknown device, or naming an unknown or disabled reader", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    await connectStripe(app, venue);
    const readerId = ((await (await addReader(app, venue, nextRef())).json()) as { id: string }).id;
    const device = await seedDevice(venue);
    await listOnProfile(device, readerId);
    const put = (deviceId: string, body: unknown) =>
      send(app, "PUT", `/management-api/payments/devices/${deviceId}/reader`, {
        cookie: venue.managerCookie,
        body,
      });

    const unknownDevice = randomUUID();
    const noDevice = await put(unknownDevice, { readerId });
    expect(noDevice.status).toBe(404);
    expect(await noDevice.json()).toEqual({
      error: { code: "device.not_found", params: { deviceId: unknownDevice } },
    });

    const unknownReader = randomUUID();
    const noReader = await put(device, { readerId: unknownReader });
    expect(noReader.status).toBe(404);
    expect(await noReader.json()).toEqual({
      error: { code: "reader.not_found", params: { id: unknownReader } },
    });

    expect(
      (
        await send(app, "POST", `/management-api/payments/readers/${readerId}/disable`, {
          cookie: venue.managerCookie,
        })
      ).status,
    ).toBe(204);
    const disabled = await put(device, { readerId });
    expect(disabled.status).toBe(400);
    expect(await disabled.json()).toEqual({
      error: { code: "device.binding_invalid", params: { field: "cardReaderId" } },
    });

    const read = await send(app, "GET", `/management-api/payments/devices/${device}/reader`, {
      cookie: venue.managerCookie,
    });
    expect(await read.json()).toEqual({ readerId: null });
  });
});

describe("reader delete", () => {
  const base = "/management-api/payments";
  type Remove = CardProviderContribution["readers"]["remove"];

  /** The Stripe seat able to unpair, its `remove` recording each provider id it was asked to drop. */
  function unpairingSeat(onRemove: (providerRef: string) => Promise<void> = async () => {}): {
    seat: CardProviderContribution;
    removed: string[];
  } {
    const removed: string[] = [];
    const remove: Remove = async (_deps, providerRef) => {
      removed.push(providerRef);
      await onRemove(providerRef);
    };
    return {
      seat: { ...stripeSeat, readers: { ...stripeSeat.readers, canUnpair: true, remove } },
      removed,
    };
  }

  async function readerRow(id: string) {
    const [row] = await suite.db.select().from(cardReaders).where(eq(cardReaders.id, id));
    return row!;
  }

  /** Every row in the three link tables naming the reader. */
  async function linksOf(readerId: string) {
    return {
      chosen: await suite.db
        .select()
        .from(deviceCardReaders)
        .where(eq(deviceCardReaders.readerId, readerId)),
      listed: await suite.db
        .select()
        .from(deviceProfileCardReaders)
        .where(eq(deviceProfileCardReaders.readerId, readerId)),
      held: await suite.db
        .select()
        .from(cardReaderHolders)
        .where(eq(cardReaderHolders.readerId, readerId)),
    };
  }

  /** A device that lists, chooses and holds the reader: one row in each link table. */
  async function linkReader(venue: Venue, readerId: string): Promise<string> {
    const device = await seedDevice(venue);
    await listOnProfile(device, readerId);
    await suite.db.insert(deviceCardReaders).values({ deviceId: device, readerId });
    await suite.db.insert(cardReaderHolders).values({ readerId, deviceId: device });
    return device;
  }

  let orderNumber = 0;
  /** An `attempting` payment on the reader, through the table rather than a pay route. */
  async function startPayment(venue: Venue, readerId: string): Promise<string> {
    orderNumber += 1;
    const [order] = await suite.db
      .insert(workingOrders)
      .values({ source: "dashboard", locationId: venue.locationId, orderNumber })
      .returning({ id: workingOrders.id });
    const [payment] = await suite.db
      .insert(payments)
      .values({
        workingOrderId: order!.id,
        source: "device",
        deviceId: await seedDevice(venue),
        readerId,
        provider: "stripe",
        paymentRef: randomUUID(),
        amount: 500,
        state: "attempting",
      })
      .returning({ id: payments.id });
    return payment!.id;
  }

  async function pairedReader(app: Hono, venue: Venue): Promise<{ id: string; ref: string }> {
    expect((await connectStripe(app, venue)).status).toBe(200);
    const ref = nextRef();
    const added = await addReader(app, venue, ref);
    expect(added.status).toBe(201);
    return { id: ((await added.json()) as { id: string }).id, ref };
  }

  const impactOf = (app: Hono, venue: Venue, id: string) =>
    send(app, "GET", `${base}/readers/${id}/delete-impact`, { cookie: venue.managerCookie });
  const deleteOf = (app: Hono, venue: Venue, id: string) =>
    send(app, "DELETE", `${base}/readers/${id}`, { cookie: venue.managerCookie });
  const deleteAccepting = (app: Hono, venue: Venue, id: string) =>
    send(app, "DELETE", `${base}/readers/${id}?acceptRegistrationKept=true`, {
      cookie: venue.managerCookie,
    });
  const kept = {
    key: "provider_registration_kept",
    count: 1,
    targets: [{ id: "stripe", name: "stripe" }],
  };
  /** Paired, then disabled and its provider disconnected: disconnect refuses while it is active. */
  async function disconnectedReader(app: Hono, venue: Venue) {
    const paired = await pairedReader(app, venue);
    const opts = { cookie: venue.managerCookie };
    expect((await send(app, "POST", `${base}/readers/${paired.id}/disable`, opts)).status).toBe(
      204,
    );
    expect((await send(app, "POST", `${base}/providers/stripe/disconnect`, opts)).status).toBe(204);
    return paired;
  }

  it("refuses a caller without payments.manage, a malformed id, an unknown id and the demo reader, changing nothing", async () => {
    const venue = await seedVenue();
    const { seat, removed } = unpairingSeat();
    const app = mountApp(venue, [seat]);
    const { id } = await pairedReader(app, venue);
    await linkReader(venue, id);
    const row = await readerRow(id);
    const links = await linksOf(id);
    const unknown = randomUUID();

    for (const [method, path] of [
      ["GET", `${base}/readers/${id}/delete-impact`],
      ["DELETE", `${base}/readers/${id}`],
    ] as const) {
      const staff = await send(app, method, path, { cookie: venue.staffCookie });
      expect(staff.status).toBe(403);
      expect(await staff.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
      const anonymous = await send(app, method, path);
      expect(anonymous.status).toBe(401);
      expect(await anonymous.json()).toMatchObject({
        error: { code: "management_session.required" },
      });
    }
    for (const [method, suffix] of [
      ["GET", "/delete-impact"],
      ["DELETE", ""],
    ] as const) {
      const malformed = await send(app, method, `${base}/readers/not-a-uuid${suffix}`, {
        cookie: venue.managerCookie,
      });
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toMatchObject({ error: { code: "shared.invalid_id" } });
      for (const missing of [unknown, DEMO_READER_ID]) {
        const res = await send(app, method, `${base}/readers/${missing}${suffix}`, {
          cookie: venue.managerCookie,
        });
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({
          error: { code: "reader.not_found", params: { id: missing } },
        });
      }
    }

    expect(await readerRow(id)).toEqual(row);
    expect(await linksOf(id)).toEqual(links);
    expect(removed).toEqual([]);
  });

  it("switches a paired reader off before the provider is called, unpairs it there, then deletes it and its links", async () => {
    const venue = await seedVenue();
    // Shows the order only: a read from inside a transaction's body sees its uncommitted rows, so
    // the outage case below is the one that shows the switch-off is committed first.
    const seen: { active: boolean; deletedAt: string | null }[] = [];
    const { seat, removed } = unpairingSeat(async () => {
      const row = await readerRow(id);
      seen.push({ active: row.active, deletedAt: row.deletedAt });
    });
    const app = mountApp(venue, [seat]);
    const { id, ref } = await pairedReader(app, venue);
    await linkReader(venue, id);

    const impact = await impactOf(app, venue, id);
    expect(impact.status).toBe(200);
    expect(((await impact.json()) as { ends: unknown }).ends).toEqual([
      { key: "provider_pairing", count: 1, targets: [{ id: "stripe", name: "stripe" }] },
    ]);

    const deleted = await deleteOf(app, venue, id);
    expect(deleted.status).toBe(200);
    expect(removed).toEqual([ref]);
    expect(seen).toEqual([{ active: false, deletedAt: null }]);
    const row = await readerRow(id);
    expect(row.active).toBe(false);
    expect(row.deletedAt).not.toBeNull();
    expect(row.unpairedAt).not.toBeNull();
    expect(await linksOf(id)).toEqual({ chosen: [], listed: [], held: [] });

    const again = await deleteOf(app, venue, id);
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ error: { code: "reader.not_found", params: { id } } });
    expect(removed).toEqual([ref]);
  });

  it("answers reader.unpair_failed when the provider call fails, the switch-off before it committed and the reader not deleted", async () => {
    const venue = await seedVenue();
    const { seat, removed } = unpairingSeat(async () => {
      throw new Error("outage");
    });
    const app = mountApp(venue, [seat]);
    const { id } = await pairedReader(app, venue);
    await linkReader(venue, id);
    const before = await readerRow(id);
    const links = await linksOf(id);

    const res = await deleteOf(app, venue, id);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: { code: "reader.unpair_failed", params: { providerId: "stripe" } },
    });
    expect(removed).toHaveLength(1);
    const after = await readerRow(id);
    expect(after.disabledAt).not.toBeNull();
    expect(after).toEqual({ ...before, active: false, disabledAt: after.disabledAt });
    expect(after.unpairedAt).toBeNull();
    expect(after.deletedAt).toBeNull();
    expect(await linksOf(id)).toEqual(links);
  });

  it("passes a provider's own refusal through unwrapped", async () => {
    const venue = await seedVenue();
    const { seat } = unpairingSeat(async () => {
      throw new AppError("payment.provider_credential_rejected", { providerId: "stripe" });
    });
    const app = mountApp(venue, [seat]);
    const { id } = await pairedReader(app, venue);

    const res = await deleteOf(app, venue, id);

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: { code: "payment.provider_credential_rejected", params: { providerId: "stripe" } },
    });
    expect((await readerRow(id)).deletedAt).toBeNull();
  });

  it("deletes a still-paired reader in Waitron only once its provider is disconnected, and only when the delete accepts the notice", async () => {
    const venue = await seedVenue();
    const { seat, removed } = unpairingSeat();
    const app = mountApp(venue, [seat]);
    const { id } = await disconnectedReader(app, venue);
    await linkReader(venue, id);
    const row = await readerRow(id);
    const links = await linksOf(id);

    const impact = (await (await impactOf(app, venue, id)).json()) as DeleteImpact;
    expect(impact.refusals).toEqual([]);
    expect(impact.ends).toEqual([kept]);

    const refused = await deleteOf(app, venue, id);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      error: { code: "reader.provider_disconnected", params: { providerId: "stripe" } },
    });
    expect(removed).toEqual([]);
    expect(await readerRow(id)).toEqual(row);
    expect(await linksOf(id)).toEqual(links);

    const deleted = await deleteAccepting(app, venue, id);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual(impact);
    expect(removed).toEqual([]);
    const after = await readerRow(id);
    expect(after).toEqual({ ...row, active: false, deletedAt: after.deletedAt });
    expect(after.deletedAt).not.toBeNull();
    expect(after.unpairedAt).toBeNull();
    expect(await linksOf(id)).toEqual({ chosen: [], listed: [], held: [] });
  });

  it("unpairs at the provider as normal when it was connected again after the notice was shown", async () => {
    const venue = await seedVenue();
    const { seat, removed } = unpairingSeat();
    const app = mountApp(venue, [seat]);
    const { id, ref } = await disconnectedReader(app, venue);
    expect(((await (await impactOf(app, venue, id)).json()) as DeleteImpact).ends).toEqual([kept]);
    expect((await connectStripe(app, venue)).status).toBe(200);

    const res = await deleteAccepting(app, venue, id);

    expect(res.status).toBe(200);
    expect(removed).toEqual([ref]);
    const row = await readerRow(id);
    expect(row.deletedAt).not.toBeNull();
    expect(row.unpairedAt).not.toBeNull();
  });

  it("answers reader.unpair_failed when a connected provider's call fails, even with the notice accepted", async () => {
    const venue = await seedVenue();
    const { seat, removed } = unpairingSeat(async () => {
      throw new Error("sumup DELETE reader: HTTP 401");
    });
    const app = mountApp(venue, [seat]);
    const { id } = await pairedReader(app, venue);
    const before = await readerRow(id);

    const res = await deleteAccepting(app, venue, id);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: { code: "reader.unpair_failed", params: { providerId: "stripe" } },
    });
    expect(removed).toHaveLength(1);
    const after = await readerRow(id);
    expect(after).toEqual({ ...before, active: false, disabledAt: after.disabledAt });
    expect(after.disabledAt).not.toBeNull();
    expect(after.deletedAt).toBeNull();
    expect(after.unpairedAt).toBeNull();
  });

  it("refuses a malformed acceptance flag, changing nothing", async () => {
    const venue = await seedVenue();
    const { seat, removed } = unpairingSeat();
    const app = mountApp(venue, [seat]);
    const { id } = await disconnectedReader(app, venue);
    const row = await readerRow(id);

    const res = await send(app, "DELETE", `${base}/readers/${id}?acceptRegistrationKept=yes`, {
      cookie: venue.managerCookie,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "acceptRegistrationKept" } },
    });
    expect(removed).toEqual([]);
    expect(await readerRow(id)).toEqual(row);
  });

  it("checks and deletes in one transaction when no provider is called, so a connect during the delete cannot answer reader.unpair_failed", async () => {
    const venue = await seedVenue();
    const { seat, removed } = unpairingSeat();
    // Runs `afterLock` once, after the next write lock the app's requests release.
    let afterLock: (() => Promise<void>) | undefined;
    const db = new Proxy(suite.db, {
      get(target, prop) {
        if (prop === "withWriteLock")
          return async <T>(fn: () => Promise<T>): Promise<T> => {
            const value = await target.withWriteLock(fn);
            const hook = afterLock;
            afterLock = undefined;
            await hook?.();
            return value;
          };
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const app = mountApp(venue, [seat], db);
    const { id } = await disconnectedReader(app, venue);
    afterLock = async () => {
      expect((await connectStripe(app, venue)).status).toBe(200);
    };

    const res = await deleteAccepting(app, venue, id);

    expect(afterLock).toBeUndefined();
    expect(res.status).toBe(200);
    expect(removed).toEqual([]);
    const row = await readerRow(id);
    expect(row.deletedAt).not.toBeNull();
    expect(row.unpairedAt).toBeNull();
  });

  it("answers reader.provider_disconnected when the provider is disconnected after the reader was switched off, then deletes in Waitron only once accepted", async () => {
    const venue = await seedVenue();
    let first = true;
    const { seat, removed } = unpairingSeat(async () => {
      if (!first) return;
      first = false;
      // No reader of this provider is active now, so the disconnect is allowed.
      expect(
        (
          await send(app, "POST", `${base}/providers/stripe/disconnect`, {
            cookie: venue.managerCookie,
          })
        ).status,
      ).toBe(204);
      await withTransaction(suite.db, (tx) =>
        getCredential(tx, RING, { purpose: stripeSeat.credentialPurpose }),
      );
    });
    const app = mountApp(venue, [seat]);
    const { id } = await pairedReader(app, venue);
    await linkReader(venue, id);
    const links = await linksOf(id);

    const res = await deleteOf(app, venue, id);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "reader.provider_disconnected", params: { providerId: "stripe" } },
    });
    const row = await readerRow(id);
    expect(row.active).toBe(false);
    expect(row.unpairedAt).toBeNull();
    expect(row.deletedAt).toBeNull();
    expect(await linksOf(id)).toEqual(links);
    expect(((await (await impactOf(app, venue, id)).json()) as DeleteImpact).ends).toEqual([kept]);

    expect((await deleteAccepting(app, venue, id)).status).toBe(200);
    expect(removed).toHaveLength(1);
    expect((await readerRow(id)).deletedAt).not.toBeNull();
  });

  it("deletes a reader already unpaired through Unpair without the provider, even once disconnected", async () => {
    const venue = await seedVenue();
    const { seat, removed } = unpairingSeat();
    const app = mountApp(venue, [seat]);
    const { id, ref } = await pairedReader(app, venue);
    const opts = { cookie: venue.managerCookie };
    expect((await send(app, "POST", `${base}/readers/${id}/unpair`, opts)).status).toBe(204);
    expect((await send(app, "POST", `${base}/providers/stripe/disconnect`, opts)).status).toBe(204);

    const res = await deleteOf(app, venue, id);

    expect(res.status).toBe(200);
    expect(removed).toEqual([ref]);
    expect((await readerRow(id)).deletedAt).not.toBeNull();
  });

  it("deletes a reader whose provider cannot unpair without marking it unpaired", async () => {
    const venue = await seedVenue();
    const app = mountApp(venue);
    const { id } = await pairedReader(app, venue);

    const res = await deleteOf(app, venue, id);

    expect(res.status).toBe(200);
    const row = await readerRow(id);
    expect(row.deletedAt).not.toBeNull();
    expect(row.unpairedAt).toBeNull();
  });

  it("refuses reader.payment_in_progress before calling the provider", async () => {
    const venue = await seedVenue();
    const { seat, removed } = unpairingSeat();
    const app = mountApp(venue, [seat]);
    const { id } = await pairedReader(app, venue);
    await startPayment(venue, id);
    const row = await readerRow(id);

    const res = await deleteOf(app, venue, id);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "reader.payment_in_progress", params: { readerId: id } },
    });
    expect(removed).toEqual([]);
    expect(await readerRow(id)).toEqual(row);
  });

  it("refuses a payment that starts during the provider call, leaving the reader unpaired and not deleted; a retry deletes without unpairing again", async () => {
    const venue = await seedVenue();
    let paymentId = "";
    const { seat, removed } = unpairingSeat(async () => {
      paymentId = await startPayment(venue, id);
    });
    const app = mountApp(venue, [seat]);
    const { id } = await pairedReader(app, venue);
    await linkReader(venue, id);
    const links = await linksOf(id);

    const refused = await deleteOf(app, venue, id);

    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      error: { code: "reader.payment_in_progress", params: { readerId: id } },
    });
    const row = await readerRow(id);
    expect(row.unpairedAt).not.toBeNull();
    expect(row.active).toBe(false);
    expect(row.deletedAt).toBeNull();
    expect(await linksOf(id)).toEqual(links);

    await suite.db.update(payments).set({ state: "failed" }).where(eq(payments.id, paymentId));
    expect((await deleteOf(app, venue, id)).status).toBe(200);
    expect(removed).toHaveLength(1);
  });

  it("answers the same impact from the read and the delete of an already-unpaired reader", async () => {
    const venue = await seedVenue();
    const { seat } = unpairingSeat();
    const app = mountApp(venue, [seat]);
    const { id } = await pairedReader(app, venue);
    await linkReader(venue, id);
    const opts = { cookie: venue.managerCookie };
    expect((await send(app, "POST", `${base}/readers/${id}/unpair`, opts)).status).toBe(204);

    const impact = await impactOf(app, venue, id);
    const deleted = await deleteOf(app, venue, id);

    expect(impact.status).toBe(200);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual(await impact.json());
  });

  it("deletes once when two deletes race", async () => {
    const venue = await seedVenue();
    const { seat, removed } = unpairingSeat();
    const app = mountApp(venue, [seat]);
    const { id, ref } = await pairedReader(app, venue);

    const statuses = (await Promise.all([deleteOf(app, venue, id), deleteOf(app, venue, id)])).map(
      (res) => res.status,
    );

    // The loser is refused while the winner holds the reader, or finds it deleted after.
    const [winner, loser] = statuses.sort();
    expect(winner).toBe(200);
    expect([404, 409]).toContain(loser);
    const row = await readerRow(id);
    expect(row.deletedAt).not.toBeNull();
    expect(row.unpairedAt).not.toBeNull();
    expect(removed).toEqual([ref]);
  });

  it("refuses Enable, Unpair, a second Delete and adopting its provider id while a delete is unpairing the reader; a failed unpair leaves it switched off", async () => {
    const venue = await seedVenue();
    const refused: { request: string; status: number; body: unknown }[] = [];
    let activeDuringCall: boolean | undefined;
    const { seat, removed } = unpairingSeat(async () => {
      if (removed.length > 1) return;
      activeDuringCall = (await readerRow(id)).active;
      for (const [method, path, body] of [
        ["POST", `${base}/readers/${id}/enable`, undefined],
        ["POST", `${base}/readers/${id}/unpair`, undefined],
        ["DELETE", `${base}/readers/${id}`, undefined],
        [
          "POST",
          `${base}/readers/adopt`,
          { providerId: "stripe", providerRef: ref, name: "Again" },
        ],
      ] as const) {
        const res = await send(app, method, path, { cookie: venue.managerCookie, body });
        refused.push({
          request: `${method} ${path}`,
          status: res.status,
          body: res.status === 204 ? null : await res.json(),
        });
      }
      throw new Error("outage");
    });
    const listing: CardProviderContribution = {
      ...seat,
      readers: {
        ...seat.readers,
        list: async () => [{ providerRef: ref, name: "Again", model: "solo" }],
      },
    };
    const app = mountApp(venue, [listing]);
    const { id, ref } = await pairedReader(app, venue);

    const res = await deleteOf(app, venue, id);

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: { code: "reader.unpair_failed" } });
    expect(activeDuringCall).toBe(false);
    const inProgress = { error: { code: "reader.unpair_in_progress", params: { readerId: id } } };
    expect(refused).toEqual([
      { request: `POST ${base}/readers/${id}/enable`, status: 409, body: inProgress },
      { request: `POST ${base}/readers/${id}/unpair`, status: 409, body: inProgress },
      { request: `DELETE ${base}/readers/${id}`, status: 409, body: inProgress },
      { request: `POST ${base}/readers/adopt`, status: 409, body: inProgress },
    ]);
    expect(removed).toEqual([ref]);
    const row = await readerRow(id);
    expect(row).toMatchObject({ active: false, deletedAt: null, unpairedAt: null });
    expect(row.disabledAt).not.toBeNull();
    expect(
      await suite.db
        .select({ id: cardReaders.id })
        .from(cardReaders)
        .where(eq(cardReaders.providerRef, ref)),
    ).toEqual([{ id }]);

    // The failed delete let go of the reader: Enable is served again.
    expect(
      (await send(app, "POST", `${base}/readers/${id}/enable`, { cookie: venue.managerCookie }))
        .status,
    ).toBe(204);
    expect((await readerRow(id)).active).toBe(true);
  });

  it("refuses a Delete while an Unpair of the reader is at its provider, calling the provider once", async () => {
    const venue = await seedVenue();
    let during: { status: number; body: unknown } | undefined;
    const { seat, removed } = unpairingSeat(async () => {
      if (removed.length > 1) return;
      const res = await deleteOf(app, venue, id);
      during = { status: res.status, body: await res.json() };
    });
    const app = mountApp(venue, [seat]);
    const { id, ref } = await pairedReader(app, venue);

    const unpaired = await send(app, "POST", `${base}/readers/${id}/unpair`, {
      cookie: venue.managerCookie,
    });

    expect(unpaired.status).toBe(204);
    expect(during).toEqual({
      status: 409,
      body: { error: { code: "reader.unpair_in_progress", params: { readerId: id } } },
    });
    expect(removed).toEqual([ref]);
    expect((await readerRow(id)).deletedAt).toBeNull();
    // Once the Unpair has finished, the delete is served without calling the provider again.
    expect((await deleteOf(app, venue, id)).status).toBe(200);
    expect(removed).toEqual([ref]);
  });

  for (const [action, drop] of [
    [
      "an Unpair",
      (app: Hono, venue: Venue, id: string) =>
        send(app, "POST", `${base}/readers/${id}/unpair`, { cookie: venue.managerCookie }),
    ],
    ["a Delete", deleteOf],
  ] as const) {
    it(`refuses adopting a provider id whose listing was taken before ${action} dropped it there, changing nothing`, async () => {
      const venue = await seedVenue();
      const { seat, removed } = unpairingSeat();
      let dropped: { status: number; row: typeof cardReaders.$inferSelect } | undefined;
      const listing: CardProviderContribution = {
        ...seat,
        readers: {
          ...seat.readers,
          list: async () => {
            const listed = [{ providerRef: ref, name: "My Reader", model: "solo" }];
            const res = await drop(app, venue, id);
            dropped = { status: res.status, row: await readerRow(id) };
            return listed;
          },
        },
      };
      const app = mountApp(venue, [listing]);
      const { id, ref } = await pairedReader(app, venue);

      const res = await send(app, "POST", `${base}/readers/adopt`, {
        cookie: venue.managerCookie,
        body: { providerId: "stripe", providerRef: ref, name: "Again" },
      });

      expect(dropped?.status).toBe(action === "a Delete" ? 200 : 204);
      expect(removed).toEqual([ref]);
      expect({ status: res.status, body: await res.json() }).toEqual({
        status: 422,
        body: { error: { code: "reader.not_listed", params: { providerId: "stripe" } } },
      });
      expect(
        await suite.db.select().from(cardReaders).where(eq(cardReaders.providerRef, ref)),
      ).toEqual([dropped!.row]);
      expect(dropped!.row).toMatchObject({ active: false });
      expect(dropped!.row.unpairedAt).not.toBeNull();
    });
  }

  describe("a deleted reader", () => {
    const vendorOf = (providerRef: string) => ({
      providerRef,
      name: "My Reader",
      model: "solo",
      serial: "serial-1",
    });

    /** A seat that can unpair and lists `listed()`, recording every `remove` and `status` call. */
    function spySeat(listed: () => string[] = () => []) {
      const removed: string[] = [];
      const statusAsked: string[] = [];
      const seat: CardProviderContribution = {
        ...stripeSeat,
        readers: {
          ...stripeSeat.readers,
          canUnpair: true,
          list: async () => listed().map(vendorOf),
          remove: async (_deps, providerRef) => {
            removed.push(providerRef);
          },
          status: async (deps, providerRef) => {
            statusAsked.push(providerRef);
            return stripeSeat.readers.status(deps, providerRef);
          },
        },
      };
      return { seat, removed, statusAsked };
    }

    /** A paired reader deleted through the DELETE route; the spies are emptied afterwards. */
    async function deletedReader(app: Hono, venue: Venue, spies: ReturnType<typeof spySeat>) {
      const { id, ref } = await pairedReader(app, venue);
      expect((await deleteOf(app, venue, id)).status).toBe(200);
      spies.removed.length = 0;
      spies.statusAsked.length = 0;
      return { id, ref, row: await readerRow(id) };
    }

    it("answers reader.not_found to rename, disable, enable, unpair and status, calling no provider and changing nothing", async () => {
      const venue = await seedVenue();
      const spies = spySeat();
      const app = mountApp(venue, [spies.seat]);
      const { id, row } = await deletedReader(app, venue, spies);

      for (const [method, path, body] of [
        ["PATCH", `${base}/readers/${id}`, { name: "Terrace" }],
        ["POST", `${base}/readers/${id}/disable`, undefined],
        ["POST", `${base}/readers/${id}/enable`, undefined],
        ["POST", `${base}/readers/${id}/unpair`, undefined],
        ["GET", `${base}/readers/${id}/status`, undefined],
      ] as const) {
        const res = await send(app, method, path, { cookie: venue.managerCookie, body });
        const text = await res.text();
        expect({
          route: `${method} ${path}`,
          status: res.status,
          body: text && JSON.parse(text),
        }).toEqual({
          route: `${method} ${path}`,
          status: 404,
          body: { error: { code: "reader.not_found", params: { id } } },
        });
      }

      expect(await readerRow(id)).toEqual(row);
      expect(spies.removed).toEqual([]);
      expect(spies.statusAsked).toEqual([]);
    });

    it("cannot be chosen for a device or put back on a profile's list, which stay as the delete left them", async () => {
      const venue = await seedVenue();
      const spies = spySeat();
      const app = mountApp(venue, [spies.seat]);
      const opts = { cookie: venue.managerCookie };
      const { id: kept } = await pairedReader(app, venue);
      const added = await addReader(app, venue, nextRef(), "Terraza");
      expect(added.status).toBe(201);
      const { id: doomed } = (await added.json()) as { id: string };
      const device = await seedDevice(venue);
      const [{ profileId }] = (await suite.db
        .select({ profileId: devices.deviceProfileId })
        .from(devices)
        .where(eq(devices.id, device))) as [{ profileId: string }];
      const profilePath = `${base}/device-profiles/${profileId}/readers`;
      const listed = await send(app, "PUT", profilePath, {
        ...opts,
        body: { readerIds: [kept, doomed], defaultReaderId: kept },
      });
      expect(listed.status).toBe(200);
      expect((await deleteOf(app, venue, doomed)).status).toBe(200);
      const afterDelete = { readerIds: [kept], defaultReaderId: kept };
      expect(await (await send(app, "GET", profilePath, opts)).json()).toEqual(afterDelete);

      const chosen = await send(app, "PUT", `${base}/devices/${device}/reader`, {
        ...opts,
        body: { readerId: doomed },
      });
      const relisted = await send(app, "PUT", profilePath, {
        ...opts,
        body: { readerIds: [kept, doomed], defaultReaderId: kept },
      });

      const notFound = { error: { code: "reader.not_found", params: { id: doomed } } };
      expect({ status: chosen.status, body: await chosen.json() }).toEqual({
        status: 404,
        body: notFound,
      });
      expect({ status: relisted.status, body: await relisted.json() }).toEqual({
        status: 404,
        body: notFound,
      });
      expect(
        await (await send(app, "GET", `${base}/devices/${device}/reader`, opts)).json(),
      ).toEqual({ readerId: null });
      expect(await (await send(app, "GET", profilePath, opts)).json()).toEqual(afterDelete);
      expect(await linksOf(doomed)).toEqual({ chosen: [], listed: [], held: [] });
    });

    it("is left out of the reader list, while a disabled reader stays in it switched off", async () => {
      const venue = await seedVenue();
      const spies = spySeat();
      const app = mountApp(venue, [spies.seat]);
      const opts = { cookie: venue.managerCookie };
      const { id: deleted } = await deletedReader(app, venue, spies);
      const added = await addReader(app, venue, nextRef(), "Terraza");
      const { id: disabled } = (await added.json()) as { id: string };
      expect((await send(app, "POST", `${base}/readers/${disabled}/disable`, opts)).status).toBe(
        204,
      );

      const list = (await (await send(app, "GET", `${base}/readers`, opts)).json()) as {
        id: string;
        active: boolean;
      }[];

      expect(list.map(({ id, active }) => ({ id, active }))).toEqual([
        { id: disabled, active: false },
      ]);
      expect(list.some(({ id }) => id === deleted)).toBe(false);
    });

    it("is offered by discovery as new, and adopting it makes a new record beside the deleted one", async () => {
      const venue = await seedVenue();
      let listed: string[] = [];
      const spies = spySeat(() => listed);
      const app = mountApp(venue, [spies.seat]);
      const opts = { cookie: venue.managerCookie };
      const { id, ref, row } = await deletedReader(app, venue, spies);
      listed = [ref];
      const available = async () =>
        (await send(app, "GET", `${base}/providers/stripe/available-readers`, opts)).json();

      expect(await available()).toEqual([{ ...vendorOf(ref), status: "available" }]);
      const adopted = await send(app, "POST", `${base}/readers/adopt`, {
        ...opts,
        body: { providerId: "stripe", providerRef: ref, name: "Counter" },
      });

      expect(adopted.status).toBe(201);
      const { id: newId } = (await adopted.json()) as { id: string };
      expect(newId).not.toBe(id);
      expect(await available()).toEqual([{ ...vendorOf(ref), status: "added" }]);
      expect(await readerRow(id)).toEqual(row);
      expect(row).toMatchObject({ active: false, name: "Barra 1" });
      expect(row.deletedAt).not.toBeNull();
      expect(row.unpairedAt).not.toBeNull();
      expect(spies.removed).toEqual([]);
    });

    it("never shadows a live reader with the same provider id in discovery, whichever row was written first", async () => {
      const venue = await seedVenue();
      const [deletedFirst, liveFirst] = [nextRef(), nextRef()];
      const spies = spySeat(() => [deletedFirst, liveFirst]);
      const app = mountApp(venue, [spies.seat]);
      expect((await connectStripe(app, venue)).status).toBe(200);
      const deletedRow = (providerRef: string) => ({
        provider: "stripe",
        providerRef,
        name: "Old",
        active: false,
        unpairedAt: "2026-10-10T09:00:00.000Z",
        deletedAt: "2026-10-10T10:00:00.000Z",
      });
      const liveRow = (providerRef: string) => ({ provider: "stripe", providerRef, name: "New" });
      for (const values of [
        deletedRow(deletedFirst),
        liveRow(deletedFirst),
        liveRow(liveFirst),
        deletedRow(liveFirst),
      ]) {
        await suite.db.insert(cardReaders).values(values);
      }

      const res = await send(app, "GET", `${base}/providers/stripe/available-readers`, {
        cookie: venue.managerCookie,
      });

      expect(await res.json()).toEqual([
        { ...vendorOf(deletedFirst), status: "added" },
        { ...vendorOf(liveFirst), status: "added" },
      ]);
    });

    it("deleted in Waitron only while disconnected, is offered by discovery as new once connected again", async () => {
      const venue = await seedVenue();
      let listed: string[] = [];
      const spies = spySeat(() => listed);
      const app = mountApp(venue, [spies.seat]);
      const opts = { cookie: venue.managerCookie };
      const { id, ref } = await disconnectedReader(app, venue);
      expect((await deleteAccepting(app, venue, id)).status).toBe(200);
      const row = await readerRow(id);
      expect((await connectStripe(app, venue)).status).toBe(200);
      listed = [ref];

      const available = await send(app, "GET", `${base}/providers/stripe/available-readers`, opts);
      expect(await available.json()).toEqual([{ ...vendorOf(ref), status: "available" }]);
      const adopted = await send(app, "POST", `${base}/readers/adopt`, {
        ...opts,
        body: { providerId: "stripe", providerRef: ref, name: "Counter" },
      });
      expect(adopted.status).toBe(201);
      expect(((await adopted.json()) as { id: string }).id).not.toBe(id);
      expect(await readerRow(id)).toEqual(row);
      expect(row.unpairedAt).toBeNull();
      expect(spies.removed).toEqual([]);
    });

    it("lets a new pairing take its provider id, as a new record", async () => {
      const venue = await seedVenue();
      const spies = spySeat();
      const app = mountApp(venue, [spies.seat]);
      const { id, ref, row } = await deletedReader(app, venue, spies);

      const again = await addReader(app, venue, ref, "Terraza");

      expect(again.status).toBe(201);
      const { id: newId } = (await again.json()) as { id: string };
      expect(newId).not.toBe(id);
      expect(await readerRow(id)).toEqual(row);
      expect(await readerRow(newId)).toMatchObject({ providerRef: ref, active: true });
    });
  });
});
