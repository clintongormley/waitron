import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { invoiceSeries, locations, nodes, withTransaction, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { decimal, nodeId, seriesId } from "@waitron/shared";
import { selectOrderInvoice } from "./invoice-selection.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
});
const policy = { recipientNameMaxLength: 120 };
const recipient = {
  taxId: "B12345674",
  legalName: "Cliente SL",
  address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
  countryCode: "ES",
};

async function bill(full = false) {
  return withTransaction(suite.db, async (tx) => {
    const [location] = await tx
      .insert(locations)
      .values({
        name: "Selector",
        invoiceLocales: ["es-ES"],
        operationDescription: "Restaurant",
      })
      .returning();
    const [node] = await tx
      .insert(nodes)
      .values({ locationId: location!.id, name: "Selector" })
      .returning();
    const [standard, fullSeries] = await tx
      .insert(invoiceSeries)
      .values([
        { nodeId: node!.id, code: "FS", purpose: "standard", nextNumber: 7 },
        { nodeId: node!.id, code: "FF", purpose: "full", nextNumber: 11 },
        { nodeId: node!.id, code: "FR", purpose: "rectificative", nextNumber: 19 },
      ])
      .returning();
    const [order] = await tx
      .insert(workingOrders)
      .values({
        source: "operator_script",
        locationId: location!.id,
        nodeId: node!.id,
        orderNumber: 1,
        invoiceType: full ? "F1" : "F2",
        recipientTaxId: full ? recipient.taxId : null,
        recipientLegalName: full ? recipient.legalName : null,
        recipientAddress: full ? recipient.address : null,
        recipientCountryCode: full ? recipient.countryCode : null,
      })
      .returning();
    return {
      id: order!.id,
      fullSeriesId: fullSeries!.id,
      cfg: {
        nodeId: nodeId(node!.id),
        seriesId: seriesId(standard!.id),
        simplifiedInvoiceLimit: decimal("3000.00"),
      },
    };
  });
}

