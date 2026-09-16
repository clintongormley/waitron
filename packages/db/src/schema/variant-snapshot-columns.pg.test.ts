// Real Postgres, not PGlite: this proves the B1 snapshot-column migration (0030) and the custom
// variant-locales trigger (0031) actually APPLY and behave on the deployment target. The trigger is a
// plain data-validation BEFORE trigger — it does not turn on the connecting role — so PGlite would
// suffice for firing (as the sibling descriptions check in orders.test.ts uses), but the brief scopes
// this unit's proof to real PG, and cloning the shared `core` template is ~26ms.
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { captureError, pgErrorMessage } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { catalogues, products } from "./catalogue.js";
import { workingOrderLines, workingOrders } from "./orders.js";
import { locations, tenants, tills } from "./tenants.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const LOCATION = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL = "aaaaaaaa-1111-4000-8000-000000000001";
const AT = "2026-07-20T19:20:30+00:00";

// Bilingual on purpose: a single-locale venue cannot tell "exactly these locales" from
// "at least one locale", so the trigger is exercised against two configured locales.
const LOCALES = ["es", "ca"] as const;

describe("B1 snapshot columns and the variant-descriptions locales trigger (real PG)", () => {
  const suite = useTemplateDb({ template: "core" });
  let db: Database;
  let productId = "";
  let orderId = "";

  beforeAll(async () => {
    db = suite.admin;
    await db.insert(tenants).values({
      id: TENANT,
      country: "ES",
      taxId: "B00000000",
      legalName: "Fixture Tenant",
    });
    await db.insert(locations).values({
      id: LOCATION,
      tenantId: TENANT,
      name: "Fixture Location",
      invoiceLocales: [...LOCALES],
      operationDescription: "Hostelería",
    });
    await db.insert(tills).values({ id: TILL, tenantId: TENANT, locationId: LOCATION, name: "A1" });
    const [cat] = await db
      .insert(catalogues)
      .values({ tenantId: TENANT, name: "Deli" })
      .returning({ id: catalogues.id });
    const [prod] = await db
      .insert(products)
      .values({
        tenantId: TENANT,
        catalogueId: cat.id,
        name: "Café solo",
        pricingUnit: "each",
        unitPrice: "1.30",
        vatClass: "general",
      })
      .returning({ id: products.id });
    productId = prod.id;
    const [order] = await db
      .insert(workingOrders)
      .values({ tenantId: TENANT, tillId: TILL, orderNumber: 1, status: "open", openedAt: AT })
      .returning({ id: workingOrders.id });
    orderId = order.id;
  });

  function lineValues(overrides: Record<string, unknown> = {}) {
    return {
      tenantId: TENANT,
      workingOrderId: orderId,
      lineNo: 1,
      name: "Café solo",
      productId,
      variantName: "Grande",
      variantDescriptions: { es: "Café solo", ca: "Cafè sol" },
      variantKitchenName: "CAFE GR",
      descriptions: { es: "Café solo", ca: "Cafè sol" },
      quantity: "1.000",
      unitPrice: "1.30",
      unitPriceGross: "1.43",
      vatRate: "10.00",
      lineTotal: "1.43",
      ...overrides,
    };
  }

  it("round-trips the new snapshot columns (name, text variant_name, variant_descriptions, variant_kitchen_name)", async () => {
    const [line] = await db.insert(workingOrderLines).values(lineValues()).returning();
    expect(line.name).toBe("Café solo");
    // variant_name is now plain text, not a jsonb map.
    expect(line.variantName).toBe("Grande");
    expect(line.variantDescriptions).toEqual({ es: "Café solo", ca: "Cafè sol" });
    expect(line.variantKitchenName).toBe("CAFE GR");
  });

  it("accepts a null variant_descriptions (the optional column is skipped by the trigger)", async () => {
    const [line] = await db
      .insert(workingOrderLines)
      .values(lineValues({ lineNo: 2, variantDescriptions: null }))
      .returning();
    expect(line.variantDescriptions).toBeNull();
  });

  it("rejects a variant_descriptions that is missing a configured locale", async () => {
    const error = await captureError(() =>
      db
        .insert(workingOrderLines)
        .values(lineValues({ lineNo: 3, variantDescriptions: { es: "Café solo" } })),
    );
    expect(pgErrorMessage(error)).toMatch(
      /variant_descriptions must carry exactly the venue locales/,
    );
  });

  it("rejects a variant_descriptions carrying an unconfigured locale", async () => {
    const error = await captureError(() =>
      db.insert(workingOrderLines).values(
        lineValues({
          lineNo: 4,
          variantDescriptions: { es: "Café solo", ca: "Cafè sol", en: "Black coffee" },
        }),
      ),
    );
    expect(pgErrorMessage(error)).toMatch(
      /variant_descriptions must carry exactly the venue locales/,
    );
  });

  it("applied the same new columns to sale_lines with matching types", async () => {
    // sale_lines' round-trip needs a full fiscal sale (node, series, invoice number) to satisfy its
    // parent FK; the migration-apply proof for it reads the live applied schema instead.
    const cols = (
      await db.execute<{ column_name: string; data_type: string; is_nullable: string }>(sql`
        select column_name, data_type, is_nullable from information_schema.columns
         where table_name = 'sale_lines'
           and column_name in ('name','variant_name','variant_descriptions','variant_kitchen_name')
         order by column_name`)
    ).rows;
    expect(cols).toEqual([
      { column_name: "name", data_type: "text", is_nullable: "NO" },
      { column_name: "variant_descriptions", data_type: "jsonb", is_nullable: "YES" },
      { column_name: "variant_kitchen_name", data_type: "text", is_nullable: "YES" },
      { column_name: "variant_name", data_type: "text", is_nullable: "YES" },
    ]);
  });
});
