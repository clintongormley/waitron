import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { stampDeployment } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createClient } from "@waitron/verifactu";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { drain, resetInFlightClaims, DEFAULT_SKIP_RETRY_MS } from "./drain.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const now = new Date("2026-07-21T00:10:00Z");
const flag = "<sf:Incidencia>S</sf:Incidencia>";

it.each(["restart", "stale"])("flags the interrupted claim and unsent tail on %s", async (mode) => {
  const seeded = await seedPendingEnvios(suite.db, { count: 2 });
  await suite.db.execute(sql`
    update envios set estado = 'enviando', enviado_en = '2026-07-21T00:00:00.000Z'
    where registro_id = ${seeded.registroIds[0]!}
  `);
  if (mode === "restart") await resetInFlightClaims(suite.db, now);
  const authority = createFakeAeat({ serverNow: now });
  const xml: string[] = [];
  const client = createClient({
    endpoint: "https://example.test/soap",
    fetch: (input, init) => {
      xml.push(String(init?.body));
      return authority.fetch(input, init);
    },
  });
  const result = await drain(
    {
      db: suite.db,
      resolveClient: async () => client,
      environment: "production",
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
    },
    now,
  );
  expect(result.recordsAccepted).toBe(2);
  expect(xml).toHaveLength(1);
  expect(xml[0]).toContain(flag);
  expect((await suite.db.execute(sql`select technical_incidence from envios`)).rows).toEqual([
    { technical_incidence: 1 },
    { technical_incidence: 1 },
  ]);
});

it.each([
  { stamp: "production", row: "production", gate: "elapsed", expected: 1 },
  { stamp: "preproduction", row: "preproduction", gate: "elapsed", expected: 1 },
  { stamp: null, row: "production", gate: "elapsed", expected: 0 },
  { stamp: "production", row: "production", gate: "waiting", expected: 0 },
  { stamp: "production", row: "preproduction", gate: "elapsed", expected: 0 },
  { stamp: "production", row: null, gate: "elapsed", expected: 0 },
  { stamp: "production", row: "production", gate: "retry", expected: 0 },
] as const)(
  "infers pending-only restart for $stamp/$row/$gate as $expected",
  async ({ stamp, row, gate, expected }) => {
    await seedPendingEnvios(suite.db, { count: 1, entorno: row });
    if (stamp !== null) await stampDeployment(suite.db, stamp);
    if (gate === "waiting")
      await suite.db.execute(sql`
    insert into envio_flujo (id, proximo_envio_en, tiempo_espera_seg)
    values (1, '2026-07-21T00:11:00.000Z', 60)
  `);
    if (gate === "retry")
      await suite.db.execute(sql`
    update envios set proximo_intento_en = '2026-07-21T00:11:00.000Z'
  `);
    const before = (
      await suite.db.execute(
        sql`select estado, intentos, incidencia, proximo_intento_en from envios`,
      )
    ).rows;
    await resetInFlightClaims(suite.db, now);
    expect((await suite.db.execute(sql`select technical_incidence from envios`)).rows).toEqual([
      { technical_incidence: expected },
    ]);
    expect(
      (
        await suite.db.execute(
          sql`select estado, intentos, incidencia, proximo_intento_en from envios`,
        )
      ).rows,
    ).toEqual(before);
  },
);

it("does not open an incident on an idle reset or a live nonstale claim", async () => {
  await stampDeployment(suite.db, "production");
  await resetInFlightClaims(suite.db, now);
  expect((await suite.db.execute(sql`select * from envio_flujo`)).rows).toEqual([]);
  await seedPendingEnvios(suite.db, { count: 1 });
  await suite.db.execute(
    sql`update envios set estado = 'enviando', enviado_en = ${now.toISOString()}`,
  );
  const authority = createFakeAeat({ serverNow: now });
  const result = await drain(
    {
      db: suite.db,
      resolveClient: async () => authority.client(),
      environment: "production",
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
    },
    now,
  );
  expect(result.recordsSubmitted).toBe(0);
  expect((await suite.db.execute(sql`select technical_incidence from envios`)).rows).toEqual([
    { technical_incidence: 0 },
  ]);
  expect((await suite.db.execute(sql`select * from envio_flujo`)).rows).toEqual([]);
});

