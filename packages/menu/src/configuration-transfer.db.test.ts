import { expect, it } from "vitest";
import { settings, taxpayer, withTransaction } from "@waitron/db";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { countingReadsOf, useMenuDb } from "../test/fixtures.js";
import { MENU_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";

const fx = useMenuDb();

it("checks the takeaway rates against the area with the one taxpayer and venue read it already makes", async () => {
  await seedVenue(fx.db);
  const reads = (rate: number) =>
    withTransaction(fx.db, async (tx) => {
      const taxpayers = countingReadsOf(tx, taxpayer);
      const settingsReads = countingReadsOf(taxpayers.tx, settings);
      const outcome = await MENU_CONFIGURATION_TRANSFER.beforeImport(
        settingsReads.tx,
        { product_takeaway_vat_rates: [{ product_id: "gin", starts_on: null, rate }] },
        { contentLanguages: { defaultLanguage: "es", languages: ["es"] } },
      ).then(
        () => "accepted",
        (error: { code?: string; params?: unknown }) => ({
          code: error.code,
          params: error.params,
        }),
      );
      return { outcome, taxpayer: taxpayers.reads(), settings: settingsReads.reads() };
    });
  expect(await reads(1000)).toEqual({ outcome: "accepted", taxpayer: 1, settings: 1 });
  expect(await reads(500)).toEqual({
    outcome: {
      code: "setup.request_invalid",
      params: { field: "product_takeaway_vat_rates.rate" },
    },
    taxpayer: 1,
    settings: 1,
  });
});