describe("stored bill invoice selection", () => {
  it.each(["0.00", "3.00", "3000.00"])(
    "keeps F2 ticket numbering for a bill at %s",
    async (total) => {
      const order = await bill();
      const selected = await withTransaction(suite.db, (tx) =>
        selectOrderInvoice(tx, policy, order.cfg, order.id, decimal(total)),
      );
      expect(selected).toEqual({
        invoiceType: "F2",
        recipient: undefined,
        sale: {
          seriesId: order.cfg.seriesId,
          counterparty: null,
          recipientAddress: null,
        },
      });
    },
  );

  it.each(["0.00", "3.00", "3000.01", "3500.00"])(
    "uses the saved F1 recipient and full series at %s",
    async (total) => {
      const order = await bill(true);
      const selected = await withTransaction(suite.db, (tx) =>
        selectOrderInvoice(tx, policy, order.cfg, order.id, decimal(total)),
      );
      expect(selected).toEqual({
        invoiceType: "F1",
        recipient,
        sale: {
          seriesId: order.fullSeriesId,
          counterparty: { taxId: "B12345674", legalName: "Cliente SL", countryCode: "ES" },
          recipientAddress: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        },
      });
      const counters = await suite.db
        .select({ code: invoiceSeries.code, next: invoiceSeries.nextNumber })
        .from(invoiceSeries)
        .where(eq(invoiceSeries.nodeId, order.cfg.nodeId))
        .orderBy(invoiceSeries.code);
      expect(counters).toEqual([
        { code: "FF", next: 11 },
        { code: "FR", next: 19 },
        { code: "FS", next: 7 },
      ]);
    },
  );

  it("refuses a larger F2 bill before it can draw a number", async () => {
    const order = await bill();
    await expect(
      withTransaction(suite.db, (tx) =>
        selectOrderInvoice(tx, policy, order.cfg, order.id, decimal("3000.01")),
      ),
    ).rejects.toMatchObject({
      code: "sale.total_exceeds_simplified_limit",
      params: { total: "3000.01", limit: "3000.00" },
    });
  });

  it("allows a regime with no simplified ceiling", async () => {
    const order = await bill();
    const selected = await withTransaction(suite.db, (tx) =>
      selectOrderInvoice(
        tx,
        policy,
        { ...order.cfg, simplifiedInvoiceLimit: null },
        order.id,
        decimal("3500.00"),
      ),
    );
    expect(selected.sale.counterparty).toBeNull();
    expect(selected.sale.seriesId).toBe(order.cfg.seriesId);
  });

  it.each(["missing", "retired", "wrong-node"])(
    "refuses a %s full series instead of selecting the ticket series",
    async (condition) => {
      const order = await bill(true);
      const other = condition === "wrong-node" ? await bill() : undefined;
      await withTransaction(suite.db, async (tx) => {
        if (condition === "missing")
          await tx.delete(invoiceSeries).where(eq(invoiceSeries.id, order.fullSeriesId));
        else if (condition === "retired")
          await tx
            .update(invoiceSeries)
            .set({ retiredAt: new Date() })
            .where(eq(invoiceSeries.id, order.fullSeriesId));
        else {
          await tx
            .update(invoiceSeries)
            .set({ nodeId: other!.cfg.nodeId, code: "other-full" })
            .where(eq(invoiceSeries.id, order.fullSeriesId));
        }
      });
      await expect(
        withTransaction(suite.db, (tx) =>
          selectOrderInvoice(tx, policy, order.cfg, order.id, decimal("3.00")),
        ),
      ).rejects.toMatchObject({ code: "series.no_full_for_node" });
    },
  );

  it("refuses two live full series instead of picking either", async () => {
    const order = await bill(true);
    await suite.db
      .insert(invoiceSeries)
      .values({ nodeId: order.cfg.nodeId, code: "FF2", purpose: "full" });
    await expect(
      withTransaction(suite.db, (tx) =>
        selectOrderInvoice(tx, policy, order.cfg, order.id, decimal("3.00")),
      ),
    ).rejects.toThrow("more than one full series");
  });

  it.each(["missing", "other-node"])(
    "refuses a %s bill without selecting another node's identity",
    async (condition) => {
      const order = await bill(true);
      const id = condition === "missing" ? randomUUID() : order.id;
      const cfg = condition === "missing" ? order.cfg : (await bill()).cfg;
      await expect(
        withTransaction(suite.db, (tx) => selectOrderInvoice(tx, policy, cfg, id, decimal("3.00"))),
      ).rejects.toMatchObject({ code: "working_order.not_open", params: { workingOrderId: id } });
    },
  );

  it.each([
    { field: "taxId", change: { recipientTaxId: null } },
    { field: "legalName", change: { recipientLegalName: null } },
    { field: "address", change: { recipientAddress: null } },
  ])("refuses a missing saved F1 $field", async ({ field, change }) => {
    const order = await bill(true);
    await suite.db.update(workingOrders).set(change).where(eq(workingOrders.id, order.id));
    await expect(
      withTransaction(suite.db, (tx) =>
        selectOrderInvoice(tx, policy, order.cfg, order.id, decimal("3.00")),
      ),
    ).rejects.toMatchObject({ code: "invoice.recipient_invalid", params: { field } });
  });

  it.each([null, "E", "FR"])(
    "refuses saved recipient country %s before numbering",
    async (country) => {
      const order = await bill(true);
      await suite.db
        .update(workingOrders)
        .set({ recipientCountryCode: country })
        .where(eq(workingOrders.id, order.id));
      await expect(
        withTransaction(suite.db, (tx) =>
          selectOrderInvoice(tx, policy, order.cfg, order.id, decimal("3.00")),
        ),
      ).rejects.toMatchObject(
        country === "FR"
          ? { code: "fiscal.foreign_recipient_unsupported", params: { countryCode: "FR" } }
          : { code: "management.request_invalid", params: { field: "recipient.countryCode" } },
      );
    },
  );
});
