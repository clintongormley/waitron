import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as cataloguePricing from "@waitron/catalogue";
import { locations, products, withTransaction, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createExtraList,
  createProduct,
  setProductVariants,
  units,
  writeContentLanguages,
  writeProductModifiers,
} from "@waitron/catalogue";
import { workingLineContexts } from "@waitron/venue-service";
import { provisionBillVenue, type BillVenue } from "./testing/bill-venue.js";
import { offerProducts } from "./testing/zone-offers.js";
import { createOpenOrder, prepareRecalledModifiers, priceOrderLines } from "./working-order.js";
import { readSettledTicket, recordTillSaleOrchestration, reprintSale } from "./till-sale.js";
import { resolveTranslationCells } from "@waitron/catalogue/src/content-translation-cells.js";
import { saveContentTranslations } from "@waitron/catalogue/src/content-translations.js";
import { republishMenus } from "./testing/publish-menu.js";

let venue: BillVenue;
const database = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
beforeEach(async () => {
  venue = await provisionBillVenue(database.db);
});

async function arrange() {
  return withTransaction(venue.db, async (tx) => {
    await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "es", "fr"] });
    await tx
      .update(locations)
      .set({ invoiceLocales: ["es-ES", "en-GB"] })
      .where(eq(locations.id, venue.cfg.locationId));
    const catalogue = await createCatalogue(tx, { name: "Fallback catalogue" });
    await assignCatalogueToLocation(tx, venue.cfg.locationId, catalogue.id);
    const [unit] = await tx
      .insert(units)
      .values({
        staffName: "Staff portion",
        staffAbbreviation: "sp",
        name: { fr: "Other portion" },
        abbreviation: { fr: "op" },
        precision: 0,
        hardwareUnit: null,
      })
      .returning();
    const dish = await createProduct(tx, {
      catalogueId: catalogue.id,
      categoryId: null,
      name: "Staff dish",
      customerName: { fr: "Other dish" },
      kitchenName: "Kitchen dish",
      unitId: unit!.id,
      unitPrice: "12.00",
      vatClass: "general",
    });
    const parent = await createProduct(tx, {
      catalogueId: catalogue.id,
      categoryId: null,
      name: "Staff topping",
      customerName: { en: "Published English topping" },
      kitchenName: "Kitchen topping",
      pricingUnit: "each",
      unitPrice: "4.00",
      vatClass: "general",
    });
    const [variant] = await setProductVariants(
      tx,
      parent.id,
      [
        {
          name: "Staff large",
          customerName: { es: "Requested large" },
          kitchenName: "Kitchen large",
          image: null,
          unitPrice: "4.00",
          available: true,
        },
      ],
      "en",
    );
    const extra = await createExtraList(
      tx,
      {
        name: "Staff extras",
        customerName: null,
        kitchenName: "Kitchen extras",
        minPicks: 0,
        maxPicks: null,
        active: true,
        items: [{ productId: variant!.id, maxQuantity: 2, preselected: false, price: "2.00" }],
      },
      "en",
    );
    await writeProductModifiers(tx, dish.id, [{ kind: "extras", id: extra.id }]);
    const offers = await offerProducts(tx, venue.cfg, { productIds: [dish.id] });
    return { dish, parent, variant: variant!, extra, unit: unit!, offers };
  });
}

