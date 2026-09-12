import { expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { listImages, uploadImage } from "./images.js";

const suite = useTemplateDb({ template: "media" });

it("sorts accented names alphabetically in both directions across pages", async () => {
  const tenantId = await seedTenant(suite.admin);
  await withTenant(suite.admin, tenantId, async (tx) => {
    await asAppUser(tx);
    for (const [index, name] of ["Zest", "Éclair", "Apple", "Bread"].entries()) {
      await uploadImage(
        tx,
        tenantId,
        {
          bytes: new Uint8Array([0xff, 0xd8, 0xff, index]),
          names: { en: name },
          altText: { en: name },
          labels: ["Food"],
        },
        { fallbackLanguage: "en", maxUploadBytes: 100 },
      );
    }
    for (const direction of ["asc", "desc"] as const) {
      const query = {
        sort: "name" as const,
        direction,
        limit: 2,
        label: "Food",
        fallbackLanguage: "en",
      };
      const first = await listImages(tx, tenantId, query);
      const second = await listImages(tx, tenantId, { ...query, offset: 2 });
      expect(first.total).toBe(4);
      const expected = ["Apple", "Bread", "Éclair", "Zest"];
      expect([...first.images, ...second.images].map((image) => image.names.en)).toEqual(
        direction === "asc" ? expected : expected.reverse(),
      );
    }
  });
});
