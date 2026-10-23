import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { recordSale } from "@waitron/core";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing } from "@waitron/credentials";
import { AppError } from "@waitron/shared";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { aeatClientResolver, mtlsFetch } from "./aeat-transport.js";
import { VerifactuBackend } from "./backend.js";
import { DEFAULT_SKIP_RETRY_MS, drain } from "./drain.js";
import { refuseBeforeFirstIssueDate } from "./first-issue-date.js";
import { clockNotices, FISCAL_STAFF_NOTICES, unsentNotices } from "./staff-notices.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const reading = (iso: string, offsetMinutes: number) => ({
  instant: new Date(iso),
  offsetMinutes,
});

const notice = (iso: string, offsetMinutes: number) => ({
  key: "clock.unusable",
  code: "clock.unusable",
  severity: "error",
  params: { clockAt: new Date(iso).toISOString(), offsetMinutes },
});

interface EnvioSeed {
  estado: string;
  incidencia?: boolean;
  technical?: boolean;
}

/** One waiting record per entry, then each `envios` row set to the entry's state and marks. */
async function seedEnvios(rows: readonly EnvioSeed[]): Promise<void> {
  const { registroIds } = await seedPendingEnvios(suite.db, { count: rows.length });
  for (const [index, row] of rows.entries()) {
    await suite.db.execute(sql`
      update envios
      set estado = ${row.estado},
          incidencia = ${row.incidencia === true ? 1 : 0},
          technical_incidence = ${row.technical === true ? 1 : 0}
      where registro_id = ${registroIds[index]!}
    `);
  }
}

async function openIncident(): Promise<void> {
  await suite.db.execute(sql`
    insert into envio_flujo (id, proximo_envio_en, tiempo_espera_seg, technical_incident_token)
    values (1, '2026-07-21T00:00:00.000Z', 0, 'probe')
  `);
}

const FILING = { enabled: true };

const unsent = (count: number, held: number) => ({
  key: "fiscal.records_unsent",
  code: "fiscal.records_unsent",
  severity: "notice",
  params: { count, held },
});

const readUnsent = (filing: { enabled: boolean } = FILING) =>
  withTransaction(suite.db, (tx) => unsentNotices(tx, filing));

const AFTER_FAILED_SEND: readonly EnvioSeed[] = [
  { estado: "pendiente", incidencia: true },
  { estado: "pendiente" },
  { estado: "enviando" },
  { estado: "detenido", incidencia: true },
  { estado: "retenido", incidencia: true },
];

describe("clockNotices", () => {
  it.each([
    { iso: "2024-10-27T23:30:00.000Z", offsetMinutes: 0, refused: true },
    { iso: "2024-10-27T22:59:59.999Z", offsetMinutes: 60, refused: true },
    { iso: "2001-01-01T11:00:00.000Z", offsetMinutes: 60, refused: true },
    { iso: "2024-10-27T23:30:00.000Z", offsetMinutes: 60, refused: false },
    { iso: "2024-10-27T23:00:00.000Z", offsetMinutes: 60, refused: false },
    { iso: "2026-10-22T10:00:00.000Z", offsetMinutes: 120, refused: false },
  ])("$iso at $offsetMinutes: notice $refused", ({ iso, offsetMinutes, refused }) => {
    expect(clockNotices(reading(iso, offsetMinutes))).toEqual(
      refused ? [notice(iso, offsetMinutes)] : [],
    );
  });

  it("carries the refusal's own params", () => {
    const r = reading("2001-01-01T11:00:00.000Z", 60);
    let caught: unknown;
    try {
      refuseBeforeFirstIssueDate(r);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect(clockNotices(r)[0]!.params).toEqual((caught as AppError).params);
  });
});

describe("FISCAL_STAFF_NOTICES", () => {
  it("the seat's one source answers the clock notice", async () => {
    expect(FISCAL_STAFF_NOTICES).toHaveLength(1);
    const before = reading("2001-01-01T11:00:00.000Z", 60);
    const after = reading("2026-10-22T10:00:00.000Z", 120);
    expect(
      await withTransaction(suite.db, (tx) =>
        FISCAL_STAFF_NOTICES[0]!.read({ tx, reading: before }),
      ),
    ).toEqual([notice("2001-01-01T11:00:00.000Z", 60)]);
    expect(
      await withTransaction(suite.db, (tx) =>
        FISCAL_STAFF_NOTICES[0]!.read({ tx, reading: after }),
      ),
    ).toEqual([]);
  });

  it("the one source answers the clock notice before the count", async () => {
    await seedEnvios(AFTER_FAILED_SEND);
    const before = reading("2001-01-01T11:00:00.000Z", 60);
    expect(
      await withTransaction(suite.db, (tx) =>
        FISCAL_STAFF_NOTICES[0]!.read({ tx, reading: before, filing: FILING }),
      ),
    ).toEqual([notice("2001-01-01T11:00:00.000Z", 60), unsent(5, 1)]);
  });
});

/** Records one sale whose record is generated at `at`, in the given offset. */
async function sellAt(at: { instant: Date; offsetMinutes: number }): Promise<void> {
  const { nodeId, seriesId } = await seedTenantWithSif(suite.db);
  const backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    db: suite.db,
    resolveClient: staticResolver(fakeClient),
  });
  const clock = {
    ...steadyClock,
    now: () => ({ ...at, confident: true, confidence: "anchored" as const, anchorAgeSeconds: 0 }),
  };
  await withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, saleInput({ nodeId, seriesId, clock })),
  );
}

