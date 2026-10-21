import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createClient } from "@waitron/verifactu";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { drain, DEFAULT_SKIP_RETRY_MS } from "./drain.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

it("new delivery rows default to no technical incidence", async () => {
  await seedPendingEnvios(suite.db, { count: 1 });
  const { rows } = await suite.db.execute(sql`select * from envios`);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ technical_incidence: 0 });
});

it("new flow state defaults to no open technical incident", async () => {
  await suite.db.execute(sql`
    insert into envio_flujo (id, proximo_envio_en, tiempo_espera_seg)
    values (1, '2026-07-21T00:00:00.000Z', 60)
  `);
  const { rows } = await suite.db.execute(sql`select * from envio_flujo`);
  expect(rows).toEqual([
    {
      id: 1,
      proximo_envio_en: "2026-07-21T00:00:00.000Z",
      tiempo_espera_seg: 60,
      technical_incident_token: null,
    },
  ]);
});

it("keeps the interruption across flow upserts and retains row evidence after recovery", async () => {
  await seedPendingEnvios(suite.db, { count: 1 });
  await suite.db.execute(sql`
    insert into envio_flujo (id, proximo_envio_en, tiempo_espera_seg)
    values (1, '2026-07-21T00:00:00.000Z', 120)
  `);
  let unavailable = true;
  const authority = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
  const client = createClient({
    endpoint: "https://example.test/soap",
    fetch: (input, init) => {
      if (unavailable) return Promise.reject(new Error("network down"));
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
  const open = (await suite.db.execute(sql`select * from envio_flujo`)).rows;
  expect(open).toEqual([
    {
      id: 1,
      proximo_envio_en: "2026-07-21T00:03:00.000Z",
      tiempo_espera_seg: 120,
      technical_incident_token: expect.any(String),
    },
  ]);
  unavailable = false;
  const recovered = await drain(deps, new Date("2026-07-21T00:03:01Z"));
  expect(recovered.recordsAccepted).toBe(1);
  expect((await suite.db.execute(sql`select * from envio_flujo`)).rows[0]).toMatchObject({
    technical_incident_token: null,
  });
  expect((await suite.db.execute(sql`select * from envios`)).rows[0]).toMatchObject({
    estado: "aceptado",
    technical_incidence: 1,
  });
});