it("does not infer an outage for a recent pending row under the initial wait", async () => {
  await seedPendingEnvios(suite.db, { count: 1 });
  await stampDeployment(suite.db, "production");
  await suite.db.execute(sql`insert into envio_flujo (id, proximo_envio_en, tiempo_espera_seg)
    values (1, '2026-07-21T00:01:00.000Z', 60)`);
  await resetInFlightClaims(suite.db, new Date("2026-07-21T00:00:30Z"));
  expect((await suite.db.execute(sql`select technical_incidence from envios`)).rows).toEqual([
    { technical_incidence: 0 },
  ]);
});

it("does not mistake a pending cancellation or refusal-braked successor for a sendable batch", async () => {
  const seeded = await seedPendingEnvios(suite.db, { count: 3 });
  const authority = createFakeAeat({ serverNow: now });
  for (const key of seeded.facturaKeys) authority.reject(key, 1100, "Invalid test record");
  await drain(
    {
      db: suite.db,
      resolveClient: async () => authority.client(),
      environment: "production",
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
    },
    now,
  );
  const { appendPendingAlta, appendCancellation } = await import("../test/drain-fixtures.js");
  await appendCancellation(suite.db, seeded, seeded.registroIds[0]!, 4);
  await appendPendingAlta(suite.db, seeded, 5);
  await stampDeployment(suite.db, "production");
  const before = {
    deliveries: (await suite.db.execute(sql`select * from envios order by registro_id`)).rows,
    cases: (await suite.db.execute(sql`select * from filing_cases order by id`)).rows,
    incidents: (await suite.db.execute(sql`select * from incidents order by id`)).rows,
    acks: (await suite.db.execute(sql`select * from acks order by registro_id`)).rows,
  };
  await resetInFlightClaims(suite.db, new Date(now.getTime() + 120_000));
  expect({
    deliveries: (await suite.db.execute(sql`select * from envios order by registro_id`)).rows,
    cases: (await suite.db.execute(sql`select * from filing_cases order by id`)).rows,
    incidents: (await suite.db.execute(sql`select * from incidents order by id`)).rows,
    acks: (await suite.db.execute(sql`select * from acks order by registro_id`)).rows,
  }).toEqual(before);
  expect((await suite.db.execute(sql`select technical_incidence from envios`)).rows).toEqual(
    Array.from({ length: 5 }, () => ({ technical_incidence: 0 })),
  );
});

it.each([false, true])(
  "uses the production cap with a name boundary=%s before inferring a pending outage",
  async (nameBoundary) => {
    const seeded = await seedPendingEnvios(suite.db, { count: 0 });
    const { seedPinnedChain } = await import("../test/drain-fixtures.js");
    await seedPinnedChain(suite.db, seeded, {
      sifId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      firstSecuencia: 1,
      rows: Array.from({ length: 1000 }, (_, index) => ({
        nombreRazonEmisor: nameBoundary && index >= 500 ? "New business" : "Old business",
        generadoEn: "2026-07-20T19:20:30+01:00",
      })),
    });
    await stampDeployment(suite.db, "production");
    await suite.db.execute(sql`insert into envio_flujo (id, proximo_envio_en, tiempo_espera_seg)
    values (1, '2026-07-21T00:11:00.000Z', 60)`);
    await resetInFlightClaims(suite.db, now);
    const result = await suite.db.execute(
      sql`select sum(technical_incidence) as affected from envios`,
    );
    expect(result.rows).toEqual([{ affected: nameBoundary ? 0 : 1000 }]);
  },
);

it.each([null, "preproduction", "production"] as const)(
  "uses an interrupted record's own environment with stamp=%s",
  async (stamp) => {
    await seedPendingEnvios(suite.db, { count: 2, entorno: "preproduction" });
    if (stamp !== null) await stampDeployment(suite.db, stamp);
    await suite.db
      .execute(sql`update envios set estado = 'enviando', enviado_en = '2026-07-21T00:09:59.000Z'
    where registro_id = (select id from registros_facturacion where secuencia = 1)`);
    await resetInFlightClaims(suite.db, now);
    expect(
      (
        await suite.db.execute(
          sql`select estado, technical_incidence from envios order by registro_id`,
        )
      ).rows,
    ).toEqual(
      Array.from({ length: 2 }, () => ({
        estado: "pendiente",
        technical_incidence: stamp === "production" ? 0 : 1,
      })),
    );
  },
);
