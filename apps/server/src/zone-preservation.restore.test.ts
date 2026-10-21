import {
  agreeInternet,
  archiveCommand,
  archiveHost,
  bucketCommand,
  node,
  recordedRecoveryRows,
  recoveryInvoices,
  suite,
} from "../test/hour-recovery-host.js";
import { eq, sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { invoiceSeries, locations, openVenueDatabase, withTransaction } from "@waitron/db";
import { persons } from "@waitron/identity";
import { recordDailyClose } from "@waitron/reporting";
import { recordSale } from "@waitron/core";
import { prepareIssueClock } from "@waitron/fiscal";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import { decodeRegistroRow, fromRegistroRow } from "@waitron/fiscal-verifactu/src/registro-row.js";
import { drain } from "@waitron/fiscal-verifactu/src/drain.js";
import { assertValid, computeHuella } from "@waitron/verifactu";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { saleInput, steadyClock } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { saleId, seriesId } from "@waitron/shared";
import { runRestore } from "./restore-command.js";

it.each(["archive", "bucket"] as const)(
  "%s entry preserves old identities and first-drain payloads before the next saved-zone issue",
  async (kind) => {
    await recoveryInvoices();
    const [standard] = await suite.db
      .select()
      .from(invoiceSeries)
      .where(eq(invoiceSeries.code, "A-06RB"));
    const source = {
      ...steadyClock,
      now: () => ({
        ...steadyClock.now(),
        instant: new Date("2026-10-15T23:30:00Z"),
        offsetMinutes: 0,
      }),
    };
    const backend = new VerifactuBackend({
      db: suite.db,
      clock: source,
      deploymentEnvironment: "preproduction",
      environment: "preproduction",
      resolveClient: async () => {
        throw new Error("no inline filing");
      },
    });
    await withTransaction(suite.db, (tx) =>
      recordSale(
        tx,
        backend,
        saleInput({ nodeId: node.nodeId, seriesId: seriesId(standard!.id), clock: source }),
      ),
    );
    const [manager] = await suite.db
      .insert(persons)
      .values({ displayName: "Recovery manager", role: "manager" })
      .returning();
    await withTransaction(suite.db, (tx) =>
      recordDailyClose(tx, {
        nodeId: node.nodeId,
        businessDay: "2026-10-16",
        timeZone: "Europe/Madrid",
        closedBy: manager!.id,
        cashCounts: [],
      }),
    );
    const closes = suite.db.all(sql`select * from daily_closes order by rowid`);
    const closeHeads = suite.db.all(sql`select * from daily_close_chain order by rowid`);
    expect(closes).toHaveLength(1);
    const before = await recordedRecoveryRows(suite.db);
    const allocations = suite.db.all(sql`select * from fiscal_allocations order by rowid`);
    const identities = suite.db.all<Record<string, unknown>>(
      sql`select * from registro_sif order by rowid`,
    );
    const expected = before.records.map((row) => fromRegistroRow(decodeRegistroRow(row)));
    expect(expected.at(-1)).toMatchObject({
      IDFactura: { FechaExpedicionFactura: "15-10-2026" },
      FechaHoraHusoGenRegistro: "2026-10-15T23:30:00+00:00",
    });
    for (let index = 0; index < expected.length; index++) {
      assertValid(expected[index]!);
      expect(computeHuella(expected[index]!)).toBe(before.records[index]!.huella);
    }
    const entry = kind === "archive" ? await archiveHost() : await bucketCommand();
    const archive = "restore" in entry ? await archiveCommand(entry) : null;
    agreeInternet();
    const output: string[] = [];
    const args =
      archive === null ? (entry as Awaited<ReturnType<typeof bucketCommand>>).deps : archive;
    expect(await runRestore({ ...args, out: (line) => output.push(line) }), output.join("\n")).toBe(
      0,
    );
    const roots = "restore" in entry ? entry.roots : entry.f.roots;
    const placed = await openVenueDatabase(roots.venueDir);
    try {
      const db = placed.venue;
      const restoredIdentities = db.all<Record<string, unknown>>(
        sql`select * from registro_sif order by rowid`,
      );
      for (const old of identities)
        expect(restoredIdentities.find((row) => row.id === old.id)).toEqual({
          ...old,
          revocado_en: expect.any(String),
        });
      expect(restoredIdentities).toHaveLength(identities.length + 1);
      expect(await recordedRecoveryRows(db)).toEqual(before);
      expect(db.all(sql`select * from daily_closes order by rowid`)).toEqual(closes);
      expect(db.all(sql`select * from daily_close_chain order by rowid`)).toEqual(closeHeads);
      expect(
        db.all(sql`select * from fiscal_allocations order by rowid`).slice(0, allocations.length),
      ).toEqual(allocations);
      await db
        .update(locations)
        .set({ timeZone: "Invalid/Zone" })
        .where(eq(locations.id, node.locationId));
      const aeat = createFakeAeat({ serverNow: new Date("2026-10-18T12:00:00Z") });
      const sent: unknown[] = [];
      const client = aeat.client();
      await db.execute(
        sql`update envios set proximo_intento_en = '2026-10-18T12:00:00.000Z' where estado = 'pendiente'`,
      );
      const result = await drain(
        {
          db,
          environment: "preproduction",
          skipRetryMs: 300_000,
          resolveClient: async () => ({
            submit: async (header, batch) => {
              sent.push(...structuredClone(batch));
              return client.submit(header, batch);
            },
            consultar: (...query) => client.consultar(...query),
          }),
        },
        new Date("2026-10-18T12:00:00Z"),
      );
      expect(result.recordsAccepted).toBe(2);
      expect(sent).toEqual(
        expected.slice(1).map((record, index) => ({
          RegistroAlta: { ...record, RefExterna: before.records[index + 1]!.id },
        })),
      );
      const afterSend = await recordedRecoveryRows(db);
      expect({ ...afterSend, submissions: before.submissions }).toEqual(before);
      const oldBackend = new VerifactuBackend({
        db,
        clock: {
          ...source,
          now: () => {
            throw new Error("historical receipt requested a new clock");
          },
        },
        deploymentEnvironment: "preproduction",
        environment: "preproduction",
        resolveClient: async () => client,
      });
      for (const sale of before.sales) {
        const filed = await withTransaction(db, (tx) =>
          oldBackend.filedReceiptFor(tx, saleId(String(sale.id))),
        );
        expect(new URL(filed!.verificationUrl!).searchParams.get("fecha")).toBe(
          before.records.find((row) => row.sale_id === sale.id)!.fecha_expedicion_factura ===
            "2026-10-15"
            ? "15-10-2026"
            : "16-10-2026",
        );
      }
      await db
        .update(locations)
        .set({ timeZone: "Europe/Madrid" })
        .where(eq(locations.id, node.locationId));
      const [current] = (await db.select().from(invoiceSeries)).filter(
        (row) => row.retiredAt === null && row.purpose === "standard",
      );
      vi.setSystemTime(new Date("2026-10-18T23:30:00Z"));
      const nextSource = {
        ...source,
        now: () => ({ ...steadyClock.now(), instant: new Date(), offsetMinutes: 0 }),
      };
      await withTransaction(db, async (tx) =>
        recordSale(
          tx,
          backend,
          saleInput({
            nodeId: node.nodeId,
            seriesId: seriesId(current!.id),
            clock: await prepareIssueClock(tx, node, nextSource),
          }),
        ),
      );
      const next = await recordedRecoveryRows(db);
      expect(next.records.slice(0, before.records.length)).toEqual(before.records);
      expect(next.records.at(-1)).toMatchObject({
        fecha_expedicion_factura: "2026-10-19",
        offset_minutos: 120,
        anterior_huella: null,
      });
      const added = next.records.at(-1)!;
      expect(next.sales.find((row) => row.id === added.sale_id)).toMatchObject({
        issued_at: "2026-10-18T23:30:00.000Z",
        issued_offset_minutes: 120,
        invoice_number: 1,
      });
      const rebuilt = fromRegistroRow(decodeRegistroRow(added));
      assertValid(rebuilt, { now: new Date("2026-10-20T00:00:00Z") });
      expect(computeHuella(rebuilt)).toBe(added.huella);
      expect(next.records).toHaveLength(before.records.length + 1);
      expect(db.all(sql`select * from daily_closes order by rowid`)).toEqual(closes);
      expect(db.all(sql`select * from daily_close_chain order by rowid`)).toEqual(closeHeads);
    } finally {
      await placed.close();
    }
  },
);
