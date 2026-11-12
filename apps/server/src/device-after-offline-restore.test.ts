import { seedDeviceProfiles } from "@waitron/db/testing/seed.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { fetch as httpFetch } from "undici";
import { afterEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import {
  deviceProfiles,
  devices,
  invoiceSeries,
  openVenueDatabase,
  venueLocationId,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { deviceOrigin, seriesId } from "@waitron/shared";
import { recordSale } from "@waitron/core";
import { fiscalAllocations, registroSif, VerifactuBackend } from "@waitron/fiscal-verifactu";
import { TENANT_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { saleInput, steadyClock } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import * as internetClock from "@waitron/fiscal-verifactu/src/hour-clock-internet.js";
import { stagedHourRestore } from "./testing/staged-hour-restore.js";
import { mountDeviceApi } from "./device-api.js";
import { mountJoinApi } from "./join-api.js";
import { createPairingMode } from "./pairing-mode.js";

vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let restore: Awaited<ReturnType<typeof stagedHourRestore>> | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await restore?.cleanup();
  restore = undefined;
});

it.each([
  ["archive", "mounted"],
  ["stream", "mounted"],
  ["archive", "http"],
  ["stream", "http"],
] as const)(
  "pairs a new device after offline %s recovery over %s without changing the recovered allocation",
  async (kind, transport) => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    const outsideClock = vi.spyOn(internetClock, "observeInternetHourClock").mockResolvedValue({
      source: "internet",
      result: "unavailable",
      reason: "tls",
    });
    restore = await stagedHourRestore(suite, kind, `device-after-${kind}`, { interactive: true });
    expect(await suite.db.select().from(devices)).toEqual([]);
    const journal = restore.journal();
    await restore.runInteractive();
    expect(outsideClock).toHaveBeenCalled();
    const recovered = await restore.snapshot();
    expect(recovered.allocations.map((row) => row.installationIdentity)).toEqual([
      "0CNNY",
      "0CNQT",
    ]);
    expect(recovered.series.filter((row) => row.retiredAt === null).map((row) => row.code)).toEqual(
      ["A-0CNQT", "FF-0CNQT", "R-0CNQT"],
    );
    const store = await openVenueDatabase(restore.venueDir);
    let listener: ReturnType<typeof serve> | undefined;
    try {
      expect(await store.venue.select().from(devices)).toEqual([]);
      const cfg = {
        nodeId: TENANT_A.nodeId,
        locationId: await withTransaction(store.venue, venueLocationId),
        locale: "en",
        invoiceLocales: ["es"],
        tipsEnabled: false,
        simplifiedInvoiceLimit: null,
      };
      const [profile] = await seedDeviceProfiles(store.venue, {
        name: "Recovered till",
        formFactor: "till",
        capabilities: ["take-orders"],
      });
      const [person] = await seedPersons(store.venue, {
        displayName: "Recovery administrator",
        role: "admin",
      });
      const session = await withTransaction(store.venue, (tx) =>
        startManagementSession(tx, { personId: person!.id }),
      );
      const manager = `${MANAGEMENT_COOKIE}=${session.token}`;
      const app = new Hono();
      const pairingMode = createPairingMode();
      mountDeviceApi(app, { db: store.venue, cfg, pairingMode, secureCookies: true }, () => {});
      mountJoinApi(
        app,
        { db: store.venue, cfg, pairingMode, deviceAddress: "https://box.test" },
        () => {},
      );
      let origin = "https://box.test";
      if (transport === "http") {
        listener = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
        await new Promise<void>((resolve, reject) => {
          listener!.once("listening", resolve);
          listener!.once("error", reject);
        });
        const address = listener.address();
        if (address === null || typeof address === "string") throw new Error("missing HTTP port");
        origin = `http://127.0.0.1:${address.port}`;
      }
      const send = (path: string, cookie?: string, body?: unknown) => {
        const options = {
          method: body === undefined ? "GET" : "POST",
          headers: {
            ...(cookie === undefined ? {} : { cookie }),
            "content-type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        };
        return transport === "http"
          ? httpFetch(`${origin}${path}`, options)
          : app.request(`${origin}${path}`, options);
      };
      const hold = await send("/management-api/pairing-mode/holds", manager, {});
      expect(hold.status).toBe(200);
      const { holdId } = await hold.json();
      const knock = await send("/api/device/join", undefined, { name: "Fresh recovery device" });
      expect(knock.status).toBe(200);
      const cookie = knock.headers.get("set-cookie")!.split(";")[0]!;
      const { joinId, verificationNumber } = await knock.json();
      const pending = await send("/api/device/join/status", cookie);
      expect(await pending.json()).toMatchObject({ status: "pending" });
      const list = await send("/management-api/join-requests?kind=device", manager);
      expect(list.status).toBe(200);
      const [request] = await list.json();
      expect(request.id).toBe(joinId);
      const checked = await send(`/management-api/device-join-requests/${joinId}/check`, manager, {
        holdId,
        createdAt: request.createdAt,
        choice: verificationNumber,
      });
      expect(checked.status).toBe(204);
      const accepted = await send(
        `/management-api/device-join-requests/${joinId}/accept`,
        manager,
        { name: "Fresh recovery device", profileId: profile!.id, kitchenScreens: [] },
      );
      expect(accepted.status).toBe(200);
      const { deviceId } = await accepted.json();
      expect(deviceId).toBe(joinId);
      const self = await send("/api/device/me", cookie);
      expect(self.status).toBe(200);
      expect(await self.json()).toMatchObject({ deviceId, profileId: profile!.id });
      const approved = await send("/api/device/join/status", cookie);
      expect(await approved.json()).toMatchObject({ status: "approved" });
      expect(await store.venue.select().from(invoiceSeries)).toEqual(recovered.series);
      expect(await store.venue.select().from(fiscalAllocations)).toEqual(recovered.allocations);
      expect(await store.venue.select().from(registroSif)).toEqual(recovered.registrations);
      expect(restore.journal()).toBe(journal);
      const clock = { ...steadyClock, now: () => ({ ...steadyClock.now(), instant: new Date() }) };
      const backend = new VerifactuBackend({
        db: store.venue,
        clock,
        deploymentEnvironment: "preproduction",
        resolveClient: async () => {
          throw new TypeError("offline");
        },
      });
      const standard = recovered.series.find(
        (row) => row.retiredAt === null && row.purpose === "standard",
      )!;
      const sell = (id: string) =>
        withTransaction(store.venue, (tx) =>
          recordSale(
            tx,
            backend,
            saleInput({
              nodeId: cfg.nodeId,
              seriesId: seriesId(id),
              clock,
              origin: deviceOrigin(deviceId),
              settlement: { kind: "deferred" },
            }),
          ),
        );
      const retired = recovered.series.find(
        (row) => row.retiredAt !== null && row.purpose === "standard",
      )!;
      await expect(sell(retired.id)).rejects.toMatchObject({ code: "sale.series_retired" });
      await sell(standard.id);
      expect(store.venue.all(sql`select num_serie_factura from registros_facturacion`)).toEqual([
        { num_serie_factura: "A-0CNQT/1" },
      ]);
      expect(
        (await store.venue.select().from(invoiceSeries))
          .filter((row) => row.retiredAt !== null)
          .map((row) => row.nextNumber),
      ).toEqual([123, 123, 123]);
      expect(network).not.toHaveBeenCalled();
    } finally {
      try {
        if (listener !== undefined)
          await new Promise<void>((resolve, reject) =>
            listener!.close((error) => (error ? reject(error) : resolve())),
          );
      } finally {
        await store.close();
      }
    }
  },
);
