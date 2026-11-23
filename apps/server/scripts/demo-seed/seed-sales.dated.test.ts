/**
 * Each back-dated demo sale files the VAT rate in force on its own day, not today's.
 */

import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { saleLines, sales } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import { hashPassword, hashPin } from "@waitron/identity";
import { localCalendarDate } from "@waitron/menu";
import { timeZoneOffsetMinutes } from "@waitron/shared";
import { ALL_MODULES } from "../../src/modules.js";
import { seedSales } from "./seed-sales.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const VENUE_ZONE = "Europe/Madrid";

// The area's dine-in rate: 10%, and 4% from yesterday's date in the venue's time zone, which is
// the day a sale files by, whatever the host's zone.
const CHANGE = vi.hoisted(() => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const part = (type: string) => parts.find((one) => one.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
});
vi.mock("@waitron/country-packs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/country-packs")>();
  return {
    ...actual,
    vatRatesFor: (...args: Parameters<typeof actual.vatRatesFor>) => {
      const rates = actual.vatRatesFor(...args);
      return (
        rates && {
          ...rates,
          dineIn: [
            { from: null, rate: "10.00" },
            { from: CHANGE, rate: "4.00" },
          ],
        }
      );
    },
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
          taxId: "81000001G",
          legalName: "Casa Delgado SL",
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: ["es-ES"],
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: VENUE_ZONE,
          dayCutover: "05:00",
          seriesCode: "A",
          correctiveSeriesCode: "R",
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
      venue: {
        nodeId: venue.nodeId,
        seriesId: venue.seriesIds[0]!,
        operationDescription: "Venta en establecimiento",
      },
      invoiceLocale: "es-ES",
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
      return {
        on: localCalendarDate(instant, timeZoneOffsetMinutes(VENUE_ZONE, instant)),
        vatRate,
      };
    });
    const before = byDay.filter(({ on }) => on < CHANGE);
    const from = byDay.filter(({ on }) => on >= CHANGE);

    expect(before.length).toBeGreaterThan(0);
    expect(from.length).toBeGreaterThan(0);
    expect(new Set(before.map(({ vatRate }) => vatRate))).toEqual(new Set([1000]));
    expect(new Set(from.map(({ vatRate }) => vatRate))).toEqual(new Set([400]));
    expect(Date.now() - Date.parse(lines[0]!.issuedAt)).toBeLessThan(3.5 * DAY_MS);
  });
});
