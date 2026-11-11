import { eq, sql } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activityLog, CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons, startManagementSession } from "@waitron/identity";
import {
  seedPurchaseInvoice,
  seedSale,
  seedVenueWithSeries,
} from "@waitron/reporting/test/fixtures.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { fixturePinHash } from "./testing/known-secret-hashes.js";
import * as workbook from "./accountant-export.js";
import { mountReportApi } from "./report-api.js";

describe("accountant export download", () => {
  let nodeId = "";
  let manager = { id: "", cookie: "" };
  let supervisorCookie = "";
  let app: Hono;
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS],
    timeoutMs: 60_000,
  });
  beforeEach(async () => {
    const db = suite.db;
    const venue = await seedVenueWithSeries(db);
    nodeId = venue.nodeId;
    await seedSale(db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-11-03T12:00:00.000Z",
      total: "12.10",
      lines: [{ vatRate: "21.00", lineTotal: "10.00" }],
    });
    await seedPurchaseInvoice(db, {
      supplierInvoiceNumber: "S-42",
      issuedOn: "2026-10-01",
      receivedOn: "2026-11-03",
      total: "12.10",
      lines: [{ rate: "21.00", base: "10.00", tax: "2.10" }],
    });
    await withTransaction(db, async (tx) => {
      for (const role of ["manager", "supervisor"] as const) {
        const [person] = await tx
          .insert(persons)
          .values({ displayName: `The ${role}`, pinHash: fixturePinHash("1234"), role })
          .returning({ id: persons.id });
        const session = await startManagementSession(tx, { personId: person!.id });
        const cookie = `${MANAGEMENT_COOKIE}=${session.token}`;
        if (role === "manager") manager = { id: person!.id, cookie };
        else supervisorCookie = cookie;
      }
    });

    app = new Hono();
    mountReportApi(app, { db: suite.db, cfg: { nodeId }, venueLocale: "es-ES" }, () => {});
  });
  const send = (cookie: string, method = "POST") =>
    app.request("/management-api/reports/accountant-export?from=2026-11-03&to=2026-11-03", {
      method,
      headers: { cookie },
    });
  const downloads = () =>
    suite.db
      .select({
        personId: activityLog.personId,
        subjectId: activityLog.subjectId,
        subjectKind: activityLog.subjectKind,
        data: activityLog.data,
      })
      .from(activityLog)
      .where(eq(activityLog.kind, "accountant_export.downloaded"));

  it("serves the venue-language XLSX as a private attachment and records dates and invoice counts only", async () => {
    const response = await send(manager.cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="accountant-2026-11-03-2026-11-03.xlsx"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(strFromU8(files["xl/workbook.xml"]!)).toContain('name="Facturas emitidas"');
    expect(strFromU8(files["xl/worksheets/sheet1.xml"]!)).toContain('xml:space="preserve">A/1</t>');
    expect(strFromU8(files["xl/worksheets/sheet2.xml"]!)).toContain(
      'xml:space="preserve">S-42</t>',
    );
    expect(await downloads()).toEqual([
      {
        personId: manager.id,
        subjectId: "accountant-export",
        subjectKind: "report",
        data: { from: "2026-11-03", to: "2026-11-03", invoices: 1, purchases: 1 },
      },
    ]);
  });

  it("releases the write transaction before waiting for workbook encoding", async () => {
    const render = workbook.renderAccountantWorkbook;
    let release!: () => void;
    let began!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const encoder = vi
      .spyOn(workbook, "renderAccountantWorkbook")
      .mockImplementation(async (data, language) => {
        began();
        await gate;
        return render(data, language);
      });
    const response = send(manager.cookie);
    let timer: NodeJS.Timeout | undefined;
    try {
      await started;
      const written = withTransaction(suite.db, (tx) =>
        tx
          .insert(persons)
          .values({
            displayName: "Another request",
            role: "staff",
            pinHash: fixturePinHash("1234"),
          })
          .returning({ id: persons.id }),
      );
      const finished = await Promise.race([
        written.then((rows) => rows.length === 1),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 1000);
        }),
      ]);
      expect(finished).toBe(true);
    } finally {
      clearTimeout(timer);
      release();
      await response;
      encoder.mockRestore();
    }
    expect((await response).status).toBe(200);
  });

  it("refuses unsigned and view-only sessions without producing an attachment or activity", async () => {
    for (const [cookie, status, code] of [
      ["", 401, "management_session.required"],
      [supervisorCookie, 403, "authorization.not_permitted"],
    ] as const) {
      const response = await send(cookie);
      expect(response.status).toBe(status);
      expect(response.headers.get("content-disposition")).toBeNull();
      expect(await response.json()).toMatchObject({ error: { code } });
    }
    expect(await downloads()).toEqual([]);
  });

  it("serves no workbook or activity through GET or HEAD", async () => {
    for (const method of ["GET", "HEAD"]) {
      const response = await send(manager.cookie, method);
      expect(response.status).toBe(404);
      expect(response.headers.get("content-disposition")).toBeNull();
    }
    expect(await downloads()).toEqual([]);
  });

  it("serves no workbook when recording the download fails", async () => {
    await suite.db.execute(
      sql.raw(
        "create trigger test_accountant_download before insert on activity_log when new.kind = 'accountant_export.downloaded' begin select raise(abort, 'test: download refused'); end",
      ),
    );
    let response: Response;
    try {
      response = await send(manager.cookie);
    } finally {
      await suite.db.execute(sql.raw("drop trigger test_accountant_download"));
    }
    expect(response.status).toBe(500);
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(await response.json()).toEqual({ error: { code: "server.internal" } });
    expect(await downloads()).toEqual([]);
  });
});
