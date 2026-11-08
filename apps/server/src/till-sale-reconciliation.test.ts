import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createFakeAeat } from "@waitron/verifactu/testing";
import type { VerifactuClient } from "@waitron/verifactu";
import { createReconciliationSweep } from "@waitron/fiscal-verifactu/src/reconcile-sweep.js";
import { provisionBillVenue } from "./testing/bill-venue.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const AT = new Date("2026-11-04T12:00:00.000Z");
afterEach(() => vi.unstubAllEnvs());
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("cash sales while reconciliation is unknown", () => {
  it.each(["pending", "failed", "incomplete"] as const)(
    "records cash once while the lookup is %s",
    async (mode) => {
      vi.stubEnv("WAITRON_ENV", "preproduction");
      const v = await provisionBillVenue(suite.db);
      const clock = {
        ...v.clock,
        now: () => ({ ...v.clock.now(), instant: AT, offsetMinutes: 60 }),
      };
      const app = v.appAt(clock);
      const sell = (workingOrderId: string) =>
        app.request("/api/sales", {
          method: "POST",
          headers: { cookie: v.cookie, "content-type": "application/json" },
          body: JSON.stringify({
            workingOrderId,
            zoneId: v.zoneId,
            lines: [{ menuItemId: v.offerFor("Paella"), quantity: "1" }],
            tender: { method: "cash", amount: "35.00" },
          }),
        });
      expect((await sell(randomUUID())).status).toBe(200);
      const before = (
        await suite.db.execute(sql`select * from registros_facturacion order by secuencia`)
      ).rows;
      const held = gate();
      let entered = false;
      const authority = createFakeAeat({ serverNow: AT }).client();
      const client: VerifactuClient = {
        submit: authority.submit.bind(authority),
        consultar: async (...args) => {
          entered = true;
          await held.promise;
          if (mode === "failed") throw new Error("authority unavailable");
          const response = await authority.consultar(...args);
          return mode === "incomplete"
            ? { ...response, IndicadorPaginacion: "S", ClavePaginacion: undefined }
            : response;
        },
      };
      const sweep = createReconciliationSweep({
        db: suite.db,
        clock,
        scope: {
          nodeId: v.cfg.nodeId,
          historyNodeIds: [v.cfg.nodeId],
          taxpayerId: "61000002T",
          environment: "preproduction",
        },
        resolveClient: async () => client,
        retryMs: 300_000,
        includeCurrentPeriod: true,
      });
      const lookup = sweep(AT);
      let lookupResult: Awaited<typeof lookup> | undefined;
      try {
        await vi.waitFor(() => expect(entered).toBe(true));
        if (mode !== "pending") {
          held.resolve();
          lookupResult = await lookup;
          expect(lookupResult.periods).toEqual([
            expect.objectContaining({ year: "2026", month: "11", outcome: "unknown" }),
          ]);
        }
        const id = randomUUID();
        const response = await sell(id);
        expect(response.status).toBe(200);
        const ticket = await response.json();
        expect(ticket).toMatchObject({
          invoiceNumber: "A/2",
          issuedAt: AT.toISOString(),
          total: "35.00",
          tender: { method: "cash", change: "0.00" },
        });
        const replay = await sell(id);
        expect(replay.status).toBe(200);
        expect((await replay.json()).invoiceNumber).toBe("A/2");
        const records = (
          await suite.db.execute(sql`select * from registros_facturacion order by secuencia`)
        ).rows;
        expect(records).toHaveLength(2);
        expect(records[0]).toEqual(before[0]);
        expect(
          (await suite.db.execute(sql`select count(*) as n, sum(amount) as paid from tenders`))
            .rows,
        ).toEqual([{ n: 2, paid: 7000 }]);
        expect(
          (await suite.db.execute(sql`select estado, count(*) as n from envios group by estado`))
            .rows,
        ).toEqual([{ estado: "pendiente", n: 2 }]);
      } finally {
        held.resolve();
        await lookup;
      }
    },
  );
});
