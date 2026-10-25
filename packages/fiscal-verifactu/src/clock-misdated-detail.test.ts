import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recordSale } from "@waitron/core";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { BootReading, ClockConfirmationSource, TrustedClock } from "@waitron/fiscal";
import type { NodeId, SaleId, SeriesId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { correctedStart } from "./clock-checks.js";
import { misdatedDetail } from "./clock-misdated.js";
import { clockChecks } from "./schema/clock-checks.js";
import { clockConfirmations } from "./schema/clock-confirmations.js";

// The fixture shape of clock-misdated.test.ts, copied: every case records its sales in time order
// on a database of its own (`useVenueDb` resets per test).
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const S = 1_000;
const M = 60_000;
const H = 3_600_000;
const X = Date.parse("2026-10-19T10:00:00.000Z");
const BOOT_MS = 1_000_000;
const BOOT: BootReading = { ms: BOOT_MS, id: "boot-1" };
const PERSON = "person-1";

let nodeId: NodeId;
let seriesId: SeriesId;

beforeEach(async () => {
  ({ nodeId, seriesId } = await seedTenantWithSif(suite.db));
});

function clockAt(ms: number): TrustedClock {
  return {
    ...steadyClock,
    now: () => ({ ...steadyClock.now(), instant: new Date(ms), offsetMinutes: 60 }),
  };
}

function backendAt(ms: number): VerifactuBackend {
  return new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: clockAt(ms),
    db: suite.db,
    resolveClient: staticResolver(fakeClient),
  });
}

async function sale(ms: number): Promise<SaleId> {
  const { saleId } = await withTransaction(suite.db, (tx) =>
    recordSale(tx, backendAt(ms), saleInput({ nodeId, seriesId, clock: clockAt(ms) })),
  );
  return saleId;
}

/** A sale of 12.30: 11.18 base and 1.12 tax at 10%. */
async function saleOf1230(ms: number): Promise<void> {
  await withTransaction(suite.db, (tx) =>
    recordSale(
      tx,
      backendAt(ms),
      saleInput({
        nodeId,
        seriesId,
        clock: clockAt(ms),
        total: "12.30",
        lines: [
          {
            lineNo: 1,
            name: "Water",
            descriptions: { "es-ES": "Water" },
            quantity: "1",
            unitPrice: "11.18",
            vatRate: "10.00",
            lineTotal: "11.18",
          },
        ],
        settlement: {
          kind: "immediate",
          tenders: [
            { method: "card", amount: "12.30", tipAmount: "0.00", settledAt: new Date(ms) },
          ],
        },
      }),
    ),
  );
}

async function voidAt(ms: number, saleId: SaleId): Promise<void> {
  await withTransaction(suite.db, (tx) => backendAt(ms).recordVoid(tx, saleId, "staff error"));
}

interface Row {
  id: string;
  numSerieFactura: string;
  at: string;
  offsetMinutos: number;
}

function rows(): Row[] {
  return suite.db.all<Row>(
    sql`select id, num_serie_factura as numSerieFactura, fecha_hora_huso_gen_registro as at,
          offset_minutos as offsetMinutos
        from registros_facturacion order by fecha_hora_huso_gen_registro, id`,
  );
}

function heads(): Record<string, number> {
  const [row] = suite.db.all<{ n: number }>(
    sql`select max(secuencia) as n from registros_facturacion where node_id = ${nodeId}`,
  );
  return { [nodeId]: row!.n };
}

/** One sale at 10:00:30, then one every 5 minutes from 10:05 to 12:00. */
async function aheadSales(): Promise<void> {
  await sale(X + 30 * S);
  for (let k = 1; k <= 24; k++) await sale(X + k * 5 * M);
}

