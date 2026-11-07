import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { captureError, stampDeployment, triggerRaised, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createFakeAeat } from "@waitron/verifactu/testing";
import type { RegistroConsultado, VerifactuClient } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedVenueNodes, TENANT_A } from "../test/fixtures.js";
import { withOperationAuthority } from "@waitron/module";
import { createHourPreparation } from "./hour-preparation.js";
import { compareHourClocks } from "./hour-clock.js";
import { activatePreparedModuleAllocation } from "./allocation-preparation.js";
import { createReconciliationSweep } from "./reconcile-sweep.js";
import { appendPendingAlta, seedPendingEnvios } from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { readActiveConflicts, assertNoActiveConflict } from "./conflict-evidence.js";
import { drain } from "./drain.js";
import { reconcile } from "./reconcile.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const NOW = new Date("2026-07-21T00:01:00Z");
const PERIOD = { year: "2026", month: "07" };

async function fixture() {
  const seeded = await seedPendingEnvios(suite.db, { count: 1 });
  const client = createFakeAeat({ serverNow: NOW }).client();
  await drain(
    {
      db: suite.db,
      resolveClient: staticResolver(client),
      environment: "production",
      skipRetryMs: 300_000,
    },
    NOW,
  );
  const real = await client.consultar(
    { ObligadoEmision: { NombreRazon: seeded.legalName, NIF: seeded.nif } },
    {
      Ejercicio: "2026",
      Periodo: "07",
      DatosAdicionalesRespuesta: { MostrarSistemaInformatico: "S" },
    },
  );
  const foreign: RegistroConsultado = {
    ...real.registros[0]!,
    IDFactura: {
      ...real.registros[0]!.IDFactura,
      NumSerieFactura: "S1/99",
      FechaExpedicionFactura: "19-07-2026",
    },
    DatosRegistroFacturacion: {
      ...real.registros[0]!.DatosRegistroFacturacion,
      RefExterna: "outside-record",
      Huella: "D".repeat(64),
    },
  };
  const returned = { ...real, registros: [...real.registros, foreign] };
  const observed: VerifactuClient = {
    submit: client.submit.bind(client),
    consultar: async () => returned,
  };
  return { seeded, real, foreign, returned, client: observed };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function run(f: Fixture, client = f.client, period = PERIOD) {
  return reconcile(
    {
      db: suite.db,
      clock: f.seeded.clock,
      resolveClient: staticResolver(client),
      scope: {
        nodeId: f.seeded.nodeId,
        historyNodeIds: [f.seeded.nodeId],
        taxpayerId: f.seeded.nif,
        environment: "production",
      },
    },
    period,
  );
}
async function snapshot() {
  const result: Record<string, unknown> = {};
  for (const table of [
    "registros_facturacion",
    "envios",
    "acks",
    "registro_sif",
    "invoice_series",
    "fiscal_allocations",
    "filing_cases",
    "cadenas",
  ])
    result[table] = (
      await suite.db.execute(sql`select * from ${sql.identifier(table)} order by rowid`)
    ).rows;
  return result;
}

it("stops on an externally held number in an active series without inventing a local invoice or filing case", async () => {
  const f = await fixture();
  const before = await snapshot();
  await run(f);
  const active = await withTransaction(suite.db, (tx) => readActiveConflicts(tx, f.seeded.nodeId));
  expect(active).toEqual([
    {
      lookupId: expect.any(String),
      sifId: f.seeded.sifId,
      installationIdentity: expect.any(String),
      invoiceIdentity: "S1/99",
      observedAt: expect.any(String),
      evidenceId: expect.any(String),
      cause: "fiscal.huella_divergente",
      evidence: {
        source: "consulta",
        invoice: f.foreign.IDFactura,
        reference: "outside-record",
        state: "Correcto",
        fingerprint: "D".repeat(64),
        system: expect.any(Object),
      },
    },
  ]);
  await expect(
    withTransaction(suite.db, (tx) => assertNoActiveConflict(tx, f.seeded.nodeId)),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "conflict_requires_administrator" },
  });
  expect(await snapshot()).toEqual(before);
  await run(f);
  expect(await withTransaction(suite.db, (tx) => readActiveConflicts(tx, f.seeded.nodeId))).toEqual(
    active,
  );
  expect(await snapshot()).toEqual(before);
});

it("observes an active series in a month without any locally stored invoice", async () => {
  const f = await fixture();
  f.foreign.IDFactura.FechaExpedicionFactura = "01-08-2026";
  f.returned.registros = [f.foreign];
  const before = await snapshot();
  await run(f, f.client, { year: "2026", month: "08" });
  expect(
    await withTransaction(suite.db, (tx) => readActiveConflicts(tx, f.seeded.nodeId)),
  ).toHaveLength(1);
  expect(await snapshot()).toEqual(before);
});

