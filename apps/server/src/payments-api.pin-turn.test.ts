import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPinThrottle, hashPin, persons, startManagementSession } from "@waitron/identity";
import { loadKeyRing } from "@waitron/credentials";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import { locationId, nodeId } from "@waitron/shared";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { mountPaymentsApi } from "./payments-api.js";
import { systemClock } from "./till-backend.js";
import {
  watchDerivations,
  watchedDerivationCount,
  watchedOrder,
} from "./testing/watched-scrypt.js";

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await importOriginal()),
);

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const INVALID = { error: { code: "pin.invalid", params: {} } };
const THROTTLED = { error: { code: "pin.throttled", params: { retryAfterSeconds: 2 } } };
const targets = [
  { route: "bill-payments", code: "bill.payment_not_found", param: "paymentId" },
  { route: "bill-refunds", code: "bill.refund_not_found", param: "refundId" },
] as const;

async function setup(role: "manager" | "staff" = "manager") {
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Operator", role, pinHash: hashPin("4321") })
    .returning({ id: persons.id });
  const session = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { personId: person!.id }),
  );
  const app = new Hono();
  mountPaymentsApi(
    app,
    {
      db: suite.db,
      backend: new FakeFiscalBackend(suite.db),
      clock: systemClock(),
      cfg: {
        nodeId: nodeId(randomUUID()),
        locationId: locationId(randomUUID()),
        locale: "es-ES",
        invoiceLocales: ["es-ES"],
        tipsEnabled: false,
        simplifiedInvoiceLimit: null,
      },
      ring: loadKeyRing({
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: "1",
      }),
      environment: "preproduction",
      providers: [],
      pool: {
        get: async () => {
          throw new Error("PIN checks must not reach a provider");
        },
        evict: () => {},
      },
      pinThrottle: createPinThrottle({ now: () => 1_000_000 }),
    },
    () => {},
  );
  const id = randomUUID();
  return {
    id,
    send: async (route: string, extra: Record<string, unknown>) =>
      app.request(`/management-api/payments/${route}/${id}/attest`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${MANAGEMENT_COOKIE}=${session.token}`,
        },
        body: JSON.stringify({ outcome: "failed", note: "Provider confirmed failure", ...extra }),
      }),
  };
}

describe("dashboard payment PIN attempts take turns", () => {
  afterEach(async () => {
    await watchedOrder();
  });

  it.each(targets)(
    "$route answers the earlier correct PIN before non-text attempts on either route",
    async ({ route, code, param }) => {
      const v = await setup();
      let malformed: Promise<Response>[] = [];
      watchDerivations("4321", () => {
        malformed = [{ pin: 4321 }, { pin: null }, {}, { pin: ["4321"] }, { pin: {} }].map(
          (extra, index) => v.send(targets[index % 2]!.route, extra),
        );
        return Promise.all(malformed);
      });

      const correct = await v.send(route, { pin: "4321" });
      const responses = await Promise.all(malformed);

      expect(correct.status).toBe(404);
      expect(await correct.json()).toEqual({ error: { code, params: { [param]: v.id } } });
      expect(
        await Promise.all(responses.map(async (res) => [res.status, await res.json()])),
      ).toEqual([
        [401, INVALID],
        [401, INVALID],
        [401, INVALID],
        [401, INVALID],
        [429, THROTTLED],
      ]);
      expect(watchedDerivationCount()).toBe(1);
    },
  );

  it.each(targets)("$route still refuses a lone wrong text PIN", async ({ route }) => {
    const v = await setup();
    const wrong = await v.send(route, { pin: "9999" });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual(INVALID);
  });

  it.each(targets)("$route still accepts a lone correct PIN", async ({ route, code, param }) => {
    const v = await setup();
    watchDerivations("4321");
    const correct = await v.send(route, { pin: "4321" });
    expect(correct.status).toBe(404);
    expect(await correct.json()).toEqual({ error: { code, params: { [param]: v.id } } });
    expect(watchedDerivationCount()).toBe(1);
  });

  it.each(targets)(
    "$route refuses a staff session before counting a malformed PIN",
    async ({ route }) => {
      const v = await setup("staff");
      const refused = await v.send(route, { pin: null });
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({
        error: { code: "authorization.not_permitted", params: { permission: "payments.manage" } },
      });
    },
  );
});