async function insertCheck(input: {
  openedAt: number;
  boot: BootReading;
  heads: Record<string, unknown>;
  offsetMinutes?: number;
}): Promise<{ id: string; detail: unknown }> {
  const detail = {
    clockAt: new Date(input.openedAt).toISOString(),
    ...(input.offsetMinutes === undefined ? {} : { offsetMinutes: input.offsetMinutes }),
    bootMs: input.boot.ms,
    bootId: input.boot.id,
    lastRecordAt: rows().at(-1)!.at,
    lastRecordId: rows().at(-1)!.id,
    heads: input.heads,
  };
  const [row] = await suite.db
    .insert(clockChecks)
    .values({
      seq: suite.db.all<{ n: number }>(sql`select count(*) as n from clock_checks`)[0]!.n + 1,
      nodeId,
      openedAt: new Date(input.openedAt),
      reason: "behind_chain",
      detail,
    })
    .returning({ id: clockChecks.id });
  return { id: row!.id, detail };
}

async function insertClosing(input: {
  check: { id: string } | null;
  confirmedAt: number;
  source?: ClockConfirmationSource;
  closing?: Record<string, unknown>;
}): Promise<string> {
  const source = input.source ?? "admin";
  const [row] = await suite.db
    .insert(clockConfirmations)
    .values({
      seq:
        suite.db.all<{ n: number }>(sql`select count(*) as n from clock_confirmations`)[0]!.n + 1,
      nodeId,
      boxClockAt: new Date(input.confirmedAt),
      confirmedAt: new Date(input.confirmedAt),
      stepMs: 0,
      source,
      personId: source === "admin" ? PERSON : null,
      reason: "behind_chain",
      proof: {
        authority: null,
        devices: [],
        admin: null,
        ...(input.closing === undefined ? {} : { closing: input.closing }),
      },
      checkId: input.check?.id ?? null,
      registroId: null,
      recordAt: null,
    })
    .returning({ id: clockConfirmations.id });
  return row!.id;
}

function closingFor(check: { detail: unknown }, confirmedAt: number, boot: BootReading) {
  return {
    bootMs: boot.ms,
    bootId: boot.id,
    ...correctedStart(check, {
      confirmedAt: new Date(confirmedAt),
      bootMs: boot.ms,
      bootId: boot.id,
    }),
    unconfirmed: false,
  };
}

function detail(confirmationId: string) {
  return withTransaction(suite.db, (tx) => misdatedDetail(tx, confirmationId));
}

const iso = (ms: number) => new Date(ms).toISOString();

