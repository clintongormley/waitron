/**
 * Each back-dated demo sale files the VAT rate in force on its own day, not today's.
 */

import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { saleLines, sales } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { hashPassword, hashPin } from "@waitron/identity";
import { localCalendarDate } from "@waitron/catalogue";
import { ALL_MODULES } from "../../src/modules.js";
import { SEED_INVOICE_LOCALE } from "./menu.js";
import { seedSales } from "./seed-sales.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const offsetAt = (instant: Date) => -instant.getTimezoneOffset();

// A reduced rate of 11% from yesterday's local date, the shipped table otherwise.
const CHANGE = vi.hoisted(() => {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const local = new Date(yesterday.getTime() - yesterday.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
});
vi.mock("@waitron/catalogue/src/vat-rates.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("@waitron/catalogue/src/vat-rates.js")>();
  const table = {
    ...original.VAT_RATE_TABLE,
    reduced: [
      { from: null, rate: "10.00" },
      { from: CHANGE, rate: "11.00" },
    ],
  };
  return {
    ...original,
    VAT_RATE_TABLE: table,
    vatRateOn: (...[vatClass, date, given]: Parameters<typeof original.vatRateOn>) =>
      original.vatRateOn(vatClass, date, given ?? table),
  };
});

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

describe("seedSales across a rate change", () => {
  it("files each sale at the rate of its own day", async () => {
    const venue = await applyVenue(
      planVenue(
        {
          country: "ES",
          taxId: "81000001K",
          legalName: "Casa Delgado SL",
          location: {
            name: "Sala principal",
            fiscalTerritory: "ES-common",
            invoiceLocales: [SEED_INVOICE_LOCALE.es],
            operationDescription: "Venta en establecimiento",
            addressLine1: "Calle Mayor 1",
            addressLine2: null,
            postalCode: "28013",
            city: "Madrid",
            province: "Madrid",
            timeZone: "Europe/Madrid",
            dayCutover: "05:00",
          },
          tillName: "Caja 1",
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

    await seedSales(suite.db, {
      venue: { tillId: venue.tillId, nodeId: venue.nodeId, seriesId: venue.seriesIds[0]! },
      locale: "es",
      days: 3,
      products: [
        {
          id: "p-reduced",
          name: "Pan de la casa",
          customerName: { es: "Pan de la casa" },
          unitPrice: "2.40",
          vatClass: "reduced",
        },
      ],
    });

    const lines = await suite.db
      .select({ issuedAt: sales.issuedAt, vatRate: saleLines.vatRate })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId));
    const byDay = lines.map(({ issuedAt, vatRate }) => {
      const instant = new Date(issuedAt);
      return { on: localCalendarDate(instant, offsetAt(instant)), vatRate };
    });
    const before = byDay.filter(({ on }) => on < CHANGE);
    const from = byDay.filter(({ on }) => on >= CHANGE);

    expect(before.length).toBeGreaterThan(0);
    expect(from.length).toBeGreaterThan(0);
    expect(new Set(before.map(({ vatRate }) => vatRate))).toEqual(new Set([1000]));
    expect(new Set(from.map(({ vatRate }) => vatRate))).toEqual(new Set([1100]));
    expect(Date.now() - Date.parse(lines[0]!.issuedAt)).toBeLessThan(3.5 * DAY_MS);
  });
});