describe("the clock-behind notice", () => {
  const LAST = reading("2026-10-25T09:00:00.000Z", 60);
  const read = (r: { instant: Date; offsetMinutes: number }) =>
    withTransaction(suite.db, (tx) => FISCAL_STAFF_NOTICES[0]!.read({ tx, reading: r }));

  it("a reading more than a minute before the latest record shows the stop", async () => {
    await sellAt(LAST);
    const behind = reading("2026-10-25T08:58:59.999Z", 120);
    expect(await read(behind)).toEqual([
      {
        key: "clock.behind_chain",
        code: "clock.behind_chain",
        severity: "error",
        params: {
          clockAt: "2026-10-25T08:58:59.999Z",
          offsetMinutes: 120,
          lastRecordAt: "2026-10-25T09:00:00.000Z",
          lastRecordOffsetMinutes: 60,
        },
      },
    ]);
  });

  it("a 2001 reading with records shows only the unusable clock", async () => {
    await sellAt(LAST);
    expect(await read(reading("2001-01-01T11:00:00.000Z", 60))).toEqual([
      notice("2001-01-01T11:00:00.000Z", 60),
    ]);
  });

  it("a reading a minute before the latest record shows nothing", async () => {
    await sellAt(LAST);
    expect(await read(reading("2026-10-25T08:59:00.000Z", 60))).toEqual([]);
  });

  it("a database with no records shows nothing", async () => {
    expect(await read(reading("2025-01-01T00:00:00.000Z", 60))).toEqual([]);
  });
});

describe("unsentNotices", () => {
  it("no waiting record, no notice", async () => {
    expect(await readUnsent()).toEqual([]);
    await openIncident();
    expect(await readUnsent()).toEqual([]);
  });

  it("records waiting out a wait with no failed send show nothing", async () => {
    await seedEnvios([{ estado: "pendiente" }, { estado: "pendiente" }]);
    expect(await readUnsent()).toEqual([]);
  });

  it("the marks of records that no longer wait do not count", async () => {
    await seedEnvios([
      { estado: "aceptado", incidencia: true, technical: true },
      { estado: "rechazado", incidencia: true, technical: true },
      { estado: "pendiente" },
      { estado: "pendiente" },
    ]);
    expect(await readUnsent()).toEqual([]);
  });

  it("after a failed send, counts every waiting record", async () => {
    await seedEnvios(AFTER_FAILED_SEND);
    expect(await readUnsent()).toEqual([unsent(5, 1)]);
  });

  it("an accepted or refused record is not counted", async () => {
    await seedEnvios([
      ...AFTER_FAILED_SEND,
      { estado: "aceptado" },
      { estado: "aceptado_con_errores" },
      { estado: "rechazado" },
    ]);
    expect(await readUnsent()).toEqual([unsent(5, 1)]);
  });

  it("a technical mark alone shows the count", async () => {
    await seedEnvios([
      { estado: "pendiente", technical: true },
      { estado: "pendiente", technical: true },
    ]);
    expect(await readUnsent()).toEqual([unsent(2, 0)]);
  });

  it("an open technical incident shows the count over unmarked records", async () => {
    await seedEnvios([{ estado: "pendiente" }, { estado: "pendiente" }]);
    await openIncident();
    expect(await readUnsent()).toEqual([unsent(2, 0)]);
  });

  it("a real pass that could not read the certificate shows the count", async () => {
    await seedPendingEnvios(suite.db, { count: 2 });
    const resolver = aeatClientResolver({
      db: suite.db,
      ring: loadKeyRing({
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: "1",
      }),
      endpointFor: () => "https://example.test/soap",
      fetchFor: mtlsFetch,
    });
    const result = await drain(
      {
        db: suite.db,
        resolveClient: resolver.resolve,
        skipRetryMs: DEFAULT_SKIP_RETRY_MS,
        environment: "production",
      },
      new Date("2026-07-21T00:01:00Z"),
    );
    await resolver.closeAll();
    expect(result.skipped).toEqual([{ errorCode: "credentials.missing" }]);
    expect(await readUnsent()).toEqual([unsent(2, 0)]);
  });

  it("a box that does not file shows nothing", async () => {
    await seedEnvios(AFTER_FAILED_SEND);
    expect(await readUnsent({ enabled: false })).toEqual([]);
    expect(await withTransaction(suite.db, (tx) => unsentNotices(tx, undefined))).toEqual([]);
  });
});
