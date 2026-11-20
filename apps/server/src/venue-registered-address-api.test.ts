import { setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { recordSale } from "@waitron/core";
import {
  invoiceSeries,
  readActivityForSubject,
  sales,
  taxpayer,
  withTransaction,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { venueFiscalSelection } from "@waitron/provisioning";
import { seriesId as brandSeriesId, workingOrderId as brandWorkingOrderId } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { mountVenueSettingsApi } from "./venue-settings-api.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { inTx } from "./testing/bill-venue.js";
import { parked, provisionOrderVenue, type OrderVenue } from "./testing/order-venue.js";
import { readCustomerInvoiceDocument } from "./invoice-document.js";
import { readVenueDetails } from "./venue-details.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const ORIGINAL = "2º 1ª";

function appWith(): Hono {
  const app = new Hono();
  mountVenueSettingsApi(
    app,
    { db: suite.db, fiscal: venueFiscalSelection(ALL_MODULES, "ES-common").contribution! },
    () => {},
  );
  return app;
}
function change(body: unknown, cookie: string | null) {
  return appWith().request("/management-api/venue-details/registered-address", {
    method: "PUT",
    headers: { "content-type": "application/json", ...(cookie === null ? {} : { cookie }) },
    body: JSON.stringify(body),
  });
}
async function taxpayerRow() {
  const [row] = await suite.db.select().from(taxpayer).where(eq(taxpayer.id, 1));
  return row!;
}
const model = () => withTransaction(suite.db, (tx) => readVenueDetails(tx));

describe("changing the taxpayer's registered address", () => {
  let venue: Venue;
  const put = (body: unknown, cookie: string | null = venue.managerCookie) => change(body, cookie);

  beforeEach(async () => {
    venue = await setupVenue(suite.db);
    await suite.db.execute(sql`update taxpayer set taxpayer_domicile = ${ORIGINAL} where id = 1`);
    await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, venue.managerCookie));
  });

  it("shows the stored registered address in the venue details", async () => {
    expect((await model()).taxpayerDomicile).toBe(ORIGINAL);
  });

  it("requires a fresh sign-in before changing the address", async () => {
    await withTransaction(suite.db, (tx) =>
      setFreshManagementSignIn(tx, venue.managerCookie, false),
    );
    const before = await taxpayerRow();
    const response = await put({ taxpayerDomicile: "Calle Mayor 1", expected: ORIGINAL });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management_session.proof_required", params: {} },
    });
    expect(await taxpayerRow()).toEqual(before);
  });

  it("requires a session and the venue configuration permission", async () => {
    const body = { taxpayerDomicile: "Calle Mayor 1", expected: ORIGINAL };
    const absent = await put(body, null);
    expect(absent.status).toBe(401);
    expect(await absent.json()).toEqual({
      error: { code: "management_session.required", params: {} },
    });
    const staff = await put(body, venue.staffCookie);
    expect(staff.status).toBe(403);
    expect(await staff.json()).toEqual({
      error: { code: "authorization.not_permitted", params: { permission: "venue.configure" } },
    });
    await setBuiltInRoleForTest(
      suite.db,
      (
        await suite.db.execute<{ id: string }>(
          sql`select id from persons where display_name = 'The Manager'`,
        )
      ).rows[0]!.id,
      "supervisor",
    );
    const supervisor = await put(body);
    expect(supervisor.status).toBe(403);
    expect(await supervisor.json()).toEqual({
      error: { code: "authorization.not_permitted", params: { permission: "venue.configure" } },
    });
    expect((await taxpayerRow()).taxpayerDomicile).toBe(ORIGINAL);
  });

  it("saves the trimmed address, answers the re-read model, and leaves one activity entry", async () => {
    const before = await taxpayerRow();
    const next = "2º 1ª, Carrer de Mallorca 1, 08010 Barcelona, Barcelona";
    const response = await put({ taxpayerDomicile: `  ${next}  `, expected: ORIGINAL });
    expect(response.status).toBe(200);
    const read = await model();
    expect(read.taxpayerDomicile).toBe(next);
    expect(await response.json()).toEqual({ model: read });
    expect(await taxpayerRow()).toEqual({ ...before, taxpayerDomicile: next });
    const entries = await readActivityForSubject(suite.db, { kind: "taxpayer", id: "1" });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "taxpayer.domicile_changed",
      personId: suite.db.all<{ id: string }>(
        sql`select id from persons where display_name = 'The Manager'`,
      )[0]!.id,
    });
    expect(entries[0]!.data).toEqual({});
  });

  it("fills an address that was never stored when the page showed none", async () => {
    await suite.db.execute(sql`update taxpayer set taxpayer_domicile = null where id = 1`);
    expect((await model()).taxpayerDomicile).toBeNull();
    const response = await put({ taxpayerDomicile: "Calle Mayor 1", expected: "" });
    expect(response.status).toBe(200);
    expect((await taxpayerRow()).taxpayerDomicile).toBe("Calle Mayor 1");
  });

  it.each([
    ["padded", (stored: string) => `  ${stored}  `],
    ["decomposed", (stored: string) => stored.normalize("NFD")],
  ])("accepts a %s copy of the stored address as the expected one", async (_label, copy) => {
    await suite.db.execute(
      sql`update taxpayer set taxpayer_domicile = ${"Pla\u00e7a 1"} where id = 1`,
    );
    const response = await put({
      taxpayerDomicile: "Calle Mayor 1",
      expected: copy("Pla\u00e7a 1"),
    });
    expect(response.status).toBe(200);
    expect((await taxpayerRow()).taxpayerDomicile).toBe("Calle Mayor 1");
  });

  it("accepts the composed spelling as the expected address for one stored decomposed", async () => {
    await suite.db.execute(
      sql`update taxpayer set taxpayer_domicile = ${"Plac\u0327a 1"} where id = 1`,
    );
    const response = await put({ taxpayerDomicile: "Calle Mayor 1", expected: "Pla\u00e7a 1" });
    expect(response.status).toBe(200);
    expect((await taxpayerRow()).taxpayerDomicile).toBe("Calle Mayor 1");
  });

  it("stores the composed spelling and calls a decomposed spelling of the same address unchanged", async () => {
    const composed = "Pla\u00e7a 1";
    const decomposed = "Plac\u0327a 1";
    expect((await put({ taxpayerDomicile: decomposed, expected: ORIGINAL })).status).toBe(200);
    expect((await taxpayerRow()).taxpayerDomicile).toBe(composed);
    const response = await put({ taxpayerDomicile: decomposed, expected: composed });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "venue.detail_invalid",
        params: { field: "taxpayerDomicile", reason: "unchanged" },
      },
    });
  });

  it("refuses a stale expected address and writes nothing", async () => {
    const response = await put({ taxpayerDomicile: "Calle Mayor 1", expected: "Somewhere else" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "venue.detail_changed", params: { field: "taxpayerDomicile" } },
    });
    expect((await taxpayerRow()).taxpayerDomicile).toBe(ORIGINAL);
    expect(await readActivityForSubject(suite.db, { kind: "taxpayer", id: "1" })).toEqual([]);
  });

  it("calls an address typed over a stale view changed, not unchanged", async () => {
    const response = await put({ taxpayerDomicile: ORIGINAL, expected: "Somewhere else" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "venue.detail_changed", params: { field: "taxpayerDomicile" } },
    });
  });

  it.each([
    ["empty", "", "required"],
    ["whitespace-only", "   ", "required"],
    ["unchanged", ` ${ORIGINAL} `, "unchanged"],
  ])("refuses an address that is %s and writes nothing", async (_label, value, reason) => {
    const response = await put({ taxpayerDomicile: value, expected: ORIGINAL });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "venue.detail_invalid", params: { field: "taxpayerDomicile", reason } },
    });
    expect((await taxpayerRow()).taxpayerDomicile).toBe(ORIGINAL);
  });

  it.each([
    ["a non-object body", ["Calle Mayor 1"], "body", "type"],
    [
      "an unknown key",
      { taxpayerDomicile: "Calle Mayor 1", expected: "", colour: "red" },
      "body",
      "unknown_field",
    ],
    ["a non-string address", { taxpayerDomicile: 7, expected: "" }, "taxpayerDomicile", "type"],
    ["a missing expected address", { taxpayerDomicile: "Calle Mayor 1" }, "expected", "type"],
  ])("refuses %s", async (_label, body, field, reason) => {
    const response = await put(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "venue.detail_invalid", params: { field, reason } },
    });
    expect((await taxpayerRow()).taxpayerDomicile).toBe(ORIGINAL);
  });

  it.each(["legalName", "taxId", "country", "fiscalTerritory"])(
    "refuses a body carrying the read-only %s by name and writes nothing",
    async (field) => {
      const response = await put({
        taxpayerDomicile: "Calle Mayor 1",
        expected: ORIGINAL,
        [field]: "ES",
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "venue.detail_read_only", params: { field } },
      });
      expect(await taxpayerRow()).toMatchObject({ taxpayerDomicile: ORIGINAL });
    },
  );
});