describe("future order customer fallback", () => {
  it("carries recorded dish maps unchanged while preparing a recalled dish's new extra", async () => {
    const setup = await arrange();
    const id = randomUUID();
    const parent = await withTransaction(venue.db, async (tx) => {
      await createOpenOrder(
        tx,
        venue.cfg,
        id,
        [{ menuItemId: setup.offers.offerFor(setup.dish.id), quantity: "1" }],
        null,
        { zoneId: setup.offers.zoneId },
      );
      const [line] = await tx
        .update(workingOrderLines)
        .set({
          descriptions: { "es-ES": "Recorded first", "en-GB": "Recorded second" },
          unitName: { "fr-FR": "Recorded abbreviation" },
        })
        .where(eq(workingOrderLines.workingOrderId, id))
        .returning();
      await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "en", "fr"] });
      return line!;
    });
    const before = await venue.db
      .select()
      .from(workingLineContexts)
      .where(eq(workingLineContexts.workingOrderLineId, parent.id));
    const pricing = vi.spyOn(cataloguePricing, "grossBasketWithOptions");
    try {
      const plans = await withTransaction(venue.db, (tx) =>
        prepareRecalledModifiers(tx, venue.cfg, id, [
          {
            parent,
            children: [],
            input: {
              quantity: "1",
              extras: [
                { listId: setup.extra.id, picks: [{ productId: setup.variant.id, quantity: 1 }] },
              ],
            },
          },
        ]),
      );
      const [basket] = pricing.mock.calls.at(-1)!;
      expect(basket[0]!.product.descriptions).toEqual({
        "es-ES": "Recorded first",
        "en-GB": "Recorded second",
      });
      expect(basket[0]!.product.unit.abbreviation).toEqual({ "fr-FR": "Recorded abbreviation" });
      const priced = pricing.mock.results.at(-1)!.value as ReturnType<
        typeof cataloguePricing.grossBasketWithOptions
      >;
      expect(priced.lines[0]!.descriptions).toEqual({
        "es-ES": "Recorded first",
        "en-GB": "Recorded second",
      });
      expect(priced.lines[0]!.unitName).toEqual({ "fr-FR": "Recorded abbreviation" });
      expect(plans.get(parent.id)!.added!.lineRows[0]!.descriptions).toEqual({
        "es-ES": "Staff topping (Requested large)",
        "en-GB": "Staff topping (Requested large)",
      });
      expect(plans.get(parent.id)!.added!.lineRows).toHaveLength(1);
    } finally {
      pricing.mockRestore();
    }
    const [after] = await venue.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.id, parent.id));
    expect(after).toEqual(parent);
    expect(
      await venue.db
        .select()
        .from(workingLineContexts)
        .where(eq(workingLineContexts.workingOrderLineId, parent.id)),
    ).toEqual(before);
  });

  it("keeps complete recorded rows and receipt facts across translation save, a default change and reprint", async () => {
    const setup = await arrange();
    const id = randomUUID();
    const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
    const issued = await recordTillSaleOrchestration(
      deps,
      venue.cfg,
      {
        workingOrderId: id,
        expectedEdit: null,
        zoneId: setup.offers.zoneId,
        lines: [{ menuItemId: setup.offers.offerFor(setup.dish.id), quantity: "1" }],
        tender: { method: "cash", amount: "12.00" },
      },
      venue.operatorId,
    );
    const frozen = () =>
      Object.fromEntries(
        [
          "working_orders",
          "working_order_lines",
          "working_line_contexts",
          "sales",
          "sale_lines",
          "invoice_series",
          "registros_facturacion",
          "menu_versions",
          "menu_publications",
        ].map((name) => [
          name,
          venue.db.all<Record<string, unknown>>(
            sql`select * from ${sql.identifier(name)} order by rowid`,
          ),
        ]),
      );
    const before = frozen();
    expect(before.sales).toHaveLength(1);
    expect(before.sale_lines).toHaveLength(1);
    expect(before.registros_facturacion).toHaveLength(1);
    expect(before.menu_versions!.length).toBeGreaterThan(0);
    const receiptBefore = await withTransaction(venue.db, (tx) =>
      readSettledTicket(venue.backend, tx, venue.cfg, id),
    );
    expect(receiptBefore.lines).toEqual(issued.lines);
    await withTransaction(venue.db, async (tx) => {
      const context = { fallbackLanguage: "en", required: [] };
      const { cells } = await resolveTranslationCells(
        tx,
        [
          { kind: "product", id: setup.dish.id, language: "es", field: "name" },
          { kind: "unit", id: setup.unit.id, language: "es", field: "name" },
          { kind: "unit", id: setup.unit.id, language: "es", field: "abbreviation" },
        ],
        context,
      );
      await saveContentTranslations(
        tx,
        {
          edits: cells.map(({ kind, id, language, field, expected }) => ({
            kind,
            id,
            language,
            field,
            expected,
            text:
              kind === "product"
                ? "New customer dish"
                : field === "name"
                  ? "New customer portion"
                  : "np",
          })),
        },
        context,
      );
      await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "en", "fr"] });
    });
    const receiptAfter = await withTransaction(venue.db, (tx) =>
      readSettledTicket(venue.backend, tx, venue.cfg, id),
    );
    expect(receiptAfter).toEqual(receiptBefore);
    await reprintSale(deps, venue.cfg, id, undefined, venue.operatorId);
    expect(frozen()).toEqual(before);
    const price = () =>
      withTransaction(venue.db, (tx) =>
        priceOrderLines(
          tx,
          venue.cfg,
          randomUUID(),
          [{ menuItemId: setup.offers.offerFor(setup.dish.id), quantity: "1" }],
          setup.offers.zoneId,
        ),
      );
    const oldPublication = await price();
    expect(oldPublication.lineRows[0]!.descriptions).toEqual({
      "es-ES": "Staff dish",
      "en-GB": "Staff dish",
    });
    expect(oldPublication.lineRows[0]!.unitName).toEqual({ es: "sp" });
    await withTransaction(venue.db, republishMenus);
    const newPublication = await price();
    expect(newPublication.lineRows[0]!.descriptions).toEqual({
      "es-ES": "New customer dish",
      "en-GB": "New customer dish",
    });
    expect(newPublication.lineRows[0]!.unitName).toEqual({ es: "np" });
    expect(newPublication.lineContexts[0]!.unit!.name).toEqual({ es: "New customer portion" });
    expect(newPublication.gross.total).toBe("12.00");
  });

  it("freezes the published staff unit abbreviation and full name separately", async () => {
    const setup = await arrange();
    const orderId = randomUUID();
    await withTransaction(venue.db, async (tx) => {
      await tx
        .update(units)
        .set({ staffName: "Live replacement", staffAbbreviation: "live" })
        .where(eq(units.id, setup.unit.id));
      await createOpenOrder(
        tx,
        venue.cfg,
        orderId,
        [{ menuItemId: setup.offers.offerFor(setup.dish.id), quantity: "2" }],
        null,
        { zoneId: setup.offers.zoneId },
      );
    });
    const [line] = await venue.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, orderId));
    const [context] = await venue.db
      .select()
      .from(workingLineContexts)
      .where(eq(workingLineContexts.workingOrderLineId, line!.id));
    expect(line!.descriptions).toEqual({ "es-ES": "Staff dish", "en-GB": "Staff dish" });
    expect(line!.unitName).toEqual({ en: "sp" });
    expect(context!.unitName).toEqual({ en: "Staff portion" });
    expect(line!.quantity).toBe(2000);
    expect(line!.lineTotal).toBe(2400);
    expect(line!.vatClass).toBe("general");
  });

  it("resolves an extra's frozen parent and variant independently after a default change", async () => {
    const setup = await arrange();
    const priced = await withTransaction(venue.db, async (tx) => {
      await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "en", "fr"] });
      await tx
        .update(products)
        .set({ name: "Live replacement", customerName: { es: "Live customer" } })
        .where(eq(products.id, setup.parent.id));
      return priceOrderLines(
        tx,
        venue.cfg,
        randomUUID(),
        [
          {
            menuItemId: setup.offers.offerFor(setup.dish.id),
            quantity: "1",
            extras: [
              { listId: setup.extra.id, picks: [{ productId: setup.variant.id, quantity: 1 }] },
            ],
          },
        ],
        setup.offers.zoneId,
      );
    });
    expect(priced.lineRows[1]!.descriptions).toEqual({
      "es-ES": "Staff topping (Requested large)",
      "en-GB": "Staff topping (Requested large)",
    });
    expect(priced.lineRows[1]!.name).toBe("Staff topping (Staff large)");
    expect(priced.lineRows[1]!.kitchenName).toBe("Kitchen topping (Kitchen large)");
    expect(priced.gross.total).toBe("14.00");
  });
});
