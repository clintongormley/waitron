import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { DEFAULT_SKIP_RETRY_MS, drain, type DrainDeps } from "@waitron/fiscal-verifactu";
import { seedPendingEnvios } from "@waitron/fiscal-verifactu/test/drain-fixtures.js";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { runLoop } from "./loop.js";
import { runPass } from "./pass.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const START = new Date("2026-07-21T00:01:00.000Z");

const log = () => {};

describe("the filing loop wakes for a failed batch's scheduled retry", () => {
  it.each([
    { attempts: 1, gateSeconds: 60, sleeps: [60_000, 60_000], retryAt: 120_000 },
    { attempts: 1, gateSeconds: 180, sleeps: [120_000, 60_000], retryAt: 180_000 },
    { attempts: 6, gateSeconds: 60, sleeps: [60_000, 3_540_000], retryAt: 3_600_000 },
  ])(
    "retries after $retryAt ms with $attempts prior failures and a $gateSeconds-second AEAT wait",
    async ({ attempts, gateSeconds, sleeps, retryAt }) => {
      const seeded = await seedPendingEnvios(suite.db, { count: 1 });
      await suite.db.execute(sql`
        update envios set intentos = ${attempts} where registro_id = ${seeded.registroIds[0]}
      `);
      await suite.db.execute(sql`
        insert into envio_flujo (id, proximo_envio_en, tiempo_espera_seg)
        values (1, ${START.toISOString()}, ${gateSeconds})
      `);
      const aeat = createFakeAeat({ serverNow: START, tiempoEsperaInicial: gateSeconds });
      const transport = aeat.client();
      let clock = START.getTime();
      const submittedAt: number[] = [];
      const deps: DrainDeps = {
        db: suite.db,
        environment: "production",
        skipRetryMs: DEFAULT_SKIP_RETRY_MS,
        resolveClient: () =>
          Promise.resolve({
            ...transport,
            submit: async (header, records) => {
              submittedAt.push(clock - START.getTime());
              if (submittedAt.length === 1) throw new Error("network down");
              return transport.submit(header, records);
            },
          }),
      };
      const controller = new AbortController();
      const slept: number[] = [];
      const accepted: number[] = [];
      let passes = 0;
      try {
        await runLoop({
          pass: async (at) => {
            const report = await runPass(
              {
                drain: async (now) => {
                  const result = await drain(deps, now);
                  accepted.push(result.recordsAccepted);
                  return result;
                },
                reconcile: () =>
                  Promise.resolve({
                    ran: [],
                    deferred: 0,
                    beyondHorizon: 0,
                    skipped: [],
                    nextDueAt: null,
                  }),
                awaitingCert: { current: false },
                monotonicMs: () => clock,
                log,
              },
              at,
            );
            if (++passes === 3) controller.abort();
            return report;
          },
          now: () => new Date(clock),
          sleep: (ms) => {
            slept.push(ms);
            clock += ms;
            return Promise.resolve();
          },
          signal: controller.signal,
          minTickMs: 5_000,
          maxTickMs: 3_600_000,
          log,
        });
      } finally {
        controller.abort();
      }

      expect(slept).toEqual(sleeps);
      expect(submittedAt).toEqual([0, retryAt]);
      expect(accepted).toEqual([0, 0, 1]);
      const { rows } = await suite.db.execute<{ estado: string; intentos: number }>(sql`
        select estado, intentos from envios where registro_id = ${seeded.registroIds[0]}
      `);
      expect(rows).toEqual([{ estado: "aceptado", intentos: attempts + 2 }]);
    },
  );
});