describe("the registered address on full invoices", () => {
  let venue: OrderVenue;

  beforeEach(async () => {
    venue = await provisionOrderVenue(suite.db);
    await suite.db.execute(sql`update taxpayer set taxpayer_domicile = ${ORIGINAL} where id = 1`);
    await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, venue.adminDashboard));
  });

  async function fullInvoice(): Promise<string> {
    const [series] = await suite.db
      .select({ id: invoiceSeries.id })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.purpose, "full"));
    const billId = await parked(venue, "Tarta");
    const { saleId } = await inTx(venue, (tx) =>
      recordSale(tx, venue.backend, {
        operationDescription: "Restaurante",
        origin: venue.cfg.origin,
        nodeId: venue.cfg.nodeId,
        seriesId: brandSeriesId(series!.id),
        workingOrderId: brandWorkingOrderId(billId),
        locale: venue.cfg.locale,
        invoiceLocales: [venue.cfg.locale],
        counterparty: { taxId: "B76543214", legalName: "Puig Electrical Ltd", countryCode: "ES" },
        recipientAddress: "4 Mill Lane, 46001 Valencia",
        total: "10.00",
        lines: [
          {
            lineNo: 1,
            name: "Beer",
            descriptions: { [venue.cfg.locale]: "Draught beer" },
            quantity: "1",
            unitPrice: "10.00",
            vatRate: "10",
            lineTotal: "10.00",
          },
        ],
        clock: venue.clock,
        settlement: { kind: "deferred" },
        operatorId: venue.operatorId,
      }),
    );
    return saleId;
  }
  const printed = (saleId: string) =>
    inTx(
      venue,
      async (tx) =>
        (await readCustomerInvoiceDocument(venue.backend, tx, venue.cfg, saleId)).issuer,
    );

  it("prints the new address on invoices issued after the change and the old one on those before", async () => {
    const before = await fullInvoice();
    const next = "2º 1ª, Carrer de Mallorca 1, 08010 Barcelona, Barcelona";
    const response = await change(
      { taxpayerDomicile: next, expected: ORIGINAL },
      venue.adminDashboard,
    );
    expect(response.status).toBe(200);
    const after = await fullInvoice();
    expect(await printed(before)).toMatchObject({ domicile: ORIGINAL });
    expect(await printed(after)).toMatchObject({ domicile: next });
    const stored = await suite.db
      .select({ id: sales.id, domicile: sales.taxpayerDomicile })
      .from(sales)
      .where(eq(sales.id, before));
    expect(stored).toEqual([{ id: before, domicile: ORIGINAL }]);
  });
});
