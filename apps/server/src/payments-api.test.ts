import { fixturePinHash } from "./testing/known-secret-hashes.js";
import { seedModuleSettings } from "../test/module-settings.js";
import { recordIncidentOnce } from "@waitron/core";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import {
  readActivityForSubject,
  persons,
  billPayments,
  devices,
  deviceProfiles,
  diningTables,
  nowIso,
  parties,
  partyTables,
  removeIdFromJson,
  taxpayer,
  withTransaction,
  saveSettings,
  type Database,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  seedDevice as seedDeviceRow,
  seedDeviceProfiles,
  seedNode,
  seedVenue,
  seedWorkingOrder,
  seedPerson,
  seedZone,
} from "@waitron/db/testing/seed.js";
import { registerModulePermissions, startManagementSession } from "@waitron/identity";
import { getCredential, loadKeyRing, tryGetCredential, type KeyRing } from "@waitron/credentials";
import { createStripeCardProvider, type MakeStripe } from "@waitron/payments-stripe";
import { SUMUP_CARD_PROVIDER } from "@waitron/payments-sumup";
import {
  PAYMENTS_PERMISSIONS,
  PAYMENTS_SETTINGS,
  readPaymentsSettings,
  SimulatorPaymentProvider,
  cardReaders,
  payments,
  reconciliationRuns,
  recordRefund,
  type CardProviderContribution,
} from "@waitron/payments";
import {
  decimal,
  deviceOrigin,
  jobOrigin,
  workingOrderId as brandWorkingOrderId,
  AppError,
  type DeleteImpact,
  nodeId as brandNodeId,
} from "@waitron/shared";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import { DEFAULT_DEVICE_PROFILES } from "@waitron/layouts";
import { mountPaymentsApi } from "./payments-api.js";
import { deleteDevice } from "./device-delete.js";
import { systemClock } from "./till-backend.js";
import type { CardProviderPool } from "./card-provider-pool.js";
import type { TradingContext } from "./trading-context.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import "./errors.js";

/**
 * The card-provider and card-reader management routes: the `hardware.manage` gate, credential
 * sealing, and reader add/adopt/unpair against fake provider seats.
 */
registerModulePermissions(PAYMENTS_PERMISSIONS);
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
  nodeId: string;
  managerCookie: string;
  staffCookie: string;
}

async function seedVenueWithStaff(): Promise<Venue> {
  // Through the table definition: `taxpayer.created_at` is a `$defaultFn` generator a raw insert never reaches.
  await suite.db
    .insert(taxpayer)
    .values({ id: 1, country: "ES", taxId: nextNif(), legalName: "Deli Test SL" });
  await seedVenue(suite.db, {
    name: "Barra",
    timeZone: "Europe/Madrid",
    invoiceLocales: ["es-ES"],
  });
  const writingNodeId = await seedNode(suite.db);
  const { managerSid, staffSid } = await withTransaction(suite.db, async (tx) => {
    const [mgr] = await seedPersons(tx, {
      displayName: "The Manager",
      pinHash: fixturePinHash("1234"),
      role: "manager",
    });
    const [stf] = await seedPersons(tx, {
      displayName: "The Clerk",
      pinHash: fixturePinHash("1234"),
      role: "staff",
    });
    const managerSession = await startManagementSession(tx, {
      method: "password",
      personId: mgr!.id,
    });
    const staffSession = await startManagementSession(tx, {
      method: "password",
      personId: stf!.id,
    });
    await setFreshManagementSignIn(tx, managerSession.token);
    return { managerSid: managerSession.token, staffSid: staffSession.token };
  });
  return {
    nodeId: writingNodeId,
    managerCookie: `${MANAGEMENT_COOKIE}=${managerSid}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${staffSid}`,
  };
}

async function seedDevice(): Promise<string> {
  const [profile] = await seedDeviceProfiles(suite.db, {
    name: nextName("Perfil caja"),
    formFactor: "till",
  });
  const { deviceId } = await seedDeviceRow(suite.db, {
    label: nextName("Registro"),
    profileId: profile!.id,
  });
  return deviceId;
}

/** Puts `readerId` on the list of the device's profile, so the device may choose it. */
async function listOnProfile(deviceId: string, readerId: string): Promise<void> {
  const [device] = await suite.db
    .select({ profileId: devices.deviceProfileId })
    .from(devices)
    .where(eq(devices.id, deviceId));
  await suite.db
    .update(deviceProfiles)
    .set({ cardReaders: { ids: [readerId], defaultId: null } })
    .where(eq(deviceProfiles.id, device!.profileId));
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
const PAIRING_POLL: CardProviderContribution["readerAdd"] = {
  kind: "pairing-poll",
  codeLabelKey: "payments.sumup.pairing_code",
};

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

function cfgOf(venue: Venue): TradingContext {
  return {
    nodeId: brandNodeId(venue.nodeId),
    locale: "es-ES",
    simplifiedInvoiceLimit: null,
  };
}

function mountApp(
  venue: Venue,
  providers: readonly CardProviderContribution[] = PROVIDERS,
  db: Database = suite.db,
  {
    log = noopLog,
    fetch,
    paymentsEnabled = true,
  }: { log?: Logger; fetch?: typeof globalThis.fetch; paymentsEnabled?: boolean } = {},
): Hono {
  const app = new Hono();
  mountPaymentsApi(
    app,
    {
      isPrimary: () => true,
      admission: testTradingAdmission(),
      db,
      ...saleDeps(),
      cfg: cfgOf(venue),
      ring: RING,
      environment: "preproduction",
      pool,
      providers,
      paymentsEnabled,
      ...(fetch === undefined ? {} : { fetch }),
    },
    log,
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

async function switchOffReader(id: string): Promise<void> {
  await suite.db.update(cardReaders).set({ disabledAt: nowIso() }).where(eq(cardReaders.id, id));
}

async function sealedStripe(): Promise<Record<string, string> | null> {
  return withTransaction(suite.db, async (tx) => {
    return tryGetCredential(tx, RING, {
      purpose: "payments.stripe",
    });
  });
}

it.each(["connect", "disconnect"] as const)(
  "requires confirmation before provider %s reaches the provider or credential",
  async (action) => {
    const venue = await seedVenueWithStaff();
    const connect = vi.fn(stripeSeat.connect);
    const app = mountApp(venue, [{ ...stripeSeat, connect }]);
    expect((await connectStripe(app, venue)).status).toBe(200);
    connect.mockClear();
    await withTransaction(suite.db, (tx) =>
      setFreshManagementSignIn(tx, venue.managerCookie, false),
    );
    const before = await sealedStripe();
    const poolBefore = evicted.length;
    expect(
      (
        await send(app, "GET", "/management-api/payments/providers", {
          cookie: venue.managerCookie,
        })
      ).status,
    ).toBe(200);
    const response = await send(
      app,
      "POST",
      `/management-api/payments/providers/stripe/${action}`,
      {
        cookie: venue.managerCookie,
        ...(action === "connect" ? { body: { ...GOOD_KEY, secretKey: "sk_test_next" } } : {}),
      },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management_session.proof_required", params: {} },
    });
    expect(connect).not.toHaveBeenCalled();
    expect(await sealedStripe()).toEqual(before);
    expect(evicted).toHaveLength(poolBefore);
  },
);

it("rechecks confirmation after the provider wait before storing credentials", async () => {
  const venue = await seedVenueWithStaff();
  const app = mountApp(venue, [
    {
      ...stripeSeat,
      connect: async (...args) => {
        const answer = await stripeSeat.connect(...args);
        await withTransaction(suite.db, (tx) =>
          setFreshManagementSignIn(tx, venue.managerCookie, false),
        );
        return answer;
      },
    },
  ]);
  const poolBefore = evicted.length;
  const response = await connectStripe(app, venue);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: { code: "management_session.proof_required", params: {} },
  });
  expect(await sealedStripe()).toBeNull();
  expect(evicted).toHaveLength(poolBefore);
});

describe("connect", () => {
  it("seals the credential, returns the merchant name and NO secret, and evicts the pool", async () => {
    const venue = await seedVenueWithStaff();
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
    const venue = await seedVenueWithStaff();
    const app = mountApp(venue);
    const res = await send(app, "POST", "/management-api/payments/providers/stripe/connect", {
      cookie: venue.managerCookie,
      body: { ...GOOD_KEY, secretKey: "sk_test_bad" },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "payment.provider_credential_rejected" },
    });
    expect(await sealedStripe()).toBeNull();
  });

  it("refuses a wrong-environment key with payment.credential_environment_mismatch (environment is passed)", async () => {
    const venue = await seedVenueWithStaff();
    const app = mountApp(venue);
    // A live key on a preproduction host: the seat's prefix guard fires only because the route passed
    // `environment` through.
    const res = await send(app, "POST", "/management-api/payments/providers/stripe/connect", {
      cookie: venue.managerCookie,
      body: { ...GOOD_KEY, secretKey: "sk_live_ok" },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "payment.credential_environment_mismatch" },
    });
    expect(await sealedStripe()).toBeNull();
  });

  it("refuses a staff session with authorization.not_permitted", async () => {
    const venue = await seedVenueWithStaff();
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

it("keeps a malformed manager PIN private and records its reason", async () => {
  const venue = await seedVenueWithStaff();
  const log = vi.fn();
  const app = mountApp(venue, PROVIDERS, suite.db, { log });
  const response = await send(
    app,
    "POST",
    `/management-api/payments/held/${randomUUID()}/outcome`,
    {
      cookie: venue.managerCookie,
      body: { outcome: "kept", note: "Provider confirmed the charge", pin: null },
    },
  );
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: { code: "pin.invalid", params: {} } });
  expect(log).toHaveBeenCalledWith(
    "warn",
    "pin.invalid",
    expect.objectContaining({ logReason: "malformed" }),
  );
});

describe("providers list", () => {
  it("reports not_connected before and connected after, with the seat's fields", async () => {
    const venue = await seedVenueWithStaff();
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
    const [manager] = await suite.db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.displayName, "The Manager"));
    expect(
      (await readActivityForSubject(suite.db, { kind: "credential", id: "payments.stripe" })).at(
        -1,
      ),
    ).toMatchObject({ kind: "credentials.saved", personId: manager!.id });

    const after = await send(app, "GET", "/management-api/payments/providers", {
      cookie: venue.managerCookie,
    });
    const afterBody = (await after.json()) as { providerId: string; state: string }[];
    expect(afterBody.find((p) => p.providerId === "stripe")!.state).toBe("connected");
  });
});

