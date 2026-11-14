import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { Hono } from "hono";
import { afterEach, expect, it, vi } from "vitest";
import {
  invoiceSeries,
  openVenueDatabase,
  readStandardSeriesId,
  readTenant,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { startManagementSession } from "@waitron/identity";
import type { ModuleRouteContext } from "@waitron/module";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { seriesId } from "@waitron/shared";
import { recordSale } from "@waitron/core";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { fiscalAllocations, VerifactuBackend } from "@waitron/fiscal-verifactu";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import {
  aeatInvoiceNumber,
  heldInvoice,
  invoiceRecords,
  recordInvoiceNumber,
  registrationInstallationName,
  storedInvoiceNumbers,
} from "@waitron/fiscal-verifactu/test/invoice-records.js";
import {
  saleInput,
  staticResolver,
  steadyClock,
} from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { drain } from "@waitron/fiscal-verifactu/src/drain.js";
import { createReconciliationSweep } from "@waitron/fiscal-verifactu/src/reconcile-sweep.js";
import { mountFilingOverview } from "@waitron/fiscal-verifactu/src/filing-overview-routes.js";
import { assertNoActiveConflict } from "@waitron/fiscal-verifactu/src/conflict-evidence.js";
import { stagedHourCrash } from "./testing/staged-hour-crash.js";

vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
// Stands in for the start's internet time check (`resume` in hosted-hour-recovery.ts); the rest
// of the journey runs with no network.
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 0,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }),
}));

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let fixture: Awaited<ReturnType<typeof stagedHourCrash>> | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await fixture?.cleanup();
  fixture = undefined;
});

const offline = async () => {
  throw new TypeError("offline");
};

it.each(["archive", "stream"] as const)(
  "a %s restore, with its start's internet time check stood in for, sells on a new series and later lists the old box's invoices AEAT holds",
  async (kind) => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    const f = (fixture = await stagedHourCrash(suite, kind, `offline-recovery-${kind}`));
    const originalRecords = await suite.db.select().from(invoiceRecords);
    expect(originalRecords.map(recordInvoiceNumber)).toEqual(["A-0CNNW/1"]);

    await expect(f.run()).resolves.toBe(true);
    const restored = await f.snapshot();
    expect(restored.records).toEqual(originalRecords);
    expect(
      restored.registrations
        .filter((row) => row.revocadoEn === null)
        .map(registrationInstallationName),
    ).toEqual(["0CNQR"]);
    expect(restored.allocations.map((row) => row.installationIdentity)).toEqual(["0CNNW", "0CNQR"]);

    // The old box, switched back on later, sells under its own series and files both invoices.
    const aeat = createFakeAeat();
    const oldBox = new VerifactuBackend({
      db: suite.db,
      deploymentEnvironment: "preproduction",
      clock: steadyClock,
      resolveClient: offline,
    });
    const oldSeries = await readStandardSeriesId(suite.db, f.node.nodeId);
    await withTransaction(suite.db, (tx) =>
      recordSale(tx, oldBox, saleInput({ nodeId: f.node.nodeId, seriesId: seriesId(oldSeries) })),
    );
    await drain(
      {
        db: suite.db,
        resolveClient: staticResolver(aeat.client()),
        environment: "preproduction",
        skipRetryMs: 300_000,
      },
      new Date("2026-03-02T00:00:00Z"),
    );
    expect(aeat.stored().map((row) => row.key.split("|")[1])).toEqual(["A-0CNNW/1", "A-0CNNW/123"]);

    const store = await openVenueDatabase(f.venueDir);
    try {
      const [person] = await seedPersons(store.venue, {
        displayName: "Recovery administrator",
        role: "admin",
      });
      const session = await withTransaction(store.venue, (tx) =>
        startManagementSession(tx, { personId: person!.id }),
      );
      const app = new Hono();
      mountFilingOverview(
        app,
        {
          db: store.venue,
          recordGeneration: { nodeId: f.node.nodeId } as unknown as NonNullable<
            ModuleRouteContext["recordGeneration"]
          >,
        },
        () => {},
      );
      const readFiling = async () => {
        const res = await app.request("/management-api/fiscal-filing", {
          headers: { cookie: `${MANAGEMENT_COOKIE}=${session.token}` },
        });
        expect(res.status).toBe(200);
        return res.json();
      };
      const offlineFiling = await readFiling();
      expect(offlineFiling.missingHistory).toEqual({
        notIssuedHere: [],
        identityChanges: [
          {
            installationName: "0CNQR",
            earlierInstallationName: "0CNNW",
            lastHeldInvoice: heldInvoice("A-0CNNW/1", "2026-03-01"),
            activatedAt: expect.any(String),
          },
        ],
      });

      const clock = { ...steadyClock, now: () => ({ ...steadyClock.now(), instant: new Date() }) };
      const backend = new VerifactuBackend({
        db: store.venue,
        clock,
        deploymentEnvironment: "preproduction",
        resolveClient: offline,
      });
      const standard = (purpose: "live" | "retired") =>
        restored.series.find(
          (row) => row.purpose === "standard" && (row.retiredAt === null) === (purpose === "live"),
        )!;
      const sell = (id: string) =>
        withTransaction(store.venue, (tx) =>
          recordSale(
            tx,
            backend,
            saleInput({ nodeId: f.node.nodeId, seriesId: seriesId(id), clock }),
          ),
        );
      const numbers = () => storedInvoiceNumbers(store.venue);
      await sell(standard("live").id);
      await expect(sell(standard("retired").id)).rejects.toMatchObject({
        code: "sale.series_retired",
      });
      expect(numbers()).toEqual(["A-0CNNW/1", "A-0CNQR/1"]);

      const allocationsBefore = await store.venue.select().from(fiscalAllocations);
      const tenant = await withTransaction(store.venue, readTenant);
      const sweep = createReconciliationSweep({
        db: store.venue,
        clock,
        resolveClient: staticResolver(aeat.client()),
        retryMs: 60_000,
        scope: {
          nodeId: f.node.nodeId,
          historyNodeIds: [f.node.nodeId],
          taxpayerId: tenant!.taxId,
          environment: "preproduction",
        },
      });
      const swept = await sweep(new Date());
      expect(swept.periods.map((period) => [period.year, period.month, period.outcome])).toEqual([
        ["2026", "03", "observed"],
        ["2026", "10", "observed"],
      ]);

      const onlineFiling = await readFiling();
      expect(
        onlineFiling.missingHistory.notIssuedHere.map(
          (row: { seriesCode: string; invoice: Parameters<typeof aeatInvoiceNumber>[0] }) => [
            row.seriesCode,
            aeatInvoiceNumber(row.invoice),
          ],
        ),
      ).toEqual([["A-0CNNW", "A-0CNNW/123"]]);
      expect(onlineFiling.activeConflicts).toEqual([]);
      await withTransaction(store.venue, (tx) => assertNoActiveConflict(tx, f.node.nodeId));
      expect(
        (await store.venue.select().from(invoiceSeries))
          .filter((row) => row.retiredAt === null)
          .map((row) => row.code),
      ).toEqual(["A-0CNQR", "FF-0CNQR", "R-0CNQR"]);
      expect(await store.venue.select().from(fiscalAllocations)).toEqual(allocationsBefore);
      await sell(standard("live").id);
      expect(numbers()).toEqual(["A-0CNNW/1", "A-0CNQR/1", "A-0CNQR/2"]);
      expect(network).not.toHaveBeenCalled();
    } finally {
      await store.close();
    }
  },
);
