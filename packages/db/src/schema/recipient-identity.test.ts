import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { triggerRaised } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { captureError } from "../testing/errors.js";
import { seedNode, seedVenue } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { TRANSITION_REFUSAL } from "../trigger-refusals.js";
import { diningTables } from "./dining-tables.js";
import { floorZones } from "./floor-zones.js";
import { parties } from "./parties.js";
import { invoiceSeries } from "./series.js";
import { venueLocationId } from "../venue.js";

const AT = "2026-10-28T12:00:00Z";
let LOCATION: string;
const IDENTITY_REFUSAL = "recipient identity is incomplete";
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
let node = "";
let series = "";
let tableId = "";
let partyId = "";
let number = 0;

interface Identity {
  value: string | null;
  kind: string | null;
  issuer: string | null;
}
const FOREIGN: Identity = { value: " Ab-09 /xy ", kind: "passport", issuer: "FR" };
const DOMESTIC: Identity = { value: "B12345674", kind: null, issuer: null };
const NONE: Identity = { value: null, kind: null, issuer: null };

beforeEach(async () => {
  const db = suite.db;
  await seedVenue(db, {
    name: "Test venue",
    invoiceLocales: ["en"],
    operationDescription: "Restaurant services",
  });
  LOCATION = await venueLocationId(db);
  node = await seedNode(db);
  const [seriesRow] = await db
    .insert(invoiceSeries)
    .values({ nodeId: node, code: "A" })
    .returning();
  series = seriesRow!.id;
  const [zone] = await db
    .insert(floorZones)
    .values({ locationId: LOCATION, name: "Room" })
    .returning();
  const [table] = await db
    .insert(diningTables)
    .values({ locationId: LOCATION, zoneId: zone!.id, label: "1" })
    .returning();
  tableId = table!.id;
  const [party] = await db.insert(parties).values({ openedBy: "operator" }).returning();
  partyId = party!.id;
  number = 0;
});

async function order(identity = FOREIGN, status = "placed", delivery = false): Promise<string> {
  const id = randomUUID();
  await suite.db.run(sql`insert into working_orders
    (id, source, location_id, node_id, order_number, status, opened_at, settled_at,
     invoice_type, recipient_tax_id, recipient_legal_name, recipient_address, recipient_country_code,
     recipient_identifier_type, recipient_identifier_country_code, party_id, delivery_table_id)
    values (${id}, 'dashboard', ${LOCATION}, ${node}, ${++number}, ${status}, ${AT},
      ${status === "settled" ? AT : null}, ${identity.value === null ? "F2" : "F1"},
      ${identity.value}, ${identity.value === null ? null : "Customer"},
      ${identity.value === null ? null : "2 Main Street, Paris"}, ${identity.value === null ? null : "FR"},
      ${identity.kind}, ${identity.issuer}, ${partyId}, ${delivery ? tableId : null})`);
  return id;
}

async function sale(identity = FOREIGN, orderId: string | null = null): Promise<string> {
  const id = randomUUID();
  await suite.db.run(sql`insert into sales
    (id, source, series_id, node_id, invoice_number, issued_at, issued_offset_minutes, total,
     vat_breakdown, locale, invoice_locales, fiscal_backend, fiscal_state, working_order_id,
     counterparty_tax_id, counterparty_legal_name, counterparty_country_code,
     counterparty_identifier_type, counterparty_identifier_country_code)
    values (${id}, 'operator_script', ${series}, ${node}, ${++number}, ${AT}, 0, 100, '[]',
      'en', '["en"]', 'none', 'not_applicable', ${orderId}, ${identity.value},
      ${identity.value === null ? null : "Customer"}, ${identity.value === null ? null : "ES"},
      ${identity.kind}, ${identity.issuer})`);
  return id;
}