describe("device and profile readers", () => {
  it("sets, reads back and clears a device's chosen reader", async () => {
    const venue = await seedVenueWithStaff();
    const app = mountApp(venue);
    await connectStripe(app, venue);
    const readerId = (
      (await (await addReader(app, venue, nextRef(), "Barra")).json()) as {
        id: string;
      }
    ).id;
    const device = await seedDevice();
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
      .select({ deviceId: cardReaders.heldByDeviceId })
      .from(cardReaders)
      .where(eq(cardReaders.id, readerId));
    return row?.deviceId ?? null;
  }

  it("PUT a device's reader null puts it on Use default", async () => {
    const venue = await seedVenueWithStaff();
    const app = mountApp(venue);
    const [counter, terrace] = await seedReaders("Barra", "Terraza");
    const device = await seedDevice();
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
    const venue = await seedVenueWithStaff();
    const app = mountApp(venue);
    const [reader] = await seedReaders("Barra");
    const first = await seedDevice();
    const second = await seedDevice();
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
    const venue = await seedVenueWithStaff();
    const app = mountApp(venue);
    const [reader] = await seedReaders("Barra");
    const device = await seedDevice();
    await listOnProfile(device, reader!);
    await withTransaction(suite.db, (tx) => deleteDevice(tx, cfgOf(venue), device));
    const choices = () =>
      suite.db.select({ id: devices.id, readerId: devices.cardReaderId }).from(devices);
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
    const venue = await seedVenueWithStaff();
    const app = mountApp(venue);
    const [reader] = await seedReaders("Barra");
    const device = await seedDevice();
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
    const venue = await seedVenueWithStaff();
    const app = mountApp(venue);
    const [counter, terrace] = await seedReaders("Barra", "Terraza");
    const [profile] = await seedDeviceProfiles(suite.db, {
      name: nextName("Perfil lectores"),
      formFactor: "till",
    });
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
    const venue = await seedVenueWithStaff();
    const app = mountApp(venue);
    const [profile] = await seedDeviceProfiles(suite.db, {
      name: nextName("Perfil lectores"),
      formFactor: "till",
    });
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
    const unknownProfile = randomUUID();
    const putNoProfile = await send(
      app,
      "PUT",
      `/management-api/payments/device-profiles/${unknownProfile}/readers`,
      { ...opts, body: { readerIds: [unknownReader], defaultReaderId: null } },
    );
    expect(putNoProfile.status).toBe(404);
    expect(await putNoProfile.json()).toMatchObject({
      error: { code: "device_profile.not_found" },
    });
    expect(noReader.status).toBe(400);
    expect(await noReader.json()).toEqual({
      error: { code: "reader.not_found", params: { id: unknownReader } },
    });
  });
});

describe("reader holders", () => {
  const path = "/management-api/payments/reader-holders";

  it("names each held reader's device, and the devices with a payment in progress on a reader", async () => {
    const venue = await seedVenueWithStaff();
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
    const holder = await seedDevice();
    const payer = await seedDevice();
    const [holderRow] = await suite.db
      .select({ label: devices.label })
      .from(devices)
      .where(eq(devices.id, holder));
    await suite.db
      .update(cardReaders)
      .set({ heldByDeviceId: holder })
      .where(eq(cardReaders.id, held!));
    let orderNumber = 0;
    const order = async () => {
      orderNumber += 1;
      const row = await seedWorkingOrder(suite.db, { source: "dashboard", orderNumber });
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
    const venue = await seedVenueWithStaff();
    const app = mountApp(venue);
    expect((await send(app, "GET", path, { cookie: venue.staffCookie })).status).toBe(403);
    expect((await send(app, "GET", path)).status).toBe(401);
  });
});

describe("readers — lifecycle and screens", () => {
  it("lists configured device names from choices and profile defaults, with choices taking precedence", async () => {
    const venue = await seedVenueWithStaff();
    const app = mountApp(venue);
    const first = randomUUID();
    const second = randomUUID();
    const unused = randomUUID();
    await suite.db.insert(cardReaders).values([
      { id: first, provider: "stripe", providerRef: nextRef(), name: "Default reader" },
      { id: second, provider: "stripe", providerRef: nextRef(), name: "Chosen reader" },
      { id: unused, provider: "stripe", providerRef: nextRef(), name: "Unused reader" },
    ]);
    const [profile] = await seedDeviceProfiles(suite.db, {
      name: "Shared tills",
      formFactor: "till",
    });
    await suite.db
      .update(deviceProfiles)
      .set({ cardReaders: { ids: [first, second, unused], defaultId: first } })
      .where(eq(deviceProfiles.id, profile!.id));
    const rows: { id: string; label: string }[] = [];
    for (const label of ["Terrace till", "Bar till", "Own choice", "Disabled till"])
      rows.push({
        id: (await seedDeviceRow(suite.db, { label, profileId: profile!.id })).deviceId,
        label,
      });
    await suite.db
      .update(devices)
      .set({ active: false })
      .where(eq(devices.id, rows.find((row) => row.label === "Disabled till")!.id));
    await suite.db
      .update(devices)
      .set({ cardReaderId: second })
      .where(eq(devices.id, rows.find((row) => row.label === "Own choice")!.id));
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
    const venue = await seedVenueWithStaff();
    const app = mountApp(venue);
    const readerId = randomUUID();
    await suite.db
      .insert(cardReaders)
      .values({ id: readerId, provider: "stripe", providerRef: nextRef(), name: "One reader" });
    const deviceId = await seedDevice();
    await suite.db.update(devices).set({ label: "Counter" }).where(eq(devices.id, deviceId));
    await listOnProfile(deviceId, readerId);
    await suite.db
      .update(deviceProfiles)
      .set({ cardReaders: { ids: [readerId], defaultId: readerId } });
    await suite.db.update(devices).set({ cardReaderId: readerId }).where(eq(devices.id, deviceId));
    const response = await send(app, "GET", "/management-api/payments/readers", {
      cookie: venue.managerCookie,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        id: readerId,
        provider: "stripe",
        name: "One reader",
        printsOwnSlipAutomatically: false,
        active: true,
        canEnable: true,
        deviceCount: 1,
        deviceNames: ["Counter"],
      },
    ]);
  });

  it("refuses the reader-name list without a manager's permission", async () => {
    const venue = await seedVenueWithStaff();
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
    const venue = await seedVenueWithStaff();
    const app = mountApp(venue);
    const res = await addReader(app, venue, nextRef(), "Barra");
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "reader.provider_disconnected" },
    });
  });

  it("reports a reader's live status through the seat, and its device count in the list", async () => {
    const venue = await seedVenueWithStaff();
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
      printsOwnSlipAutomatically: false,
    });

    // Point a device at the reader, then the list's deviceCount reflects it.
    const device = await seedDevice();
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
    const venue = await seedVenueWithStaff();
    const app = mountApp(venue);
    const device = await seedDevice();
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
        isPrimary: () => true,
        admission: testTradingAdmission(),
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

  it("connects, adds and reads status with fetch supplied", async () => {
    const venue = await seedVenueWithStaff();
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
    await switchOffReader(readerId);
  });
});

describe("disconnect", () => {
  it("refuses payment.provider_in_use while an active reader remains, then disconnects after Delete", async () => {
    const venue = await seedVenueWithStaff();
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

    expect(
      (
        await send(app, "DELETE", `/management-api/payments/readers/${readerId}`, {
          cookie: venue.managerCookie,
        })
      ).status,
    ).toBe(200);

    const gone = await send(app, "POST", "/management-api/payments/providers/stripe/disconnect", {
      cookie: venue.managerCookie,
    });
    expect(gone.status).toBe(204);
    const [manager] = await suite.db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.displayName, "The Manager"));
    expect(
      (await readActivityForSubject(suite.db, { kind: "credential", id: "payments.stripe" })).at(
        -1,
      ),
    ).toMatchObject({ kind: "credentials.removed", personId: manager!.id });

    expect(await sealedStripe()).toBeNull();
  });
});

describe("add reader — races with a concurrent disconnect", () => {
  it("does NOT leave an active reader whose provider was disconnected mid-add", async () => {
    // Pause the add inside its provider round-trip (outside any transaction), disconnect, resume.
    const venue = await seedVenueWithStaff();
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
        isPrimary: () => true,
        admission: testTradingAdmission(),
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
    expect(await added.json()).toEqual({
      error: { code: "reader.provider_disconnected", params: { providerId: "stripe" } },
    });
    const readers = (await (
      await send(app, "GET", "/management-api/payments/readers", { cookie: venue.managerCookie })
    ).json()) as unknown[];
    expect(readers).toEqual([]);
    expect(await suite.db.select({ id: cardReaders.id }).from(cardReaders)).toEqual([]);
    expect(removed).toEqual([]);
  });
});