it.each(["S10/99", "S1X/99", "X1/99", "S1/0", "S1/-1", "S1/1.5", "S1/", "OTHER/99"])(
  "does not treat %s as a number in this active series",
  async (number) => {
    const f = await fixture();
    f.foreign.IDFactura.NumSerieFactura = number;
    await run(f);
    expect(
      await withTransaction(suite.db, (tx) => readActiveConflicts(tx, f.seeded.nodeId)),
    ).toEqual([]);
  },
);
it.each(["taxpayer", "retired-series", "retired-sif", "other-node", "known-number"] as const)(
  "does not stop this identity for %s",
  async (change) => {
    const f = await fixture();
    if (change === "taxpayer") f.foreign.IDFactura.IDEmisorFactura = "B87654324";
    if (change === "retired-series")
      await suite.db.execute(sql`update invoice_series set retired_at = ${NOW.toISOString()}`);
    if (change === "retired-sif")
      await suite.db.execute(sql`update registro_sif set revocado_en = ${NOW.toISOString()}`);
    if (change === "other-node") f.seeded.nodeId = "other-node" as typeof f.seeded.nodeId;
    if (change === "known-number") f.returned.registros = f.real.registros;
    await run(f);
    expect(
      await withTransaction(suite.db, (tx) => readActiveConflicts(tx, f.seeded.nodeId)),
    ).toEqual([]);
  },
);
it("commits no series conflict if a later lookup page fails", async () => {
  const f = await fixture();
  let calls = 0;
  const client: VerifactuClient = {
    submit: f.client.submit,
    consultar: async () => {
      if (++calls > 1) throw new Error("later page unavailable");
      return { ...f.returned, IndicadorPaginacion: "S", ClavePaginacion: f.foreign.IDFactura };
    },
  };
  const before = await snapshot();
  await expect(run(f, client)).rejects.toThrow("later page unavailable");
  expect(await withTransaction(suite.db, (tx) => readActiveConflicts(tx, f.seeded.nodeId))).toEqual(
    [],
  );
  expect(await snapshot()).toEqual(before);
});

it.each(["series", "identity"] as const)(
  "rechecks the %s after a lookup overlaps a recovery",
  async (retired) => {
    const f = await fixture();
    const client: VerifactuClient = {
      submit: f.client.submit,
      consultar: async () => {
        await suite.db.execute(
          retired === "series"
            ? sql`update invoice_series set retired_at = ${NOW.toISOString()}`
            : sql`update registro_sif set revocado_en = ${NOW.toISOString()}`,
        );
        return f.returned;
      },
    };
    await run(f, client);
    expect(
      await withTransaction(suite.db, (tx) => readActiveConflicts(tx, f.seeded.nodeId)),
    ).toEqual([]);
    expect((await suite.db.execute(sql`select * from fiscal_series_conflicts`)).rows).toEqual([]);
  },
);
it("keeps a sale committed during the lookup from becoming missing-history evidence", async () => {
  const f = await fixture();
  f.foreign.IDFactura.NumSerieFactura = "S2/1";
  f.foreign.IDFactura.FechaExpedicionFactura = "20-07-2026";
  const client: VerifactuClient = {
    submit: f.client.submit,
    consultar: async () => {
      await appendPendingAlta(suite.db, f.seeded, 2);
      return f.returned;
    },
  };
  await run(f, client);
  expect((await suite.db.execute(sql`select * from registros_facturacion`)).rows).toHaveLength(2);
  expect(await withTransaction(suite.db, (tx) => readActiveConflicts(tx, f.seeded.nodeId))).toEqual(
    [],
  );
  expect((await suite.db.execute(sql`select * from fiscal_series_conflicts`)).rows).toEqual([]);
});
it("detects the same number already held on a different date across a month boundary", async () => {
  const f = await fixture();
  f.foreign.IDFactura.NumSerieFactura = "S1/1";
  f.foreign.IDFactura.FechaExpedicionFactura = "01-08-2026";
  f.returned.registros = [f.foreign];
  await run(f, f.client, { year: "2026", month: "08" });
  expect(await withTransaction(suite.db, (tx) => readActiveConflicts(tx, f.seeded.nodeId))).toEqual(
    [
      expect.objectContaining({
        invoiceIdentity: "S1/1",
        evidence: expect.objectContaining({ invoice: f.foreign.IDFactura }),
      }),
    ],
  );
});
it("keeps a response outside the requested month unknown without retaining a partial conflict", async () => {
  const f = await fixture();
  f.foreign.IDFactura.FechaExpedicionFactura = "01-08-2026";
  await expect(run(f)).rejects.toThrow("consulta returned an invoice outside the requested period");
  expect((await suite.db.execute(sql`select * from fiscal_series_conflicts`)).rows).toEqual([]);
});

