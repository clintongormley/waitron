import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction, workingOrderLines } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createProduct,
  patchLiveMenu,
  readLiveMenu,
} from "@waitron/catalogue";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
} from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { updateHeldOrder } from "./testing/order-writer-fixture.js";
import { parkOrder, readOrderRevision } from "./working-order.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { deviceRequestCfg } from "./testing/session-device.js";

// A menu patch reprices what is sold from then on; a line already on an open order keeps the price
// and VAT class it locked when it was added.
const LOCALE = "es-ES";
const EDITOR = "0000ffff-2222-4000-8000-0000000000cc";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return nifWithControlLetter(78_000_000 + nifCounter);
}

async function setupVenue() {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Bar del Parche SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );
  const cfg = await deviceRequestCfg(suite.db, {
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  });

  const cana = await withTransaction(suite.db, async (tx) => {
    const menu = await createCatalogue(tx, { name: "Carta" });
    const product = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Caña",
      pricingUnit: "each",
      unitPrice: "2.50",
      vatClass: "reduced",
    });
    await assignCatalogueToLocation(tx, venue.locationId, menu.id);
    return product.id;
  });
  const counter = await withTransaction(suite.db, (tx) => offerProducts(tx, cfg));
  return { cfg, cana, counter, menuId: counter.menuId };
}

type Venue = Awaited<ReturnType<typeof setupVenue>>;

async function park(v: Venue, lines: Parameters<typeof parkOrder>[2]["lines"]): Promise<string> {
  const id = randomUUID();
  await parkOrder({ db: suite.db }, v.cfg, { id, zoneId: v.counter.zoneId, lines });
  return id;
}

const one = (v: Venue, menuVersionId?: string) => [
  {
    menuItemId: v.counter.offerFor(v.cana),
    quantity: "1",
    ...(menuVersionId === undefined ? {} : { menuVersionId }),
  },
];

async function stored(workingOrderId: string) {
  return suite.db
    .select({
      id: workingOrderLines.id,
      vatClass: workingOrderLines.vatClass,
      unitPriceGross: workingOrderLines.unitPriceGross,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, workingOrderId))
    .orderBy(workingOrderLines.lineNo);
}

/** Patches Caña's price to 3.10 and its class to `general`, from the live version; both ids. */
async function patchCana(v: Venue): Promise<{ before: string; after: string }> {
  return withTransaction(suite.db, async (tx) => {
    const live = await readLiveMenu(tx, v.menuId);
    if (live === null) throw new Error("the counter menu has no live version");
    const menuItemId = Object.keys(live.document.offers).find(
      (key) => live.document.offers[key]!.productId === v.cana,
    );
    if (menuItemId === undefined) throw new Error("the live version does not offer Caña");
    const { versionId } = await patchLiveMenu(
      tx,
      v.menuId,
      live.versionId,
      [
        { target: { kind: "offer", menuItemId }, field: "price", value: "3.10" },
        { target: { kind: "offer", menuItemId }, field: "vatClass", value: "general" },
      ],
      EDITOR,
    );
    return { before: live.versionId, after: versionId };
  });
}

async function addLine(v: Venue, id: string, menuVersionId: string) {
  const kept = await stored(id);
  const revision = await withTransaction(suite.db, (tx) => readOrderRevision(tx, id));
  return updateHeldOrder({ db: suite.db }, v.cfg, id, {
    lines: [
      ...kept.map((line) => ({
        workingOrderLineId: line.id,
        menuItemId: v.counter.offerFor(v.cana),
        quantity: "1",
      })),
      ...one(v, menuVersionId),
    ],
    revision,
  });
}

describe("a menu patch and the lines already on open orders", () => {
  it("a parked line keeps its price and class; a line added after the patch takes the patch's", async () => {
    const v = await setupVenue();
    const id = await park(v, one(v));
    const [opened] = await stored(id);
    // The values the line locked when it was parked, before any patch.
    expect([opened!.unitPriceGross, opened!.vatClass]).toEqual([250, "reduced"]);

    const { after } = await patchCana(v);
    expect((await stored(id)).map((line) => [line.unitPriceGross, line.vatClass])).toEqual([
      [250, "reduced"],
    ]);

    await addLine(v, id, after);
    expect((await stored(id)).map((line) => [line.unitPriceGross, line.vatClass])).toEqual([
      [250, "reduced"],
      [310, "general"],
    ]);
  });

  it("a line asserting the version the patch replaced is refused, and the order is unchanged", async () => {
    const v = await setupVenue();
    const id = await park(v, one(v));
    const { before, after } = await patchCana(v);

    await expect(addLine(v, id, before)).rejects.toMatchObject({
      code: "menu.version_changed",
      params: { menus: [{ menuId: v.menuId, liveVersionId: after }] },
    });
    expect((await stored(id)).map((line) => [line.unitPriceGross, line.vatClass])).toEqual([
      [250, "reduced"],
    ]);
  });
});