describe("recipient identity storage", () => {
  it("keeps the exact document value and independent type/issuer on orders and sales", async () => {
    await order();
    await order({ ...FOREIGN, kind: "residence-country-id", issuer: "GB" });
    await sale();
    await sale({ ...FOREIGN, kind: "residence-country-id", issuer: "GB" });
    expect(
      suite.db.all(sql`select recipient_tax_id as value, recipient_identifier_type as kind,
      recipient_identifier_country_code as issuer, recipient_country_code as postal
      from working_orders order by order_number`),
    ).toEqual([
      { value: " Ab-09 /xy ", kind: "passport", issuer: "FR", postal: "FR" },
      { value: " Ab-09 /xy ", kind: "residence-country-id", issuer: "GB", postal: "FR" },
    ]);
    expect(
      suite.db.all(sql`select counterparty_tax_id as value, counterparty_identifier_type as kind,
      counterparty_identifier_country_code as issuer, counterparty_country_code as postal
      from sales order by invoice_number`),
    ).toEqual([
      { value: " Ab-09 /xy ", kind: "passport", issuer: "FR", postal: "ES" },
      { value: " Ab-09 /xy ", kind: "residence-country-id", issuer: "GB", postal: "ES" },
    ]);
  });

  it.each([DOMESTIC, NONE])(
    "keeps domestic or absent identity metadata null: $value",
    async (identity) => {
      const orderId = await order(identity);
      const saleId = await sale(identity);
      expect(
        suite.db
          .get(sql`select recipient_identifier_type as kind, recipient_identifier_country_code as issuer
      from working_orders where id = ${orderId}`),
      ).toEqual({ kind: null, issuer: null });
      expect(
        suite.db
          .get(sql`select counterparty_identifier_type as kind, counterparty_identifier_country_code as issuer
      from sales where id = ${saleId}`),
      ).toEqual({ kind: null, issuer: null });
    },
  );

  it.each([
    "vat-number",
    "passport",
    "residence-country-id",
    "residence-certificate",
    "other-document",
  ])("stores the generic document kind %s", async (kind) => {
    await expect(order({ ...FOREIGN, kind, issuer: "XU" })).resolves.toBeTypeOf("string");
    await expect(sale({ ...FOREIGN, kind, issuer: "XU" })).resolves.toBeTypeOf("string");
  });

  const invalid: Identity[] = [
    { ...FOREIGN, kind: null },
    { ...FOREIGN, issuer: null },
    { ...FOREIGN, kind: "unknown" },
    { ...FOREIGN, kind: "tax-number" },
    { ...FOREIGN, issuer: "FRA" },
    { ...FOREIGN, issuer: "fr" },
    { ...FOREIGN, issuer: "F1" },
    { ...FOREIGN, issuer: "" },
    { ...FOREIGN, value: null },
    { ...FOREIGN, value: "" },
    { ...FOREIGN, value: " \t\r\n " },
  ];
  it.each(invalid)(
    "refuses incomplete order and sale identity $kind/$issuer/$value",
    async (identity) => {
      for (const write of [() => order(identity, "open"), () => sale(identity)]) {
        const error = await captureError(write);
        expect(triggerRaised(error, IDENTITY_REFUSAL)).toBe(true);
      }
      expect(suite.db.all(sql`select id from working_orders`)).toEqual([]);
      expect(suite.db.all(sql`select id from sales`)).toEqual([]);
    },
  );

  it("refuses incomplete metadata on an open order update", async () => {
    const id = await order(DOMESTIC, "open");
    const error = await captureError(() =>
      suite.db.run(sql`update working_orders
      set recipient_identifier_type = 'passport' where id = ${id}`),
    );
    expect(triggerRaised(error, IDENTITY_REFUSAL)).toBe(true);
    expect(
      suite.db.get(
        sql`select recipient_identifier_type as kind from working_orders where id = ${id}`,
      ),
    ).toEqual({ kind: null });
  });

  it("refuses metadata retained when an open order switches to F2", async () => {
    const id = await order(FOREIGN, "open");
    const retainedIdentifier = await captureError(() =>
      suite.db.run(sql`update working_orders set invoice_type = 'F2' where id = ${id}`),
    );
    expect(triggerRaised(retainedIdentifier, IDENTITY_REFUSAL)).toBe(true);
    const error = await captureError(() =>
      suite.db.run(sql`update working_orders set invoice_type = 'F2',
      recipient_tax_id = null, recipient_legal_name = null, recipient_address = null, recipient_country_code = null
      where id = ${id}`),
    );
    expect(triggerRaised(error, IDENTITY_REFUSAL)).toBe(true);
    await suite.db.run(sql`update working_orders set invoice_type = 'F2', recipient_tax_id = null,
      recipient_legal_name = null, recipient_address = null, recipient_country_code = null,
      recipient_identifier_type = null, recipient_identifier_country_code = null where id = ${id}`);
    expect(
      suite.db.get(sql`select invoice_type as invoiceType, recipient_identifier_type as kind,
      recipient_identifier_country_code as issuer from working_orders where id = ${id}`),
    ).toEqual({ invoiceType: "F2", kind: null, issuer: null });
  });

  it.each(["counterparty_identifier_type", "counterparty_identifier_country_code"])(
    "keeps the sale's %s append-only",
    async (column) => {
      const id = await sale();
      const error = await captureError(() =>
        suite.db.run(sql`update sales set ${sql.identifier(column)} = 'GB' where id = ${id}`),
      );
      expect(triggerRaised(error, "sales is append-only")).toBe(true);
    },
  );
});

