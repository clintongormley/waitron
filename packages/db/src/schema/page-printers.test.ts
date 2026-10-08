import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS, locations } from "../index.js";
import { useVenueDb } from "../testing/venue-db.js";
import { seedTenant } from "../testing/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

it("stores a page destination and its advertised formats outside the receipt-printer table", async () => {
  const columns = (
    await suite.db.execute<{ name: string }>(
      sql`select name from pragma_table_info('page_printers')`,
    )
  ).rows.map((row) => row.name);
  expect(columns).toContain("document_format");
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Bar", invoiceLocales: ["es-ES"], operationDescription: "Sale" })
    .returning();
  await suite.db.execute(sql`insert into page_printers
    (id, location_id, name, host, port, resource_path, document_format, supported_formats, media, resolution_dpi, active)
    values ('office', ${location!.id}, 'Invoice office', '192.0.2.10', 8631, '/ipp/printer',
      'application/pdf', '["application/pdf","image/urf"]', 'iso_a4_210x297mm', 600, 1)`);
  expect(
    (
      await suite.db.execute(
        sql`select host, port, resource_path, document_format, supported_formats, media, resolution_dpi from page_printers`,
      )
    ).rows,
  ).toEqual([
    {
      host: "192.0.2.10",
      port: 8631,
      resource_path: "/ipp/printer",
      document_format: "application/pdf",
      supported_formats: '["application/pdf","image/urf"]',
      media: "iso_a4_210x297mm",
      resolution_dpi: 600,
    },
  ]);
  expect((await suite.db.execute(sql`select id from printers`)).rows).toEqual([]);
});
