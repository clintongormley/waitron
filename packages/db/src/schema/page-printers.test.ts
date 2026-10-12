import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { indexViolated, refusalOn } from "../constraint-target.js";
import { CORE_MIGRATIONS, locations } from "../index.js";
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { captureError } from "../testing/errors.js";
import { isRefusal } from "../unique-violation.js";
import { pagePrinters } from "./page-printers.js";
import { printAgents } from "./print-agents.js";
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

describe("the location's invoice printer and the agent that reaches a page printer", () => {
  async function seedLocation(name: string): Promise<string> {
    const [location] = await suite.db
      .insert(locations)
      .values({ name, invoiceLocales: ["es-ES"], operationDescription: "Sale" })
      .returning({ id: locations.id });
    return location!.id;
  }

  async function insertPrinter(
    locationId: string,
    host: string,
    extra: { invoiceDefault?: boolean; agentId?: string | null } = {},
  ) {
    const [row] = await suite.db
      .insert(pagePrinters)
      .values({
        locationId,
        name: `Office ${host}`,
        host,
        port: 631,
        resourcePath: "/ipp/print",
        documentFormat: "application/pdf",
        supportedFormats: ["application/pdf"],
        media: "iso_a4_210x297mm",
        resolutionDpi: 600,
        ...extra,
      })
      .returning();
    return row!;
  }

  it("starts a page printer as no location's invoice printer, reached by no recorded agent", async () => {
    await seedTenant(suite.db);
    const location = await seedLocation("Bar");
    const row = await insertPrinter(location, "192.0.2.30");
    expect(row).toMatchObject({ invoiceDefault: false, agentId: null });
  });

  it("refuses a second invoice printer in one location, and allows one in each of two locations", async () => {
    await seedTenant(suite.db);
    const bar = await seedLocation("Bar");
    const terrace = await seedLocation("Terrace");
    await insertPrinter(bar, "192.0.2.31", { invoiceDefault: true });
    // Beside the default: a non-default sibling in the same location, and a default elsewhere.
    await insertPrinter(bar, "192.0.2.32");
    await insertPrinter(terrace, "192.0.2.33", { invoiceDefault: true });

    const error = await captureError(() =>
      insertPrinter(bar, "192.0.2.34", { invoiceDefault: true }),
    );
    // A partial index on a plain column reports its table and column, never its name.
    expect(
      refusalOn(error, UNIQUE_VIOLATION, { table: "page_printers", columns: ["location_id"] }),
    ).toBe(true);
    expect(indexViolated(error, "page_printers_invoice_default_uq")).toBe(false);
    const defaults = await suite.db
      .select({ host: pagePrinters.host })
      .from(pagePrinters)
      .where(eq(pagePrinters.invoiceDefault, true))
      .orderBy(pagePrinters.host);
    expect(defaults).toEqual([{ host: "192.0.2.31" }, { host: "192.0.2.33" }]);
  });

  it("records an existing agent, and refuses an agent id that names no agent", async () => {
    await seedTenant(suite.db);
    const location = await seedLocation("Bar");
    const [agent] = await suite.db
      .insert(printAgents)
      .values({ locationId: location, name: "Back office", tokenHash: "hash" })
      .returning({ id: printAgents.id });
    const reached = await insertPrinter(location, "192.0.2.35", { agentId: agent!.id });
    expect(reached.agentId).toBe(agent!.id);

    const error = await captureError(() =>
      insertPrinter(location, "192.0.2.36", { agentId: "99999999-9999-4999-8999-999999999999" }),
    );
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    expect(
      await suite.db
        .select({ host: pagePrinters.host })
        .from(pagePrinters)
        .where(eq(pagePrinters.host, "192.0.2.36")),
    ).toEqual([]);
  });
});
