import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { strFromU8, unzipSync } from "fflate";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { startManagementSession } from "@waitron/identity";
import { seedSale, seedVenueWithSeries } from "@waitron/reporting/test/fixtures.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { SupportedLocale } from "@waitron/shared";
import { fixturePinHash } from "./testing/known-secret-hashes.js";
import { mountReportApi } from "./report-api.js";

function row(xml: string, number: number): string[] {
  const body = xml.match(new RegExp(`<row r="${number}">([\\s\\S]*?)</row>`))?.[1] ?? "";
  return [...body.matchAll(/<c [^>]*>([\s\S]*?)<\/c>/g)].map(
    (cell) => cell[1]!.match(/<(?:t(?: [^>]*)?|v)>([\s\S]*?)<\/(?:t|v)>/)?.[1] ?? "",
  );
}

const TICKET = { total: "12.10", lines: [{ vatRate: "10.00", lineTotal: "11.00" }] };

describe("corrections download", () => {
  let nodeId = "";
  let managerCookie = "";
  let supervisorCookie = "";
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

  beforeEach(async () => {
    const db = suite.db;
    const venue = await seedVenueWithSeries(db);
    nodeId = venue.nodeId;
    // The August example: stamped 1 April, really 31 March, its replacement made in August.
    const ticket = await seedSale(db, venue, {
      ...TICKET,
      invoiceNumber: 1,
      issuedAt: "2026-04-01T10:00:00.000Z",
    });
    await seedSale(db, venue, {
      ...TICKET,
      invoiceNumber: 2,
      issuedAt: "2026-08-12T10:00:00.000Z",
      correctsSaleId: ticket,
      replacesOriginal: true,
      supplyDay: "2026-03-31",
    });
    // A late ticket: issued in April for a sale on 30 March.
    await seedSale(db, venue, {
      ...TICKET,
      invoiceNumber: 3,
      issuedAt: "2026-04-02T10:00:00.000Z",
      supplyDay: "2026-03-30",
    });
    await withTransaction(db, async (tx) => {
      for (const role of ["manager", "supervisor"] as const) {
        const [person] = await seedPersons(tx, {
          displayName: `The ${role}`,
          pinHash: fixturePinHash("1234"),
          role,
        });
        const session = await startManagementSession(tx, {
          method: "password",
          personId: person!.id,
        });
        const cookie = `${MANAGEMENT_COOKIE}=${session.token}`;
        if (role === "manager") managerCookie = cookie;
        else supervisorCookie = cookie;
      }
    });
  });

  const send = (query: string, cookie: string, venueLocale: SupportedLocale = "en-GB") => {
    const app = new Hono();
    mountReportApi(app, { db: suite.db, cfg: { nodeId }, venueLocale }, () => {});
    return app.request(`/management-api/reports/corrections?${query}`, { headers: { cookie } });
  };

  const sheets = async (response: Response) => {
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    return {
      workbook: strFromU8(files["xl/workbook.xml"]!),
      summary: strFromU8(files["xl/worksheets/sheet1.xml"]!),
      rows: strFromU8(files["xl/worksheets/sheet2.xml"]!),
    };
  };

  it.each([
    ["en-GB", "Summary", "Corrections", "Date moved out", "Date moved in", "Reduction", "Addition"],
    [
      "es-ES",
      "Resumen",
      "Correcciones",
      "Fecha trasladada (salida)",
      "Fecha trasladada (entrada)",
      "Reducción",
      "Aumento",
    ],
  ] as const)(
    "serves a manager the August example's corrections for the third quarter (%s)",
    async (locale, summaryName, rowsName, movedOut, movedIn, reduction, addition) => {
      const response = await send("year=2026&period=3T", managerCookie, locale);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      expect(response.headers.get("content-disposition")).toBe(
        'attachment; filename="corrections-2026-3T.xlsx"',
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      const { workbook, summary, rows } = await sheets(response);
      expect(workbook).toContain(`<sheet name="${summaryName}"`);
      expect(workbook).toContain(`<sheet name="${rowsName}"`);
      expect(row(summary, 2)).toEqual(["2026-3T", "2026-1T", "10.00", addition, "11.00", "1.10"]);
      expect(row(summary, 3)).toEqual([
        "2026-3T",
        "2026-2T",
        "10.00",
        reduction,
        "-11.00",
        "-1.10",
      ]);
      expect(summary.match(/<row /g)).toHaveLength(3);
      expect(row(rows, 2)).toEqual([
        "2026-08-12",
        movedOut,
        "A/2",
        "A/1",
        "2026-04-01",
        "2026-2T",
        "10.00",
        "-11.00",
        "-1.10",
        reduction,
      ]);
      expect(row(rows, 3)).toEqual([
        "2026-08-12",
        movedIn,
        "A/2",
        "A/1",
        "2026-04-01",
        "2026-1T",
        "10.00",
        "11.00",
        "1.10",
        addition,
      ]);
      expect(rows.match(/<row /g)).toHaveLength(3);
    },
  );

  it.each([
    ["en-GB", "Issued after its sale&apos;s period"],
    ["es-ES", "Emitida después del periodo de su venta"],
  ] as const)("names a late ticket's row by its kind (%s)", async (locale, late) => {
    const response = await send("year=2026&period=2t", managerCookie, locale);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="corrections-2026-2T.xlsx"',
    );
    const { rows } = await sheets(response);
    expect(rows.match(/<row /g)).toHaveLength(2);
    expect(row(rows, 2).slice(0, 6)).toEqual(["2026-04-02", late, "A/3", "", "", "2026-1T"]);
  });

  it("refuses a person without report.export, a missing session, and a bad year or period", async () => {
    for (const [query, cookie, status, code, field] of [
      ["year=2026&period=3T", supervisorCookie, 403, "authorization.not_permitted", undefined],
      ["year=2026&period=3T", "", 401, "management_session.required", undefined],
      ["year=2026&period=13", managerCookie, 400, "management.request_invalid", "period"],
      ["year=2026", managerCookie, 400, "management.request_invalid", "period"],
      ["year=26&period=3T", managerCookie, 400, "management.request_invalid", "year"],
    ] as const) {
      const response = await send(query, cookie);
      expect(response.status).toBe(status);
      expect(response.headers.get("content-disposition")).toBeNull();
      const body = (await response.json()) as { error: { code: string; params?: unknown } };
      expect(body.error.code).toBe(code);
      if (field !== undefined) expect(body.error.params).toEqual({ field });
    }
  });
});