describe.each([
  { column: "recipient_identifier_type", value: "residence-country-id" },
  { column: "recipient_identifier_country_code", value: "GB" },
])("identity-only edits: $column", ({ column, value }) => {
  it("permits a revisioned edit before issuance", async () => {
    const id = await order();
    await suite.db.run(
      sql`update working_orders set ${sql.identifier(column)} = ${value}, revision = revision + 1 where id = ${id}`,
    );
    expect(
      suite.db.get(
        sql`select ${sql.identifier(column)} as value, revision from working_orders where id = ${id}`,
      ),
    ).toEqual({ value, revision: 1 });
  });

  const transitions = [
    { name: "without a revision", status: "placed", extra: sql`revision = revision` },
    { name: "after issuance", status: "placed", issued: true, extra: sql`revision = revision + 1` },
    { name: "during placed handover", status: "placed", extra: sql`collected_at = ${AT}` },
    { name: "during settled handover", status: "settled", extra: sql`collected_at = ${AT}` },
    {
      name: "during settlement",
      status: "placed",
      extra: sql`status = 'settled', settled_at = ${AT}`,
    },
    { name: "during abandonment", status: "placed", extra: sql`status = 'abandoned'` },
    { name: "during settled party release", status: "settled", extra: sql`party_id = null` },
    ...["placed", "settled", "abandoned"].map((status) => ({
      name: `during ${status} delivery-table release`,
      status,
      extra: sql`delivery_table_id = null, delivery_table_label = '1'`,
    })),
  ];
  it.each(transitions)(
    "refuses an identity change $name and accepts unchanged identity",
    async ({ status, extra, ...options }) => {
      const id = await order(FOREIGN, status, true);
      if ("issued" in options && options.issued) await sale(FOREIGN, id);
      const error = await captureError(() =>
        suite.db.run(sql`update working_orders
      set ${sql.identifier(column)} = ${value}, ${extra} where id = ${id}`),
      );
      expect(triggerRaised(error, TRANSITION_REFUSAL)).toBe(true);
      expect(
        suite.db
          .get(sql`select recipient_identifier_type as kind, recipient_identifier_country_code as issuer,
      revision, status from working_orders where id = ${id}`),
      ).toEqual({ kind: "passport", issuer: "FR", revision: 0, status });
      await suite.db.run(sql`update working_orders set ${extra} where id = ${id}`);
      expect(
        suite.db
          .get(sql`select recipient_identifier_type as kind, recipient_identifier_country_code as issuer
      from working_orders where id = ${id}`),
      ).toEqual({ kind: "passport", issuer: "FR" });
    },
  );
});