describe("unpair reader — retryable after a failed vendor unpair", () => {
  it("re-attempts the vendor removal on a retry and 204s (unpairing is idempotent)", async () => {
    // Vendor failure leaves the row active; a retry must call the vendor again and disable it.
    const venue = await seedVenueWithStaff();
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
        isPrimary: () => true,
        admission: testTradingAdmission(),
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
    const app = mountApp(venue, providers, suite.db, {
      log: (level, event, fields) => lines.push({ level, event, fields: fields ?? {} }),
      ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
    });
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
    return row!.disabledAt === null;
  }

  it("answers reader.provider_disconnected when the seat finds no credential during the call", async () => {
    const venue = await seedVenueWithStaff();
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
    const venue = await seedVenueWithStaff();
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
    const venue = await seedVenueWithStaff();
    const { app } = mountLogged(venue, [
      failingSeat(new AppError("payment.provider_credential_rejected", { providerId: "stripe" })),
    ]);
    const id = await pairedStripeReader(app, venue);

    const res = await send(app, "POST", `${base}/readers/${id}/unpair`, {
      cookie: venue.managerCookie,
    });

    expect(res.status).toBe(409);
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
      const venue = await seedVenueWithStaff();
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

  it("defaults automatic slips off and retains the saved setting through rename and adoption", async () => {
    const venue = await seedVenueWithStaff();
    const app = mountApp(venue, [discoverySeat(async () => [vendor])]);
    await connectStripe(app, venue);
    const opts = { cookie: venue.managerCookie };
    const create = await send(app, "POST", `${base}/readers/adopt`, { ...opts, body: adoption });
    expect(create.status).toBe(201);
    const { id } = (await create.json()) as { id: string };
    const saved = async () => {
      const response = await send(app, "GET", `${base}/readers`, opts);
      expect(response.status).toBe(200);
      return (await response.json()) as {
        id: string;
        name: string;
        printsOwnSlipAutomatically: boolean;
      }[];
    };
    expect(await saved()).toEqual([
      expect.objectContaining({ id, printsOwnSlipAutomatically: false }),
    ]);
    expect(
      (
        await send(app, "PATCH", `${base}/readers/${id}`, {
          ...opts,
          body: { name: "Counter", printsOwnSlipAutomatically: true },
        })
      ).status,
    ).toBe(204);
    expect(await saved()).toEqual([
      expect.objectContaining({ id, printsOwnSlipAutomatically: true }),
    ]);
    expect(
      await (await send(app, "GET", `${base}/readers/${id}/status`, opts)).json(),
    ).toHaveProperty("printsOwnSlipAutomatically", true);
    expect(
      (
        await send(app, "PATCH", `${base}/readers/${id}`, {
          ...opts,
          body: { name: "Terrace" },
        })
      ).status,
    ).toBe(204);
    await switchOffReader(id);
    expect(await saved()).toEqual([
      expect.objectContaining({ id, name: "Terrace", printsOwnSlipAutomatically: true }),
    ]);
    const adopted = await send(app, "POST", `${base}/readers/adopt`, { ...opts, body: adoption });
    expect(await adopted.json()).toEqual({ id, status: "paired" });
    expect(await saved()).toEqual([
      expect.objectContaining({ id, printsOwnSlipAutomatically: true }),
    ]);
    expect(
      (
        await send(app, "PATCH", `${base}/readers/${id}`, {
          ...opts,
          body: { name: "Counter", printsOwnSlipAutomatically: false },
        })
      ).status,
    ).toBe(204);
    expect(await saved()).toEqual([
      expect.objectContaining({ id, printsOwnSlipAutomatically: false }),
    ]);
  });

  it("a new registration starts with automatic slips off after deleting an own-slip reader", async () => {
    const venue = await seedVenueWithStaff();
    const app = mountApp(venue, [discoverySeat(async () => [vendor])]);
    await connectStripe(app, venue);
    const opts = { cookie: venue.managerCookie };
    const first = await send(app, "POST", `${base}/readers/adopt`, { ...opts, body: adoption });
    const { id } = (await first.json()) as { id: string };
    expect(
      (
        await send(app, "PATCH", `${base}/readers/${id}`, {
          ...opts,
          body: { name: "Counter", printsOwnSlipAutomatically: true },
        })
      ).status,
    ).toBe(204);
    expect((await send(app, "DELETE", `${base}/readers/${id}`, opts)).status).toBe(200);
    const created = await send(app, "POST", `${base}/readers/adopt`, { ...opts, body: adoption });
    expect(created.status).toBe(201);
    const { id: newId } = (await created.json()) as { id: string };
    expect(newId).not.toBe(id);
    const rows = await suite.db.select().from(cardReaders);
    expect(rows.find((row) => row.id === newId)).toMatchObject({
      printsOwnSlipAutomatically: false,
    });
    expect(rows.find((row) => row.id === id)).toMatchObject({
      printsOwnSlipAutomatically: true,
      disabledAt: expect.any(String),
    });
  });

  it.each([null, [], "true", 1, {}].map((value) => ({ value })))(
    "refuses invalid automatic-slip value $value without changing the reader",
    async ({ value }) => {
      const venue = await seedVenueWithStaff();
      const app = mountApp(venue, [discoverySeat(async () => [vendor])]);
      await connectStripe(app, venue);
      const opts = { cookie: venue.managerCookie };
      const { id } = (await (
        await send(app, "POST", `${base}/readers/adopt`, { ...opts, body: adoption })
      ).json()) as { id: string };
      const response = await send(app, "PATCH", `${base}/readers/${id}`, {
        ...opts,
        body: { name: "Changed", printsOwnSlipAutomatically: value },
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: {
          code: "management.request_invalid",
          params: { field: "printsOwnSlipAutomatically" },
        },
      });
      const [row] = await suite.db.select().from(cardReaders).where(eq(cardReaders.id, id));
      expect(row).toMatchObject({ name: "Counter", printsOwnSlipAutomatically: false });
    },
  );

  it("labels available, added and disabled and reuses the disabled id and the device's chosen reader", async () => {
    const venue = await seedVenueWithStaff();
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
    const device = await seedDevice();
    await listOnProfile(device, id);
    expect(
      (
        await send(app, "PUT", `${base}/devices/${device}/reader`, {
          ...opts,
          body: { readerId: id },
        })
      ).status,
    ).toBe(204);
    await switchOffReader(id);
    expect(await available()).toEqual([{ ...vendor, name: "Counter", status: "disabled" }]);
    // `dated` is derived in JavaScript: `disabled_at is not null` in SQL would come back as 0/1.
    const disabled = (
      await suite.db
        .select({
          active: sql<boolean>`${cardReaders.disabledAt} is null`.mapWith(Boolean),
          disabledAt: cardReaders.disabledAt,
        })
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
        active: sql<boolean>`${cardReaders.disabledAt} is null`.mapWith(Boolean),
        disabledAt: cardReaders.disabledAt,
      })
      .from(cardReaders);
    expect(stored).toEqual([{ id, name: "Counter", active: true, disabledAt: null }]);
    expect(await (await send(app, "GET", `${base}/devices/${device}/reader`, opts)).json()).toEqual(
      { readerId: id },
    );
    expect(removed).toEqual([]);
  });

  /** The three seeded profiles, plus a retired copy of the till's, its readers listing `r0` as default. */
  async function seededProfiles() {
    const ids: Record<string, string> = {};
    for (const profile of DEFAULT_DEVICE_PROFILES) {
      const [row] = await seedDeviceProfiles(suite.db, {
        name: nextName(profile.name),
        formFactor: profile.formFactor,
        capabilities: profile.capabilities,
      });
      ids[profile.formFactor] = row!.id;
    }
    const [retired] = await seedDeviceProfiles(suite.db, {
      name: nextName("Retirado"),
      formFactor: "till",
      capabilities: ["integrated-card-payment"],
      retiredAt: nowIso(),
    });
    const [r0] = await suite.db
      .insert(cardReaders)
      .values({ provider: "stripe", providerRef: nextRef(), name: "Existing" })
      .returning({ id: cardReaders.id });
    await suite.db
      .update(deviceProfiles)
      .set({ cardReaders: { ids: [r0!.id], defaultId: r0!.id } })
      .where(eq(deviceProfiles.id, ids.till!));
    return {
      till: ids.till!,
      kds: ids.kds!,
      handheld: ids["phone-portrait"]!,
      retired: retired!.id,
      r0: r0!.id,
    };
  }

  async function listsOf(profileId: string) {
    const [row] = await suite.db
      .select({ list: deviceProfiles.cardReaders })
      .from(deviceProfiles)
      .where(eq(deviceProfiles.id, profileId));
    return (row!.list.ids ?? []).map((readerId, position) => ({
      readerId,
      position,
      isDefault: row!.list.defaultId === readerId,
    }));
  }

  async function expectJoinedTakingProfiles(
    p: Awaited<ReturnType<typeof seededProfiles>>,
    id: string,
  ) {
    expect(await listsOf(p.till)).toEqual([
      { readerId: p.r0, position: 0, isDefault: true },
      { readerId: id, position: 1, isDefault: false },
    ]);
    expect(await listsOf(p.handheld)).toEqual([{ readerId: id, position: 0, isDefault: false }]);
    expect(await listsOf(p.kds)).toEqual([]);
    expect(await listsOf(p.retired)).toEqual([]);
  }

  it("adopting a new reader joins every live profile that takes reader payments, never as default", async () => {
    const venue = await seedVenueWithStaff();
    const p = await seededProfiles();
    const app = mountApp(venue, [discoverySeat(async () => [vendor])]);
    await connectStripe(app, venue);
    const res = await send(app, "POST", `${base}/readers/adopt`, {
      cookie: venue.managerCookie,
      body: adoption,
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    await expectJoinedTakingProfiles(p, id);
  });

  it("a reader added through the add route joins every live profile that takes reader payments, never as default", async () => {
    const venue = await seedVenueWithStaff();
    const p = await seededProfiles();
    const app = mountApp(venue);
    await connectStripe(app, venue);
    const res = await addReader(app, venue, nextRef(), "Barra");
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    await expectJoinedTakingProfiles(p, id);
  });

  it("re-adopting a disabled reader joins no list a manager took it off", async () => {
    const venue = await seedVenueWithStaff();
    const p = await seededProfiles();
    const app = mountApp(venue, [discoverySeat(async () => [vendor])]);
    await connectStripe(app, venue);
    const opts = { cookie: venue.managerCookie };
    const first = await send(app, "POST", `${base}/readers/adopt`, { ...opts, body: adoption });
    const { id } = (await first.json()) as { id: string };
    await withTransaction(suite.db, (tx) => removeIdFromJson(tx, deviceProfiles.cardReaders, id));
    await switchOffReader(id);
    const again = await send(app, "POST", `${base}/readers/adopt`, { ...opts, body: adoption });
    expect(await again.json()).toEqual({ id, status: "paired" });
    expect(await listsOf(p.till)).toEqual([{ readerId: p.r0, position: 0, isDefault: true }]);
    expect(await listsOf(p.handheld)).toEqual([]);
  });

  it("Delete then provider-verified Add restores the saved reader without its assignments", async () => {
    const venue = await seedVenueWithStaff();
    const p = await seededProfiles();
    const seat = { ...stripeSeat, readers: { ...stripeSeat.readers, list: async () => [vendor] } };
    const app = mountApp(venue, [seat]);
    await connectStripe(app, venue);
    const opts = { cookie: venue.managerCookie };
    const first = await send(app, "POST", `${base}/readers/adopt`, { ...opts, body: adoption });
    expect(first.status).toBe(201);
    const { id } = (await first.json()) as { id: string };
    await suite.db
      .update(cardReaders)
      .set({ printsOwnSlipAutomatically: true })
      .where(eq(cardReaders.id, id));
    const before = await suite.db.select().from(cardReaders).where(eq(cardReaders.id, id));
    expect((await send(app, "DELETE", `${base}/readers/${id}`, opts)).status).toBe(200);
    const again = await send(app, "POST", `${base}/readers/adopt`, {
      ...opts,
      body: { ...adoption, name: "Provider name" },
    });
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual({ id, status: "paired" });
    expect(await suite.db.select().from(cardReaders).where(eq(cardReaders.id, id))).toEqual(before);
    expect(await listsOf(p.till)).toEqual([{ readerId: p.r0, position: 0, isDefault: true }]);
    expect(await listsOf(p.handheld)).toEqual([]);
  });

  it("refuses an unlisted reference without inserting or removing anything", async () => {
    const venue = await seedVenueWithStaff();
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
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({
      error: { code: "reader.not_listed", params: { providerId: "stripe" } },
    });
    expect(await suite.db.select({ id: cardReaders.id }).from(cardReaders)).toEqual([]);
    expect(removed).toEqual([]);
  });

  it("renames locally, while unpair alone calls the vendor", async () => {
    const venue = await seedVenueWithStaff();
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
    expect(
      await suite.db
        .select({
          name: cardReaders.name,
          active: sql<boolean>`${cardReaders.disabledAt} is null`.mapWith(Boolean),
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
        .select({ active: sql<boolean>`${cardReaders.disabledAt} is null`.mapWith(Boolean) })
        .from(cardReaders)
        .where(eq(cardReaders.id, id)),
    ).toEqual([{ active: false }]);
  });

  it("refuses Add after unpair until the provider lists the reader again", async () => {
    const venue = await seedVenueWithStaff();
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
    const enabled = await send(app, "POST", `${base}/readers/adopt`, { ...opts, body: adoption });
    expect(enabled.status).toBe(400);
    expect(await enabled.json()).toEqual({
      error: { code: "reader.not_listed", params: { providerId: "stripe" } },
    });
    expect(listings).toBe(1);
    expect(await (await send(app, "GET", `${base}/readers`, opts)).json()).toEqual([
      {
        id,
        provider: "stripe",
        name: "Barra 1",
        printsOwnSlipAutomatically: false,
        active: false,
        canEnable: false,
        deviceCount: 0,
        deviceNames: [],
      },
    ]);
    paired = true;
    const adopted = await send(app, "POST", `${base}/readers/adopt`, { ...opts, body: adoption });
    expect(await adopted.json()).toEqual({ id, status: "paired" });
    expect(listings).toBe(2);
    expect(await (await send(app, "GET", `${base}/readers`, opts)).json()).toEqual([
      {
        id,
        provider: "stripe",
        name: "Barra 1",
        printsOwnSlipAutomatically: false,
        active: true,
        canEnable: true,
        deviceCount: 0,
        deviceNames: [],
      },
    ]);
  });

  it.each(["adopt", "rename"] as const)(
    "refuses an empty %s name at the server boundary",
    async (action) => {
      const venue = await seedVenueWithStaff();
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

  it("refuses unpair with 409 reader.unpair_unsupported when the provider cannot unpair", async () => {
    const venue = await seedVenueWithStaff();
    const app = mountApp(venue);
    await connectStripe(app, venue);
    const { id } = (await (await addReader(app, venue, nextRef())).json()) as { id: string };
    const response = await send(app, "POST", `${base}/readers/${id}/unpair`, {
      cookie: venue.managerCookie,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "reader.unpair_unsupported", params: { providerId: "stripe" } },
    });
  });

  it("rechecks the credential after the vendor list round-trip without vendor rollback", async () => {
    const venue = await seedVenueWithStaff();
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
    const venue = await seedVenueWithStaff();
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
      ...["unpair"].map((a) => ["POST", `${base}/readers/${id}/${a}`]),
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
      const venue = await seedVenueWithStaff();
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
    const venue = await seedVenueWithStaff();
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

  it("answers a provider only the body names with 400 payment.provider_unknown, and one in the path with 404", async () => {
    const venue = await seedVenueWithStaff();
    const app = mountApp(venue);
    const opts = { cookie: venue.managerCookie };
    const unknown = { error: { code: "payment.provider_unknown", params: { providerId: "nope" } } };

    const pair = await send(app, "POST", "/management-api/payments/readers", {
      ...opts,
      body: { providerId: "nope", name: "Barra 1", reference: nextRef() },
    });
    expect(pair.status).toBe(400);
    expect(await pair.json()).toEqual(unknown);

    const adopt = await send(app, "POST", "/management-api/payments/readers/adopt", {
      ...opts,
      body: { providerId: "nope", providerRef: "tmr_x", name: "Counter" },
    });
    expect(adopt.status).toBe(400);
    expect(await adopt.json()).toEqual(unknown);

    const connect = await send(app, "POST", "/management-api/payments/providers/nope/connect", {
      ...opts,
      body: GOOD_KEY,
    });
    expect(connect.status).toBe(404);
    expect(await connect.json()).toEqual(unknown);

    for (const [method, path, body] of [
      ["GET", "/management-api/payments/providers/nope/available-readers", undefined],
      ["PUT", "/management-api/payments/providers/nope/state", { enabled: true, revision: 0 }],
      ["POST", "/management-api/payments/providers/nope/disconnect", undefined],
    ] as const) {
      const res = await send(app, method, path, { ...opts, ...(body ? { body } : {}) });
      expect({ path, status: res.status, body: await res.json() }).toEqual({
        path,
        status: 404,
        body: unknown,
      });
    }

    const readers = await send(app, "GET", "/management-api/payments/readers", opts);
    expect(await readers.json()).toEqual([]);
  });

  it("answers 409 payment.provider_unknown when a stored reader's provider is no longer served", async () => {
    const venue = await seedVenueWithStaff();
    const app = mountApp(venue);
    await connectStripe(app, venue);
    const { id } = (await (await addReader(app, venue, nextRef())).json()) as { id: string };
    const withoutStripe = mountApp(venue, []);
    const gone = { error: { code: "payment.provider_unknown", params: { providerId: "stripe" } } };
    for (const [method, suffix] of [
      ["GET", "/status"],
      ["POST", "/unpair"],
      ["GET", "/delete-impact"],
      ["DELETE", ""],
    ] as const) {
      const res = await send(
        withoutStripe,
        method,
        `/management-api/payments/readers/${id}${suffix}`,
        {
          cookie: venue.managerCookie,
        },
      );
      expect({ suffix, status: res.status, body: await res.json() }).toEqual({
        suffix,
        status: 409,
        body: gone,
      });
    }
  });

  it("answers a pairing code the provider refuses with 400 payment.pairing_refused, writing no reader", async () => {
    const venue = await seedVenueWithStaff();
    const received: (string | undefined)[] = [];
    const refusing: CardProviderContribution = {
      ...stripeSeat,
      readerAdd: PAIRING_POLL,
      readers: {
        ...stripeSeat.readers,
        add: async (_deps, input) => {
          received.push(input.code);
          if (input.code === "wrong-code-123")
            throw new AppError("payment.pairing_refused", { providerId: "stripe" });
          throw new Error(`the route forwarded ${String(input.code)}, not the typed code`);
        },
      },
    };
    const app = mountApp(venue, [refusing]);
    await connectStripe(app, venue);
    const res = await send(app, "POST", "/management-api/payments/readers", {
      cookie: venue.managerCookie,
      body: { providerId: "stripe", name: "Barra 1", code: "wrong-code-123" },
    });
    expect(received).toEqual(["wrong-code-123"]);
    expect({ status: res.status, body: await res.json() }).toEqual({
      status: 400,
      body: { error: { code: "payment.pairing_refused", params: { providerId: "stripe" } } },
    });
    expect(await suite.db.select({ id: cardReaders.id }).from(cardReaders)).toEqual([]);
  });

  it.each([
    ["PATCH", "", { name: "Nuevo" }],

    ["POST", "/unpair", undefined],
    ["GET", "/status", undefined],
  ] as const)(
    "404s %s on an unknown reader%s with reader.not_found",
    async (method, suffix, body) => {
      const venue = await seedVenueWithStaff();
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

  it("answers a reader id the provider does not know with 400 reader.reference_unknown, writing no reader", async () => {
    const venue = await seedVenueWithStaff();
    const seat: CardProviderContribution = {
      ...stripeSeat,
      readers: {
        ...stripeSeat.readers,
        add: async () => {
          throw new AppError("reader.reference_unknown", {
            providerId: "stripe",
            field: "reference",
          });
        },
      },
    };
    const app = mountApp(venue, [seat]);
    await connectStripe(app, venue);
    const res = await addReader(app, venue, "tmr_bad");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "reader.reference_unknown",
        params: { providerId: "stripe", field: "reference" },
      },
    });
    expect(await suite.db.select().from(cardReaders)).toEqual([]);
  });

  it("hands the seat a pairing code without a reference when only a code is given", async () => {
    const venue = await seedVenueWithStaff();
    const calls: unknown[] = [];
    const seat: CardProviderContribution = {
      ...stripeSeat,
      readerAdd: PAIRING_POLL,
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

  async function refusedAdd(
    readerAdd: CardProviderContribution["readerAdd"],
    body: Record<string, unknown>,
    field: string,
  ): Promise<void> {
    const venue = await seedVenueWithStaff();
    const added: unknown[] = [];
    const seat: CardProviderContribution = {
      ...stripeSeat,
      readerAdd,
      readers: {
        ...stripeSeat.readers,
        add: async (_deps, input) => {
          added.push(input);
          return { providerRef: nextRef(), status: "paired" as const };
        },
      },
    };
    const app = mountApp(venue, [seat]);
    expect((await connectStripe(app, venue)).status).toBe(200);

    const response = await send(app, "POST", "/management-api/payments/readers", {
      cookie: venue.managerCookie,
      body: { providerId: "stripe", ...body },
    });

    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field } } },
    });
    expect(added).toEqual([]);
    expect(await suite.db.select({ id: cardReaders.id }).from(cardReaders)).toEqual([]);
  }

  it.each(["", "   "])(
    "refuses reference %j with management.request_invalid before asking the provider",
    (reference) => refusedAdd(stripeSeat.readerAdd, { name: "Barra 1", reference }, "reference"),
  );

  it("refuses a reference-kind add with no reference before asking the provider", () =>
    refusedAdd(stripeSeat.readerAdd, { name: "Barra 1" }, "reference"));

  it.each([{}, { reference: "tmr_given" }])(
    "refuses a pairing-poll add with no code (%j) before asking the provider",
    (extra) => refusedAdd(PAIRING_POLL, { name: "Barra 1", ...extra }, "code"),
  );

  it.each(["", "   "])(
    "refuses code %j with management.request_invalid before asking the provider",
    (code) => refusedAdd(PAIRING_POLL, { name: "Barra 1", code }, "code"),
  );

  it.each(["", "   "])(
    "refuses name %j with management.request_invalid before asking the provider",
    (name) => refusedAdd(stripeSeat.readerAdd, { name, reference: "tmr_named" }, "name"),
  );

  it("stores and hands the provider a padded name trimmed", async () => {
    const venue = await seedVenueWithStaff();
    const calls: { name: string }[] = [];
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
    expect((await connectStripe(app, venue)).status).toBe(200);

    const response = await addReader(app, venue, "tmr_padded", "  Barra 3  ");

    expect(response.status).toBe(201);
    expect(calls.map((call) => call.name)).toEqual(["Barra 3"]);
    expect(await suite.db.select({ name: cardReaders.name }).from(cardReaders)).toEqual([
      { name: "Barra 3" },
    ]);
  });

  it("refuses a chosen reader for an unknown device, or naming an unknown or disabled reader", async () => {
    const venue = await seedVenueWithStaff();
    const app = mountApp(venue);
    await connectStripe(app, venue);
    const readerId = ((await (await addReader(app, venue, nextRef())).json()) as { id: string }).id;
    const device = await seedDevice();
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
    expect(noReader.status).toBe(400);
    expect(await noReader.json()).toEqual({
      error: { code: "reader.not_found", params: { id: unknownReader } },
    });

    await switchOffReader(readerId);
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
    return { ...row!, active: row!.disabledAt === null };
  }

  /** The choices, profile entries and holder naming this reader. */
  async function linksOf(readerId: string) {
    return {
      chosen: await suite.db
        .select({ deviceId: devices.id, readerId: devices.cardReaderId })
        .from(devices)
        .where(eq(devices.cardReaderId, readerId)),
      listed: await suite.db
        .select({ profileId: deviceProfiles.id, readers: deviceProfiles.cardReaders })
        .from(deviceProfiles)
        .where(
          sql`exists (select 1 from json_each(${deviceProfiles.cardReaders}, '$.ids') where value = ${readerId})`,
        ),
      held: await suite.db
        .select({ readerId: cardReaders.id, deviceId: cardReaders.heldByDeviceId })
        .from(cardReaders)
        .where(and(eq(cardReaders.id, readerId), isNotNull(cardReaders.heldByDeviceId))),
    };
  }

  /** A device that lists, chooses and holds the reader. */
  async function linkReader(readerId: string): Promise<string> {
    const device = await seedDevice();
    await listOnProfile(device, readerId);
    await suite.db.update(devices).set({ cardReaderId: readerId }).where(eq(devices.id, device));
    await suite.db
      .update(cardReaders)
      .set({ heldByDeviceId: device })
      .where(eq(cardReaders.id, readerId));
    return device;
  }

  let orderNumber = 0;
  /** An `attempting` payment on the reader, through the table rather than a pay route. */
  async function startPayment(readerId: string): Promise<string> {
    orderNumber += 1;
    const order = await seedWorkingOrder(suite.db, { source: "dashboard", orderNumber });
    const [payment] = await suite.db
      .insert(payments)
      .values({
        workingOrderId: order!.id,
        source: "device",
        deviceId: await seedDevice(),
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
    await switchOffReader(paired.id);
    expect((await send(app, "POST", `${base}/providers/stripe/disconnect`, opts)).status).toBe(204);
    return paired;
  }

  it("refuses a caller without hardware.manage, a malformed id, an unknown id, changing nothing", async () => {
    const venue = await seedVenueWithStaff();
    const { seat, removed } = unpairingSeat();
    const app = mountApp(venue, [seat]);
    const { id } = await pairedReader(app, venue);
    await linkReader(id);
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
      for (const missing of [unknown]) {
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
    const venue = await seedVenueWithStaff();
    // Shows the order only: a read from inside a transaction's body sees its uncommitted rows, so
    // the outage case below is the one that shows the switch-off is committed first.
    const seen: { active: boolean; deletedAt: string | null }[] = [];
    const { seat, removed } = unpairingSeat(async () => {
      const row = await readerRow(id);
      seen.push({ active: row.active, deletedAt: row.deletedAt });
    });
    const app = mountApp(venue, [seat]);
    const { id, ref } = await pairedReader(app, venue);
    await linkReader(id);

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
    const venue = await seedVenueWithStaff();
    const { seat, removed } = unpairingSeat(async () => {
      throw new Error("outage");
    });
    const app = mountApp(venue, [seat]);
    const { id } = await pairedReader(app, venue);
    await linkReader(id);
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
    const venue = await seedVenueWithStaff();
    const { seat } = unpairingSeat(async () => {
      throw new AppError("payment.provider_credential_rejected", { providerId: "stripe" });
    });
    const app = mountApp(venue, [seat]);
    const { id } = await pairedReader(app, venue);

    const res = await deleteOf(app, venue, id);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "payment.provider_credential_rejected", params: { providerId: "stripe" } },
    });
    expect((await readerRow(id)).deletedAt).toBeNull();
  });

  it("deletes a still-paired reader in Waitron only once its provider is disconnected, and only when the delete accepts the notice", async () => {
    const venue = await seedVenueWithStaff();
    const { seat, removed } = unpairingSeat();
    const app = mountApp(venue, [seat]);
    const { id } = await disconnectedReader(app, venue);
    await linkReader(id);
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
    expect(after).toEqual({
      ...row,
      active: false,
      heldByDeviceId: null,
      deletedAt: after.deletedAt,
    });
    expect(after.deletedAt).not.toBeNull();
    expect(after.unpairedAt).toBeNull();
    expect(await linksOf(id)).toEqual({ chosen: [], listed: [], held: [] });
  });

  it("unpairs at the provider as normal when it was connected again after the notice was shown", async () => {
    const venue = await seedVenueWithStaff();
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
    const venue = await seedVenueWithStaff();
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
    const venue = await seedVenueWithStaff();
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
    const venue = await seedVenueWithStaff();
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
    const venue = await seedVenueWithStaff();
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
    await linkReader(id);
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
    const venue = await seedVenueWithStaff();
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
    const venue = await seedVenueWithStaff();
    const app = mountApp(venue);
    const { id } = await pairedReader(app, venue);

    const res = await deleteOf(app, venue, id);

    expect(res.status).toBe(200);
    const row = await readerRow(id);
    expect(row.deletedAt).not.toBeNull();
    expect(row.unpairedAt).toBeNull();
  });

  it("refuses reader.payment_in_progress before calling the provider", async () => {
    const venue = await seedVenueWithStaff();
    const { seat, removed } = unpairingSeat();
    const app = mountApp(venue, [seat]);
    const { id } = await pairedReader(app, venue);
    await startPayment(id);
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
    const venue = await seedVenueWithStaff();
    let paymentId = "";
    const { seat, removed } = unpairingSeat(async () => {
      paymentId = await startPayment(id);
    });
    const app = mountApp(venue, [seat]);
    const { id } = await pairedReader(app, venue);
    await linkReader(id);
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
    const venue = await seedVenueWithStaff();
    const { seat } = unpairingSeat();
    const app = mountApp(venue, [seat]);
    const { id } = await pairedReader(app, venue);
    await linkReader(id);
    const opts = { cookie: venue.managerCookie };
    expect((await send(app, "POST", `${base}/readers/${id}/unpair`, opts)).status).toBe(204);

    const impact = await impactOf(app, venue, id);
    const deleted = await deleteOf(app, venue, id);

    expect(impact.status).toBe(200);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual(await impact.json());
  });

  it("deletes once when two deletes race", async () => {
    const venue = await seedVenueWithStaff();
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

  it("refuses Unpair, a second Delete and adopting its provider id while a delete is unpairing the reader; a failed unpair leaves it switched off", async () => {
    const venue = await seedVenueWithStaff();
    const refused: { request: string; status: number; body: unknown }[] = [];
    let activeDuringCall: boolean | undefined;
    const { seat, removed } = unpairingSeat(async () => {
      if (removed.length > 1) return;
      activeDuringCall = (await readerRow(id)).active;
      for (const [method, path, body] of [
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

    expect(
      (
        await send(app, "POST", `${base}/readers/adopt`, {
          cookie: venue.managerCookie,
          body: { providerId: "stripe", providerRef: ref, name: "Again" },
        })
      ).status,
    ).toBe(201);
    expect((await readerRow(id)).active).toBe(true);
  });

  it("refuses a Delete while an Unpair of the reader is at its provider, calling the provider once", async () => {
    const venue = await seedVenueWithStaff();
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
    it(`refuses adopting a provider id whose listing was taken before ${action} dropped it there with 409 reader.removed_while_adding, changing nothing`, async () => {
      const venue = await seedVenueWithStaff();
      const { seat, removed } = unpairingSeat();
      let dropped: { status: number; row: Awaited<ReturnType<typeof readerRow>> } | undefined;
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
        status: 409,
        body: {
          error: { code: "reader.removed_while_adding", params: { providerId: "stripe" } },
        },
      });
      expect(
        (await suite.db.select().from(cardReaders).where(eq(cardReaders.providerRef, ref))).map(
          (row) => ({ ...row, active: row.disabledAt === null }),
        ),
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

    it("answers reader.not_found to rename, unpair and status, calling no provider and changing nothing", async () => {
      const venue = await seedVenueWithStaff();
      const spies = spySeat();
      const app = mountApp(venue, [spies.seat]);
      const { id, row } = await deletedReader(app, venue, spies);

      for (const [method, path, body] of [
        ["PATCH", `${base}/readers/${id}`, { name: "Terrace" }],

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
      const venue = await seedVenueWithStaff();
      const spies = spySeat();
      const app = mountApp(venue, [spies.seat]);
      const opts = { cookie: venue.managerCookie };
      const { id: kept } = await pairedReader(app, venue);
      const added = await addReader(app, venue, nextRef(), "Terraza");
      expect(added.status).toBe(201);
      const { id: doomed } = (await added.json()) as { id: string };
      const device = await seedDevice();
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
        status: 400,
        body: notFound,
      });
      expect({ status: relisted.status, body: await relisted.json() }).toEqual({
        status: 400,
        body: notFound,
      });
      expect(
        await (await send(app, "GET", `${base}/devices/${device}/reader`, opts)).json(),
      ).toEqual({ readerId: null });
      expect(await (await send(app, "GET", profilePath, opts)).json()).toEqual(afterDelete);
      expect(await linksOf(doomed)).toEqual({ chosen: [], listed: [], held: [] });
    });

    it("is left out of the reader list, while a disabled reader stays in it switched off", async () => {
      const venue = await seedVenueWithStaff();
      const spies = spySeat();
      const app = mountApp(venue, [spies.seat]);
      const opts = { cookie: venue.managerCookie };
      const { id: deleted } = await deletedReader(app, venue, spies);
      const added = await addReader(app, venue, nextRef(), "Terraza");
      const { id: disabled } = (await added.json()) as { id: string };
      await switchOffReader(disabled);

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
      const venue = await seedVenueWithStaff();
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

    it("never shadows a live reader with the same provider id in discovery or Add, whichever row was written first", async () => {
      const venue = await seedVenueWithStaff();
      const [deletedFirst, liveFirst] = [nextRef(), nextRef()];
      const spies = spySeat(() => [deletedFirst, liveFirst]);
      const app = mountApp(venue, [spies.seat]);
      expect((await connectStripe(app, venue)).status).toBe(200);
      const deletedRow = (providerRef: string) => ({
        provider: "stripe",
        providerRef,
        name: "Old",
        disabledAt: "2026-10-10T10:00:00.000Z",
        unpairedAt: null,
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
      for (const providerRef of [deletedFirst, liveFirst]) {
        const rows = await suite.db
          .select()
          .from(cardReaders)
          .where(eq(cardReaders.providerRef, providerRef));
        const current = rows.find((row) => row.deletedAt === null)!;
        const restored = await send(app, "POST", `${base}/readers/adopt`, {
          cookie: venue.managerCookie,
          body: { providerId: "stripe", providerRef, name: "Ignored" },
        });
        expect(restored.status).toBe(201);
        expect(await restored.json()).toEqual({ id: current.id, status: "paired" });
        expect(await readerRow(current.id)).toEqual({
          ...current,
          active: current.disabledAt === null,
        });
      }
    });

    it("deleted in Waitron only while disconnected, is offered with saved settings once connected again", async () => {
      const venue = await seedVenueWithStaff();
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
      expect(await available.json()).toEqual([
        { ...vendorOf(ref), name: "Barra 1", status: "disabled" },
      ]);
      const adopted = await send(app, "POST", `${base}/readers/adopt`, {
        ...opts,
        body: { providerId: "stripe", providerRef: ref, name: "Counter" },
      });
      expect(adopted.status).toBe(201);
      expect(((await adopted.json()) as { id: string }).id).toBe(id);
      expect(await readerRow(id)).toEqual({
        ...row,
        active: true,
        deletedAt: null,
        disabledAt: null,
      });
      expect(row.unpairedAt).toBeNull();
      expect(spies.removed).toEqual([]);
    });

    it("lets a new pairing take its provider id, as a new record", async () => {
      const venue = await seedVenueWithStaff();
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

describe("manager-ended practice uncertainty", () => {
  it("ends a bill practice attempt after a restart without a mounted simulator", async () => {
    const venue = await seedVenueWithStaff();
    const deviceId = await seedDevice();
    const order = await seedWorkingOrder(suite.db, { source: "device", deviceId });
    const [bill] = await suite.db
      .insert(billPayments)
      .values({
        workingOrderId: order.id,
        submissionId: randomUUID(),
        fingerprint: "practice",
        kind: "contribution",
        method: "card",
        applied: 1000,
        state: "pending",
        requestedBy: await seedPerson(suite.db),
        source: "device",
        deviceId,
      })
      .returning({ id: billPayments.id });
    const simulator = new SimulatorPaymentProvider(suite.db);
    const attempt = await simulator.collect({
      origin: deviceOrigin(deviceId),
      nodeId: brandNodeId(venue.nodeId),
      workingOrderId: brandWorkingOrderId(order.id),
      amount: decimal("10.00"),
      simulationOutcome: "attempting",
      billPaymentId: bill!.id,
    });
    const [payment] = await suite.db
      .select()
      .from(payments)
      .where(eq(payments.paymentRef, attempt.paymentRef));
    const path = `/management-api/payments/bill-payments/${bill!.id}/resolve`;
    const app = mountApp(venue, []);
    const denied = await send(app, "POST", path, { cookie: venue.staffCookie });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    expect(
      (await suite.db.select().from(payments).where(eq(payments.id, payment!.id)))[0]!.state,
    ).toBe("attempting");
    const resolved = await send(app, "POST", path, { cookie: venue.managerCookie });
    expect({ status: resolved.status, body: await resolved.json() }).toMatchObject({
      status: 200,
      body: { outcome: "not_charged" },
    });
    expect(
      (await suite.db.select().from(payments).where(eq(payments.id, payment!.id)))[0]!.state,
    ).toBe("failed");
    const [resolvedBill] = await suite.db
      .select()
      .from(billPayments)
      .where(eq(billPayments.id, bill!.id));
    expect(resolvedBill!.state).toBe("failed");
  });
});

describe("payments settings", () => {
  const path = "/management-api/payments/settings";
  let venue: Venue;
  let app: Hono;
  beforeEach(async () => {
    venue = await seedVenueWithStaff();
    app = mountApp(venue);
  });
  const put = (body: object) => send(app, "PUT", path, { cookie: venue.managerCookie, body });

  it("returns the switches and requires hardware management", async () => {
    const response = await send(app, "GET", path, { cookie: venue.managerCookie });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      tipsEnabled: false,
      testProviders: false,
      testProvidersAvailable: false,
      revision: 0,
    });
    for (const method of ["GET", "PUT"] as const) {
      const refused = await send(app, method, path, {
        cookie: venue.staffCookie,
        ...(method === "PUT"
          ? { body: { tipsEnabled: true, testProviders: false, revision: 0 } }
          : {}),
      });
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({
        error: { code: "authorization.not_permitted" },
      });
    }
  });

  it("saves tips on Live, refuses practice providers and preserves provider choices", async () => {
    await withTransaction(suite.db, (tx) =>
      saveSettings(tx, PAYMENTS_SETTINGS, {
        doc: { providers: { stripe: false }, tipsEnabled: false, testProviders: false },
        expectedRevision: 0,
        personId: null,
      }),
    );
    const denied = await put({ tipsEnabled: true, testProviders: true, revision: 1 });
    expect(denied.status).toBe(409);
    expect(await denied.json()).toEqual({
      error: { code: "payment.test_providers_prepare_only", params: {} },
    });
    expect((await readPaymentsSettings(suite.db)).revision).toBe(1);

    const saved = await put({ tipsEnabled: true, testProviders: false, revision: 1 });
    expect(saved.status).toBe(200);
    const stale = await put({ tipsEnabled: false, testProviders: false, revision: 1 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error: { code: "settings.out_of_date", params: { module: "payments", revision: 2 } },
    });
    expect(await readPaymentsSettings(suite.db)).toEqual({
      doc: { providers: { stripe: false }, tipsEnabled: true, testProviders: false },
      revision: 2,
    });
  });

  it.each([
    ["tipsEnabled", null],
    ["testProviders", "true"],
    ["revision", -1],
    ["revision", 0.5],
  ])("refuses an invalid %s", async (field, value) => {
    const response = await put({
      tipsEnabled: false,
      testProviders: false,
      revision: 0,
      [field]: value,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management.request_invalid", params: { field } },
    });
    expect((await readPaymentsSettings(suite.db)).revision).toBe(0);
  });
});

describe("provider On/Off", () => {
  it("preserves the saved tips and practice switches when an administrator changes a provider", async () => {
    const venue = await seedVenueWithStaff();
    const [admin] = await seedPersons(suite.db, { displayName: "Administrator", role: "admin" });
    const session = await withTransaction(suite.db, async (tx) => {
      await saveSettings(tx, PAYMENTS_SETTINGS, {
        doc: { providers: { sumup: false }, tipsEnabled: true, testProviders: true },
        expectedRevision: 0,
        personId: null,
      });
      return startManagementSession(tx, { method: "password", personId: admin!.id });
    });
    const response = await send(
      mountApp(venue),
      "PUT",
      "/management-api/payments/providers/stripe/state",
      {
        cookie: `${MANAGEMENT_COOKIE}=${session.token}`,
        body: { enabled: false, revision: 1 },
      },
    );
    expect(response.status).toBe(200);
    expect(await readPaymentsSettings(suite.db)).toEqual({
      doc: { providers: { sumup: false, stripe: false }, tipsEnabled: true, testProviders: true },
      revision: 2,
    });
  });

  it("requires an administrator and retains credentials while reader additions are refused", async () => {
    const venue = await seedVenueWithStaff();
    const app = mountApp(venue);
    expect((await connectStripe(app, venue)).status).toBe(200);
    const change = (cookie: string, enabled: boolean, revision: number) =>
      send(app, "PUT", "/management-api/payments/providers/stripe/state", {
        cookie,
        body: { enabled, revision },
      });
    const refused = await change(venue.managerCookie, false, 0);
    expect(refused.status).toBe(403);
    expect({ status: refused.status, body: await refused.json() }).toMatchObject({
      status: 403,
      body: { error: { code: "authorization.not_permitted" } },
    });
    const [admin] = await seedPersons(suite.db, { displayName: "Administrator", role: "admin" });
    const session = await withTransaction(suite.db, (tx) =>
      startManagementSession(tx, { method: "password", personId: admin!.id }),
    );
    const cookie = `${MANAGEMENT_COOKIE}=${session.token}`;
    for (const [body, field] of [
      [{ enabled: null, revision: 0 }, "enabled"],
      [{ enabled: true, revision: "0" }, "revision"],
    ] as const) {
      const invalid = await send(app, "PUT", "/management-api/payments/providers/stripe/state", {
        cookie,
        body,
      });
      expect({ status: invalid.status, body: await invalid.json() }).toMatchObject({
        status: 400,
        body: { error: { code: "management.request_invalid", params: { field } } },
      });
    }
    const reader = await suite.db
      .insert(cardReaders)
      .values({ provider: "stripe", providerRef: nextRef(), name: "Front reader" })
      .returning();
    const inUse = await change(cookie, false, 0);
    expect({ status: inUse.status, body: await inUse.json() }).toMatchObject({
      status: 409,
      body: {
        error: { code: "payment.provider_in_use", params: { readerNames: ["Front reader"] } },
      },
    });
    await suite.db
      .update(cardReaders)
      .set({ disabledAt: nowIso(), unpairedAt: nowIso() })
      .where(eq(cardReaders.id, reader[0]!.id));
    const off = await change(cookie, false, 0);
    expect({ status: off.status, body: await off.json() }).toEqual({
      status: 200,
      body: { enabled: false, revision: 1 },
    });
    expect(
      await tryGetCredential(suite.db, RING, { purpose: stripeSeat.credentialPurpose }),
    ).not.toBeNull();
    const add = vi.spyOn(stripeSeat.readers, "add");
    const list = vi.spyOn(stripeSeat.readers, "list");
    for (const [path, body] of [
      [
        "/management-api/payments/readers",
        { providerId: "stripe", name: "New reader", reference: "tmr_new" },
      ],
      [
        "/management-api/payments/readers/adopt",
        { providerId: "stripe", name: "New reader", providerRef: "tmr_new" },
      ],
    ] as const) {
      const response = await send(app, "POST", path, { cookie: venue.managerCookie, body });
      expect({ status: response.status, body: await response.json() }).toMatchObject({
        status: 409,
        body: { error: { code: "payment.provider_disabled" } },
      });
    }
    expect(add).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    add.mockRestore();
    list.mockRestore();
    const on = await change(cookie, true, 1);
    expect({ status: on.status, body: await on.json() }).toEqual({
      status: 200,
      body: { enabled: true, revision: 2 },
    });
  });
});

it.each(["pair", "adopt"] as const)(
  "refuses %s if the provider is switched off during its reply",
  async (mode) => {
    const venue = await seedVenueWithStaff();
    const providerRef = nextRef();
    const turnOff = () =>
      withTransaction(suite.db, (tx) =>
        saveSettings(tx, PAYMENTS_SETTINGS, {
          doc: { ...PAYMENTS_SETTINGS.defaults(), providers: { stripe: false } },
          expectedRevision: 0,
          personId: null,
        }),
      );
    const remove = vi.fn(async () => {});
    const seat: CardProviderContribution = {
      ...stripeSeat,
      readers: {
        ...stripeSeat.readers,
        add: async () => {
          await turnOff();
          return { providerRef, status: "paired" };
        },
        list: async () => {
          await turnOff();
          return [{ providerRef, name: "Front reader" }];
        },
        remove,
      },
    };
    const app = mountApp(venue, [seat]);
    expect((await connectStripe(app, venue)).status).toBe(200);
    const response = await send(
      app,
      "POST",
      mode === "pair"
        ? "/management-api/payments/readers"
        : "/management-api/payments/readers/adopt",
      {
        cookie: venue.managerCookie,
        body: { providerId: "stripe", providerRef, reference: providerRef, name: "Front reader" },
      },
    );
    expect(
      await suite.db.select().from(cardReaders).where(eq(cardReaders.providerRef, providerRef)),
    ).toEqual([]);
    expect({ status: response.status, body: await response.json() }).toMatchObject({
      status: 409,
      body: { error: { code: "payment.provider_disabled" } },
    });
    expect(remove).not.toHaveBeenCalled();
  },
);

it("offers a reader for adoption after SumUp is switched off during pairing", async () => {
  const venue = await seedVenueWithStaff();
  const [admin] = await seedPersons(suite.db, { displayName: "Administrator", role: "admin" });
  const session = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { method: "password", personId: admin!.id }),
  );
  const base = "/management-api/payments";
  const provider = `${base}/providers/sumup`;
  const readers = "/v0.1/merchants/MC/readers";
  const reader = { id: "rdr_1", name: "Front reader", status: "paired" };
  const manager = { cookie: venue.managerCookie };
  let registered = false;
  const changeProviderState = (enabled: boolean, revision: number) =>
    send(app, "PUT", `${provider}/state`, {
      cookie: `${MANAGEMENT_COOKIE}=${session.token}`,
      body: { enabled, revision },
    });
  const app = mountApp(venue, [SUMUP_CARD_PROVIDER], suite.db, {
    fetch: async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname;
      const method = init?.method ?? "GET";
      if (method === "GET" && path === "/v0.1/memberships")
        return Response.json({ items: [{ resource_id: "MC", resource: { name: "Bar" } }] });
      if (method === "POST" && path === readers) {
        registered = true;
        expect((await changeProviderState(false, 0)).status).toBe(200);
        return Response.json(reader);
      }
      if (method === "GET" && path === readers)
        return Response.json({ items: registered ? [reader] : [] });
      if (method === "DELETE" && path === `${readers}/${reader.id}`) {
        registered = false;
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected SumUp request: ${method} ${path}`);
    },
  });
  const connected = await send(app, "POST", `${provider}/connect`, {
    ...manager,
    body: { apiKey: "sup_sk_test" },
  });
  expect(connected.status).toBe(200);

  const added = await send(app, "POST", `${base}/readers`, {
    ...manager,
    body: { providerId: "sumup", name: reader.name, code: "ABC123" },
  });
  expect({ status: added.status, body: await added.json() }).toMatchObject({
    status: 409,
    body: { error: { code: "payment.provider_disabled" } },
  });

  expect((await changeProviderState(true, 1)).status).toBe(200);
  const available = await send(app, "GET", `${provider}/available-readers`, manager);
  expect({ status: available.status, body: await available.json() }).toEqual({
    status: 200,
    body: [{ providerRef: reader.id, name: reader.name, status: "available" }],
  });
  const adopted = await send(app, "POST", `${base}/readers/adopt`, {
    ...manager,
    body: { providerId: "sumup", providerRef: reader.id, name: reader.name },
  });
  expect(adopted.status).toBe(201);
  expect(await suite.db.select({ providerRef: cardReaders.providerRef }).from(cardReaders)).toEqual(
    [{ providerRef: reader.id }],
  );
});

describe("backup-machine audit read", () => {
  it("requires manager access and selects the latest successful local-day summaries", async () => {
    const venue = await seedVenueWithStaff();
    const app = mountApp(venue);
    const path = "/management-api/payments/backup-audit?day=2026-07-02";
    expect((await send(app, "GET", path)).status).toBe(401);
    expect((await send(app, "GET", path, { cookie: venue.staffCookie })).status).toBe(403);
    const row = {
      references: ["charge"],
      amount: "10.25",
      settledAt: "2026-07-01T22:30:00.000Z",
      reason: "ambiguous",
    };
    for (const [from, generation, state, summary] of [
      ["2026-07-01", 0, "succeeded", { backupMatches: [], backupUnmatched: [] }],
      ["2026-07-01", 1, "succeeded", { backupMatches: [], backupUnmatched: [row] }],
      ["2026-07-01", 2, "failed", { backupMatches: [], backupUnmatched: [] }],
      ["2026-07-02", 0, "succeeded", { backupMatches: [], backupUnmatched: [] }],
    ] as const)
      await suite.db.insert(reconciliationRuns).values({
        duty: "payments.reconcile.sumup",
        periodFrom: `${from}T00:00:00.000Z`,
        periodTo: from === "2026-07-01" ? "2026-07-02T00:00:00.000Z" : "2026-07-03T00:00:00.000Z",
        generation,
        state,
        summary,
      });
    const answer = await send(app, "GET", path, { cookie: venue.managerCookie });
    expect(answer.status, JSON.stringify(await answer.clone().json())).toBe(200);
    expect(await answer.json()).toEqual({
      day: "2026-07-02",
      timeZone: "Europe/Madrid",
      complete: true,
      backupMatches: [],
      backupUnmatched: [row],
      pairedAudit: { complete: false, matched: 0, toCheck: 0, rows: [] },
      refundAudit: {
        complete: false,
        checkedAt: [],
        matches: [],
        agreements: [],
        exceptions: [],
        outside: [],
      },
    });
    const bad = await send(app, "GET", "/management-api/payments/backup-audit?day=2026-02-30", {
      cookie: venue.managerCookie,
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "management.request_invalid" } });
  });
});

it("reports paired SumUp captures and charges once for the selected Madrid day", async () => {
  const venue = await seedVenueWithStaff();
  const manager = await seedPerson(suite.db, { displayName: "Hold reviewer" });
  const [closedParty, openParty] = await suite.db
    .insert(parties)
    .values([
      {
        openedBy: manager,
        closedBy: manager,
        closedAt: nowIso(),
        state: "closed",
        tableNames: ["Table 6"],
      },
      { openedBy: manager },
    ])
    .returning();
  const { id: zoneId } = await seedZone(suite.db, { name: "Terrace" });
  const [table] = await suite.db
    .insert(diningTables)
    .values({ label: "Table 9", zoneId })
    .returning();
  await suite.db.insert(partyTables).values({ partyId: openParty!.id, tableId: table!.id });
  const order = await seedWorkingOrder(suite.db, { partyId: closedParty!.id, billNumber: 41 });
  const linkedOrder = await seedWorkingOrder(suite.db, { partyId: openParty!.id, orderNumber: 42 });
  const delivered = await seedWorkingOrder(suite.db, { deliveryTableId: table!.id });
  const deviceId = await seedDevice();
  const readers = await suite.db
    .insert(cardReaders)
    .values([
      { name: "Counter reader", provider: "sumup", providerRef: "counter-reader" },
      { name: "Terrace reader", provider: "sumup", providerRef: "terrace-reader" },
    ])
    .returning();
  const start = "2026-07-01T22:00:00.000Z";
  const checkedAt = "2026-07-02T02:00:00.000Z";
  const entries = [
    ["before-day", "2026-07-01T21:59:59.999Z"],
    ["match", start],
    ["before-check-refund", start],
    ["before-check-partial-refund", start],
    ["after-check-refund", start],
    ["sumup-refund", start],
    ["multiple-findings", start],
    ["held-resolved", start],
    ["no-evidence", start],
    ["unpaid", null],
    ["linked", null],
    ["next-day", "2026-07-02T22:00:00.000Z"],
  ] as const;
  await suite.db.insert(payments).values(
    entries.map(([paymentRef, settledAt]) => ({
      workingOrderId:
        paymentRef === "linked"
          ? linkedOrder.id
          : paymentRef === "after-check-refund"
            ? delivered.id
            : order.id,
      source: "device" as const,
      deviceId,
      readerId: readers[paymentRef === "linked" ? 1 : 0]!.id,
      provider: "sumup",
      paymentRef,
      externalRef: settledAt === null ? null : `charge-${paymentRef}`,
      amount: 1000,
      state: settledAt === null ? ("attempting" as const) : ("captured" as const),
      settledAt,
      createdAt: paymentRef === "linked" ? "2026-07-01T21:59:00.000Z" : start,
      ...(paymentRef === "held-resolved"
        ? {
            holdProviderAmount: 1100,
            heldAt: start,
            holdOutcome: "kept" as const,
            holdDecidedAt: checkedAt,
            holdDecidedBy: manager,
          }
        : {}),
    })),
  );
  await withTransaction(suite.db, async (tx) => {
    for (const [paymentRef, at, amount] of [
      ["before-check-refund", start, "10"],
      ["before-check-partial-refund", start, "5"],
      ["before-check-partial-refund", "2026-07-02T10:00:00.000Z", "5"],
      ["after-check-refund", "2026-07-02T10:00:00.000Z", "10"],
    ] as const)
      await recordRefund(tx, {
        provider: "sumup",
        paymentRef,
        amount: decimal(amount),
        at: new Date(at),
      });
  });
  const charge = { amount: "10.00", settledAt: start };
  const linked = { ...charge, references: ["linked-charge"], hintedPaymentRef: "linked" };
  const standalone = { ...charge, references: ["standalone-charge"] };
  const unlinked = { ...standalone, hintedPaymentRef: null };
  const finding = {
    paymentRef: "multiple-findings",
    references: ["charge-multiple-findings"],
    localState: "captured",
    localAmount: "10.00",
    settledAmount: "11.00",
    workingOrderId: order.id,
  };
  await suite.db.insert(reconciliationRuns).values([
    ...[0, 1].map((generation) => ({
      duty: "payments.reconcile.sumup",
      periodFrom: "2026-07-01T00:00:00.000Z",
      periodTo: "2026-07-02T00:00:00.000Z",
      state: "succeeded" as const,
      generation,
      finishedAt: generation === 0 ? checkedAt : "2026-07-03T02:00:00.000Z",
      summary: {
        backupMatches: [],
        backupUnmatched: [],
        chargeAudit: {
          matches: [
            "before-day",
            "match",
            "sumup-refund",
            ...(generation === 0 ? ["after-check-refund"] : []),
          ].map((paymentRef) => ({
            paymentRef,
            providerRefunded: paymentRef === "sumup-refund",
          })),
          missingLocal: [linked, unlinked],
        },
        drift: [finding],
        orphan: [finding],
      },
    })),
    {
      duty: "payments.reconcile.sumup",
      periodFrom: "2026-07-02T00:00:00.000Z",
      periodTo: "2026-07-03T00:00:00.000Z",
      state: "succeeded",
      finishedAt: "2026-07-03T02:00:00.000Z",
      summary: {
        backupMatches: [],
        backupUnmatched: [{ ...standalone, reason: "unmatched", kind: "charge" }],
        chargeAudit: { matches: [], missingLocal: [linked, unlinked] },
      },
    },
  ]);
  const response = await send(
    mountApp(venue),
    "GET",
    "/management-api/payments/backup-audit?day=2026-07-02",
    {
      cookie: venue.managerCookie,
    },
  );
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  const { pairedAudit, backupUnmatched } = await response.json();
  expect(pairedAudit).toMatchObject({ complete: false, matched: 2, toCheck: 5 });
  const rows = pairedAudit.rows as { paymentRef: string; statuses: string[] }[];
  expect(
    Object.fromEntries(rows.map(({ paymentRef, statuses }) => [paymentRef, statuses])),
  ).toEqual({
    match: ["matched"],
    "before-check-refund": ["refunded_before_check"],
    "before-check-partial-refund": ["partly_refunded_before_check"],
    "after-check-refund": ["matched"],
    "sumup-refund": ["refunded_at_sumup"],
    "multiple-findings": ["drift", "orphan"],
    "held-resolved": ["resolved"],
    "no-evidence": ["not_checked"],
    linked: ["missing_local"],
  });
  expect(rows).toHaveLength(9);
  const byRef = (ref: string) => rows.find((row) => row.paymentRef === ref);
  expect(byRef("match")).toMatchObject({
    readerName: "Counter reader",
    billNumber: 41,
    tableName: "Table 6",
  });
  expect(byRef("linked")).toMatchObject({
    readerName: "Terrace reader",
    billNumber: null,
    orderNumber: 42,
    tableName: "Table 9",
  });
  expect(byRef("after-check-refund")).toMatchObject({ tableName: "Table 9" });
  expect(byRef("before-check-partial-refund")).toMatchObject({ amount: "10.00" });
  expect(backupUnmatched).toMatchObject([{ kind: "charge", references: ["standalone-charge"] }]);
});

it.each(["sumup", "manual"])(
  "compares current %s refunds on passive reads without provider I/O or a new audit",
  async (provider) => {
    const venue = await seedVenueWithStaff();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const app = mountApp(venue, PROVIDERS, suite.db, { fetch });
    const order = await seedWorkingOrder(suite.db, { source: "dashboard", orderNumber: 1 });
    await suite.db.insert(payments).values({
      workingOrderId: order.id,
      source: "device",
      deviceId: await seedDevice(),
      provider,
      externalProvider: provider === "manual" ? "connected_account" : null,
      paymentRef: "refund-payment",
      externalRef: provider === "manual" ? "machine-operation" : "refund-charge",
      amount: 1000,
      state: "captured",
      settledAt: provider === "manual" ? "2026-06-01T23:40:00.000Z" : "2026-06-01T12:00:00.000Z",
    });
    for (const day of ["2026-07-01", "2026-07-02"])
      await suite.db.insert(reconciliationRuns).values({
        duty: "payments.reconcile.sumup",
        periodFrom: `${day}T00:00:00.000Z`,
        periodTo: new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString(),
        generation: 0,
        state: "succeeded",
        summary: {
          backupMatches: [],
          backupUnmatched: [],
          refundEvidence: {
            complete: true,
            checkedAt: "2026-07-03T00:05:00.000Z",
            parents: [
              {
                processorRef: "refund-charge",
                events: [{ id: "refund-1", amount: "2.35", at: "2026-07-02T12:00:00.000Z" }],
              },
            ],
          },
        },
      });
    if (provider === "manual")
      await suite.db.insert(reconciliationRuns).values({
        duty: "payments.reconcile.sumup",
        periodFrom: "2026-06-02T00:00:00.000Z",
        periodTo: "2026-06-03T00:00:00.000Z",
        generation: 0,
        state: "succeeded",
        summary: {
          backupMatches: [{ paymentRef: "refund-payment", references: ["refund-charge"] }],
          refundEvidence: { complete: true, checkedAt: "2026-06-02T00:05:00.000Z", parents: [] },
        },
      });
    const read = async () => {
      const response = await app.request("/management-api/payments/backup-audit?day=2026-07-02", {
        headers: { cookie: venue.managerCookie, "x-waitron-live": "1" },
      });
      expect(response.status).toBe(200);
      return response.json();
    };
    expect((await read()).refundAudit.exceptions).toMatchObject([
      { reason: "missing_local", providerRefundRef: "refund-1" },
    ]);
    await withTransaction(suite.db, async (tx) => {
      await recordRefund(tx, {
        provider,
        paymentRef: "refund-payment",
        amount: decimal("2.35"),
        ...(provider === "sumup" ? { providerRefundRef: "refund-1" } : {}),
        at: new Date("2026-07-02T12:01:00.000Z"),
      });
    });
    const result = await read();
    expect(result.refundAudit[provider === "sumup" ? "matches" : "agreements"]).toMatchObject([
      { paymentRef: "refund-payment", localAmount: "2.35", providerAmount: "2.35" },
    ]);
    expect(result.refundAudit.exceptions).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(await suite.db.select().from(reconciliationRuns)).toHaveLength(
      provider === "manual" ? 3 : 2,
    );
  },
);

describe("abandoned-refund outcome read", () => {
  it("requires manager access and shows a claimed payment despite an occupied orphan alert", async () => {
    const venue = await seedVenueWithStaff();
    const order = await seedWorkingOrder(suite.db, { source: "dashboard", status: "abandoned" });
    await suite.db.insert(payments).values({
      workingOrderId: order.id,
      nodeId: await seedNode(suite.db),
      source: "device",
      deviceId: await seedDevice(),
      provider: "sumup",
      paymentRef: "abandoned-order-charge",
      externalRef: "sumup-charge",
      amount: 1050,
      state: "captured",
      settledAt: "2026-11-14T10:00:00.000Z",
      reconcileRemediatedAt: "2026-11-14T10:01:00.000Z",
    });
    await withTransaction(suite.db, (tx) =>
      recordIncidentOnce(tx, {
        origin: jobOrigin("payment_check"),
        error: new AppError("payment.reconcile_orphan", { payments: [], count: 1 }),
        severity: "error",
        detectedAt: new Date("2026-11-13T10:00:00Z"),
      }),
    );
    const app = mountApp(venue);
    const path = "/management-api/payments/abandoned-refunds";
    expect((await send(app, "GET", path)).status).toBe(401);
    expect((await send(app, "GET", path, { cookie: venue.staffCookie })).status).toBe(403);
    const answer = await send(app, "GET", path, { cookie: venue.managerCookie });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual([
      {
        paymentRef: "abandoned-order-charge",
        workingOrderId: order.id,
        externalRef: "sumup-charge",
        amount: "10.50",
        claimedAt: "2026-11-14T10:01:00.000Z",
        settledAt: "2026-11-14T10:00:00.000Z",
        outcome: "unconfirmed",
      },
    ]);
  });
});

it.each(["saved-off", "unapplied"])(
  "refuses provider On and reader adoption with Payments %s",
  async (state) => {
    const venue = await seedVenueWithStaff();
    const [admin] = await seedPersons(suite.db, { displayName: "Administrator", role: "admin" });
    const session = await withTransaction(suite.db, (tx) =>
      startManagementSession(tx, { method: "password", personId: admin!.id }),
    );
    const cookie = `${MANAGEMENT_COOKIE}=${session.token}`;
    const app = mountApp(venue, PROVIDERS, suite.db, { paymentsEnabled: state !== "unapplied" });
    expect((await connectStripe(app, venue)).status).toBe(200);
    if (state === "saved-off") await seedModuleSettings(suite.db, { payments: false });
    for (const [method, path, body] of [
      ["PUT", "/management-api/payments/providers/stripe/state", { enabled: true, revision: 0 }],
      [
        "POST",
        "/management-api/payments/readers",
        { providerId: "stripe", reference: "tmr_off", name: "Front" },
      ],
      [
        "POST",
        "/management-api/payments/readers/adopt",
        { providerId: "stripe", providerRef: "tmr_off", name: "Front" },
      ],
    ] as const) {
      const response = await send(app, method, path, { cookie, body });
      expect({ status: response.status, body: await response.json() }).toMatchObject({
        status: 409,
        body: { error: { code: "module.disabled" } },
      });
    }
    expect(await suite.db.select().from(cardReaders)).toEqual([]);
    expect(
      await tryGetCredential(suite.db, RING, { purpose: stripeSeat.credentialPurpose }),
    ).not.toBeNull();
  },
);
