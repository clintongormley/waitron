import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { triggerRaised } from "./constraint-target.js";
import { settings } from "./schema/settings.js";
import { useVenueDb } from "./testing/venue-db.js";
import { CORE_MIGRATIONS } from "./migrations.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const insertDoc = async (doc: unknown, module = "venue") =>
  suite.db.run(sql`
  insert into settings (module, version, revision, doc, updated_at)
  values (${module}, 1, 1, ${JSON.stringify(doc)}, '2026-11-10T10:00:00.000Z')
`);

async function refuses(action: () => unknown) {
  await expect(Promise.resolve().then(action)).rejects.toSatisfy((error: unknown) =>
    triggerRaised(error, "settings.invalid"),
  );
}

describe("receipt languages in the venue document", () => {
  it("accepts a single locale", async () => {
    await expect(insertDoc({ invoiceLocales: ["es"] })).resolves.toBeDefined();
  });

  it("accepts two locales and preserves their order on insert and update", async () => {
    await insertDoc({ invoiceLocales: ["ca", "es"] });
    expect((await suite.db.select().from(settings))[0]!.doc).toEqual({
      invoiceLocales: ["ca", "es"],
    });
    await suite.db.run(
      sql`update settings set doc = '{"invoiceLocales":["es","ca"]}' where module = 'venue'`,
    );
    expect((await suite.db.select().from(settings))[0]!.doc).toEqual({
      invoiceLocales: ["es", "ca"],
    });
  });

  it.each([[], ["es", "ca", "en"], "es", null].map((value) => [value]))(
    "rejects an invalid locale list %j",
    async (invoiceLocales) => {
      await refuses(() => insertDoc({ invoiceLocales }));
    },
  );

  it("refuses a venue document with no invoiceLocales key", async () => {
    await refuses(() => insertDoc({ name: "V" }));
  });

  it("refuses an update emptying receipt languages", async () => {
    await insertDoc({ invoiceLocales: ["es"] });
    await refuses(() =>
      suite.db.run(sql`update settings set doc = '{"invoiceLocales":[]}' where module = 'venue'`),
    );
    expect((await suite.db.select().from(settings))[0]!.doc).toEqual({ invoiceLocales: ["es"] });
  });

  it("does not impose the venue rule on another module", async () => {
    await insertDoc({}, "other");
    expect(() =>
      suite.db.run(sql`update settings set doc = '{"invoiceLocales":[]}' where module = 'other'`),
    ).not.toThrow();
  });
});