it.each(["update", "delete", "replace"] as const)(
  "keeps unheld-invoice observations append-only (%s)",
  async (operation) => {
    const f = await fixture();
    await run(f);
    const before = await suite.db.execute(sql`select * from fiscal_series_conflicts`);
    const error = await captureError(() =>
      suite.db.execute(
        operation === "update"
          ? sql`update fiscal_series_conflicts set evidence = '{}'`
          : operation === "delete"
            ? sql`delete from fiscal_series_conflicts`
            : sql`insert or replace into fiscal_series_conflicts select * from fiscal_series_conflicts`,
      ),
    );
    expect(triggerRaised(error, "fiscal_series_conflicts is append-only")).toBe(true);
    expect(await suite.db.execute(sql`select * from fiscal_series_conflicts`)).toEqual(before);
  },
);

it("observes a freshly allocated identity before its first local invoice", async () => {
  let instant = Date.parse("2026-10-16T11:38:00Z");
  let monotonic = 0;
  let value: unknown = null;
  const node = { nodeId: TENANT_A.nodeId };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(instant);
  try {
    await seedVenueNodes(suite.db);
    await stampDeployment(suite.db, "preproduction");
    const setup = createHourPreparation({
      withState: async (_binding, run) =>
        run({
          get value() {
            return value;
          },
          history: [],
          async replace(next) {
            value = structuredClone(next);
          },
        }),
      monotonicNow: () => monotonic,
      read: async () => ({
        scope: { taxpayerNif: "89890001K", environment: "preproduction" },
        bases: [{ code: "A", purpose: "standard" }],
        contextKey: "first",
        history: [{ reference: "empty", complete: true, records: [] }],
        clock: compareHourClocks(
          ["box", "browser"].map((source) => ({
            source: source as "box" | "browser",
            result: "usable",
            instantMs: instant,
            uncertaintyMs: 0,
            wallStartedMs: instant,
            wallFinishedMs: instant,
            monotonicStartedMs: monotonic,
            monotonicFinishedMs: monotonic,
          })),
          Date.parse("2026-10-15T00:00:00Z"),
        ),
      }),
    });
    const binding = {
      module: "fiscal-verifactu",
      action: "setup",
      eventId: "first",
      sourceId: "empty-venue",
      targetNodeId: node.nodeId,
    };
    await withOperationAuthority(binding, "administrator", async (authority) => {
      await setup.select({ binding, authority, comparisonId: "clock" });
      instant += 120_000;
      monotonic += 120_000;
      vi.setSystemTime(instant);
      const selected = await setup.select({ binding, authority, comparisonId: "clock" });
      if (selected.status !== "selected") throw new Error("setup did not settle");
      await setup.prepare({ binding, authority, input: selected.input }, (prepared) =>
        withTransaction(suite.db, (tx) => activatePreparedModuleAllocation(tx, node, prepared)),
      );
    });
    const client = createFakeAeat({ serverNow: new Date(instant) }).client();
    const sweep = createReconciliationSweep({
      db: suite.db,
      clock: {
        now: () => ({
          instant: new Date(instant),
          offsetMinutes: 60,
          confident: true,
          confidence: "anchored",
          anchorAgeSeconds: 0,
        }),
        anchor: () => {
          throw new Error("unexpected anchor");
        },
        currentAnchor: () => null,
      },
      scope: {
        nodeId: node.nodeId,
        historyNodeIds: [node.nodeId],
        taxpayerId: "89890001K",
        environment: "preproduction",
      },
      retryMs: 300_000,
      includeCurrentPeriod: true,
      resolveClient: staticResolver(client),
    });
    const result = await sweep(new Date(instant));
    expect(result.periods).toEqual([
      expect.objectContaining({
        year: "2026",
        month: "10",
        outcome: "observed",
        result: expect.objectContaining({ checked: 0 }),
      }),
    ]);
    expect((await suite.db.execute(sql`select * from registros_facturacion`)).rows).toEqual([]);
    expect(await withTransaction(suite.db, (tx) => readActiveConflicts(tx, node.nodeId))).toEqual(
      [],
    );
  } finally {
    vi.useRealTimers();
  }
});

it.each(["missing", "different"] as const)(
  "refuses an empty-month lookup with a %s venue taxpayer",
  async (state) => {
    const f = await fixture();
    await suite.db.execute(
      state === "missing" ? sql`delete from tenants` : sql`update tenants set tax_id = '89890001K'`,
    );
    await expect(run(f, f.client, { year: "2026", month: "08" })).rejects.toThrow(
      "reconciliation requires the scoped venue taxpayer",
    );
    expect((await suite.db.execute(sql`select * from fiscal_series_conflicts`)).rows).toEqual([]);
  },
);

it("retains the invoice identity of an unheld active-series number when optional lookup details are absent", async () => {
  const f = await fixture();
  f.foreign.DatosRegistroFacturacion = {};
  await run(f);
  expect(await withTransaction(suite.db, (tx) => readActiveConflicts(tx, f.seeded.nodeId))).toEqual(
    [
      expect.objectContaining({
        invoiceIdentity: "S1/99",
        evidence: {
          source: "consulta",
          invoice: f.foreign.IDFactura,
          reference: null,
          fingerprint: null,
          system: null,
          state: "Correcto",
        },
      }),
    ],
  );
});
