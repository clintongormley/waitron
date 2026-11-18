import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { withTransaction } from "../tenancy.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";

describe("office printer storage", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  const office = {
    id: "office",
    kind: "a4",
    name: "Invoice office",
    transport: "ipp",
    host: "192.0.2.10",
    port: 8631,
    resource_path: "/ipp/printer",
    document_format: "application/pdf",
    supported_formats: '["application/pdf","image/urf"]',
    media: "iso_a4_210x297mm",
    resolution_dpi: 600,
    paper_width: null,
    resolution: null,
    picks_up_receipts: 0,
    picks_up_payment_slips: 0,
  };

  function insertOffice(overrides: Record<string, string | number | null> = {}) {
    const fields = { ...office, ...overrides };
    const columns = sql.join(
      Object.keys(fields).map((key) => sql.identifier(key)),
      sql`, `,
    );
    const values = sql.join(
      Object.values(fields).map((value) => sql`${value}`),
      sql`, `,
    );
    return withTransaction(suite.db, async (tx) =>
      tx.get(sql`insert into printers (${columns}) values (${values}) returning *`),
    );
  }

  it("stores an IPP office printer with its advertised formats and without roll settings", async () => {
    await expect(insertOffice()).resolves.toMatchObject({
      kind: "a4",
      transport: "ipp",
      host: "192.0.2.10",
      port: 8631,
      resource_path: "/ipp/printer",
      document_format: "application/pdf",
      supported_formats: '["application/pdf","image/urf"]',
      media: "iso_a4_210x297mm",
      resolution_dpi: 600,
      paper_width: null,
      resolution: null,
    });
  });

  it.each([
    ["a roll width", { paper_width: "80mm" }],
    ["a holder", { held_by_device_id: "device", held_at: "2026-11-18T07:00:00Z", portable: 1 }],
    ["a drawer", { has_cash_drawer: 1 }],
    ["a USB key", { local_key: "key" }],
    ["a deletion timestamp", { deleted_at: "2026-11-18T07:00:00Z", active: 0 }],
    ["a missing resource path", { resource_path: null }],
  ] as const)("refuses an office printer with %s", async (_label, overrides) => {
    const error = await captureError(() => insertOffice(overrides));
    expect(engineErrorMessage(error)).toBe("CHECK constraint failed: printers_kind_fields_ck");
  });

  it.each([
    ["an out-of-range port", { port: 65536 }, "printers_port_ck"],
    ["an unknown format", { document_format: "text/plain" }, "printers_document_format_ck"],
    ["an unknown medium", { media: "roll" }, "printers_media_ck"],
    ["a zero resolution", { resolution_dpi: 0 }, "printers_resolution_dpi_ck"],
  ] as const)("refuses %s", async (_label, overrides, constraint) => {
    const error = await captureError(() => insertOffice(overrides));
    expect(engineErrorMessage(error)).toBe(`CHECK constraint failed: ${constraint}`);
  });

  it.each([
    ["an IPP transport", sql`transport = 'ipp'`],
    ["an office resource path", sql`resource_path = '/ipp/printer'`],
    ["a kind change alone", sql`kind = 'a4'`],
  ] as const)("refuses assigning %s to a receipt printer", async (_label, update) => {
    await withTransaction(suite.db, async (tx) => {
      await tx.run(sql`insert into printers (id, name, transport, host)
                      values ('receipt', 'Receipt', 'network_tcp', '192.0.2.10')`);
    });
    const error = await captureError(() =>
      withTransaction(suite.db, async (tx) => {
        await tx.run(sql`update printers set ${update} where id = 'receipt'`);
      }),
    );
    expect(engineErrorMessage(error)).toBe("CHECK constraint failed: printers_kind_fields_ck");
  });

  it("keeps one office printer per endpoint while allowing a receipt printer at the same host and port", async () => {
    await insertOffice();
    const error = await captureError(() => insertOffice({ id: "duplicate" }));
    expect(engineErrorMessage(error)).toBe(
      "UNIQUE constraint failed: printers.host, printers.port, printers.resource_path",
    );
    await withTransaction(suite.db, async (tx) => {
      await tx.run(sql`insert into printers (id, name, transport, host, port)
                      values ('receipt', 'Receipt', 'network_tcp', '192.0.2.10', 8631)`);
    });
    const rows = await suite.db.execute(sql`select id, kind from printers order by id`);
    expect(rows.rows).toEqual([
      { id: "office", kind: "a4" },
      { id: "receipt", kind: "receipt" },
    ]);
  });
});
