import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createClient } from "@waitron/verifactu";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendPendingAlta, seedPendingEnvios } from "../test/drain-fixtures.js";
import { drain, DEFAULT_SKIP_RETRY_MS } from "./drain.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

describe("A942 technical-outage submission header", () => {
  it.each([false, true])(
    "reports a preceding technical outage=%s without changing the record",
    async (outage) => {
      await seedPendingEnvios(suite.db, { count: 1 });
      const before = (await suite.db.execute(sql`select * from registros_facturacion order by id`))
        .rows;
      const authority = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
      const xml: string[] = [];
      let unavailable = outage;
      const client = createClient({
        endpoint: "https://example.test/soap",
        fetch: async (input, init) => {
          xml.push(String(init?.body));
          if (unavailable) throw new Error("network down");
          return authority.fetch(input, init);
        },
      });
      const deps = {
        db: suite.db,
        environment: "production" as const,
        skipRetryMs: DEFAULT_SKIP_RETRY_MS,
        resolveClient: async () => client,
      };
      const first = await drain(deps, new Date("2026-07-21T00:01:00Z"));
      if (outage) {
        expect(first.recordsAccepted).toBe(0);
        unavailable = false;
        const retried = await drain(deps, new Date("2026-07-21T00:02:01Z"));
        expect(retried.recordsAccepted).toBe(1);
        expect(xml).toHaveLength(2);
        expect(xml[0]).toContain("<sfLR:RegistroFactura>");
        expect(xml[1]).toContain("<sfLR:RegistroFactura>");
        expect(xml[1]!.slice(xml[1]!.indexOf("<sfLR:RegistroFactura>"))).toBe(
          xml[0]!.slice(xml[0]!.indexOf("<sfLR:RegistroFactura>")),
        );
      } else {
        expect(first.recordsAccepted).toBe(1);
        expect(xml).toHaveLength(1);
      }
      expect(
        (await suite.db.execute(sql`select * from registros_facturacion order by id`)).rows,
      ).toEqual(before);
      if (outage) expect(xml.at(-1)).toContain("<sf:Incidencia>S</sf:Incidencia>");
      else expect(xml.at(-1)).not.toContain("<sf:Incidencia>S</sf:Incidencia>");
    },
  );
  it("does not label a held validation probe as a technical outage", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 3 });
    const authority = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    for (const key of seeded.facturaKeys) authority.reject(key, 1100, "Invalid test record");
    const xml: string[] = [];
    const client = createClient({
      endpoint: "https://example.test/soap",
      fetch: async (input, init) => {
        xml.push(String(init?.body));
        return authority.fetch(input, init);
      },
    });
    const deps = {
      db: suite.db,
      environment: "production" as const,
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
      resolveClient: async () => client,
    };
    await drain(deps, new Date("2026-07-21T00:01:00Z"));
    const held = await appendPendingAlta(suite.db, seeded, 4);
    const stopped = await drain(deps, new Date("2026-07-21T00:02:00Z"));
    expect(stopped.batchesSent).toBe(0);
    const row = await suite.db.execute<{ estado: string; incidencia: number }>(sql`
      select estado, incidencia from envios where registro_id = ${held.registroId}
    `);
    expect(row.rows).toEqual([{ estado: "detenido", incidencia: 1 }]);
    xml.length = 0;
    const probe = await drain(deps, new Date("2026-07-21T01:02:00Z"));
    expect(probe.recordsSubmitted).toBe(1);
    expect(xml).toHaveLength(1);
    expect(xml[0]).not.toContain("<sf:Incidencia>S</sf:Incidencia>");
  });
});