describe("misdatedDetail", () => {
  it("lists each record with its kind, stored issue date and stored amount, and the closing's values", async () => {
    // Sold the day before and cancelled during the stop: the cancellation stores the original's date.
    const yesterday = await sale(X - 24 * H);
    await aheadSales();
    await saleOf1230(X + 2 * H + 2 * M);
    await voidAt(X + 2 * H + 4 * M, yesterday);
    const check = await insertCheck({
      openedAt: X,
      boot: BOOT,
      heads: heads(),
      offsetMinutes: 60,
    });
    const id = await insertClosing({
      check,
      confirmedAt: X + 3 * H,
      closing: closingFor(check, X + 3 * H, { ms: BOOT_MS + 3 * H, id: "boot-1" }),
    });

    const listedRows = rows().filter((row) => Date.parse(row.at) > X + M);
    expect(listedRows).toHaveLength(26);
    const issue = (row: Row) => ({
      recordId: row.id,
      invoiceNumber: row.numSerieFactura,
      generatedAt: row.at,
      offsetMinutes: 60,
      kind: "issue",
      issueDate: "2026-10-19",
      amount: "14.41",
    });
    expect(await detail(id)).toEqual({
      known: true,
      closing: {
        source: "admin",
        personId: PERSON,
        confirmedAt: iso(X + 3 * H),
        correctedStart: iso(X),
        partial: false,
        startOffsetMinutes: 60,
      },
      records: [
        ...listedRows.slice(0, 24).map(issue),
        { ...issue(listedRows[24]!), amount: "12.30" },
        {
          ...issue(listedRows[25]!),
          kind: "cancellation",
          issueDate: "2026-10-18",
          amount: null,
        },
      ],
    });
    expect(listedRows[24]!.at).toBe(iso(X + 2 * H + 2 * M));
    expect(listedRows[25]!.at).toBe(iso(X + 2 * H + 4 * M));
  });

  it("answers a devices closing with no person, and the offset its check stored", async () => {
    await sale(X + H);
    const check = await insertCheck({
      openedAt: X,
      boot: BOOT,
      heads: heads(),
      offsetMinutes: 120,
    });
    const id = await insertClosing({
      check,
      confirmedAt: X + 90 * M,
      source: "devices",
      closing: closingFor(check, X + 90 * M, { ms: BOOT_MS + 90 * M, id: "boot-1" }),
    });
    const [row] = rows();
    expect(await detail(id)).toEqual({
      known: true,
      closing: {
        source: "devices",
        personId: null,
        confirmedAt: iso(X + 90 * M),
        correctedStart: iso(X),
        partial: false,
        startOffsetMinutes: 120,
      },
      records: [
        {
          recordId: row!.id,
          invoiceNumber: row!.numSerieFactura,
          generatedAt: iso(X + H),
          offsetMinutes: 60,
          kind: "issue",
          issueDate: "2026-10-19",
          amount: "14.41",
        },
      ],
    });
  });

  it("answers a null opening offset for a check that stored none", async () => {
    await sale(X + H);
    const check = await insertCheck({ openedAt: X, boot: BOOT, heads: heads() });
    const id = await insertClosing({
      check,
      confirmedAt: X + 90 * M,
      closing: closingFor(check, X + 90 * M, { ms: BOOT_MS + 90 * M, id: "boot-1" }),
    });
    const found = await detail(id);
    if (found === null || !found.known) throw new Error(`expected a list, got ${String(found)}`);
    expect(found.closing).toEqual({
      source: "admin",
      personId: PERSON,
      confirmedAt: iso(X + 90 * M),
      correctedStart: iso(X),
      partial: false,
      startOffsetMinutes: null,
    });
  });

  it("answers a partial closing's own start", async () => {
    await aheadSales();
    const check = await insertCheck({
      openedAt: X,
      boot: BOOT,
      heads: heads(),
      offsetMinutes: 60,
    });
    const id = await insertClosing({
      check,
      confirmedAt: X + 90 * M,
      closing: closingFor(check, X + 90 * M, { ms: 20_000, id: "boot-2" }),
    });
    const found = await detail(id);
    if (found === null || !found.known) throw new Error(`expected a list, got ${String(found)}`);
    expect(found.closing).toEqual({
      source: "admin",
      personId: PERSON,
      confirmedAt: iso(X + 90 * M),
      correctedStart: iso(X + 90 * M),
      partial: true,
      startOffsetMinutes: 60,
    });
    expect(found.records.map((record) => record.generatedAt)).toEqual(
      [7, 8, 9, 10, 11, 12].map((k) => iso(X + H + k * 5 * M)),
    );
  });

  it("passes a closing that cannot tell through as not known", async () => {
    await sale(X + H);
    const check = await insertCheck({ openedAt: X, boot: BOOT, heads: heads() });
    const id = await insertClosing({
      check,
      confirmedAt: X + 90 * M,
      closing: { correctedStart: iso(X), partial: false, unconfirmed: true },
    });
    expect(await detail(id)).toEqual({ known: false });
  });

  it("answers null when no confirmation has the id", async () => {
    expect(await detail("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("answers an empty list with its closing", async () => {
    await sale(X + H);
    const check = await insertCheck({ openedAt: X, boot: BOOT, heads: {}, offsetMinutes: 60 });
    const id = await insertClosing({
      check,
      confirmedAt: X + 90 * M,
      closing: closingFor(check, X + 90 * M, { ms: BOOT_MS + 90 * M, id: "boot-1" }),
    });
    expect(await detail(id)).toEqual({
      known: true,
      closing: {
        source: "admin",
        personId: PERSON,
        confirmedAt: iso(X + 90 * M),
        correctedStart: iso(X),
        partial: false,
        startOffsetMinutes: 60,
      },
      records: [],
    });
  });
});
