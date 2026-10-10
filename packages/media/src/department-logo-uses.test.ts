import { expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS, locations, tenantReceipts, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { departmentReceipts, departments, VENUE_SERVICE_MIGRATIONS } from "@waitron/venue-service";
import { deleteImage, listImages, listImageUsages, readImage, uploadImage } from "./images.js";
import { MEDIA_MIGRATIONS } from "./migrations.js";
import { samplePreparedImage } from "./testing/sample-image.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS, MEDIA_MIGRATIONS],
});
const photo = await samplePreparedImage({ width: 19 });

it("counts only stored venue and department logos and protects each until cleared", async () => {
  await seedTenant(suite.db);
  await withTransaction(suite.db, async (tx) => {
    const [place] = await tx
      .insert(locations)
      .values({
        name: "Dining room",
        invoiceLocales: ["es-ES"],
        operationDescription: "Hospitality",
      })
      .returning();
    const rows = await tx
      .insert(departments)
      .values([
        { locationId: place!.id, name: "Dining", tradingName: "Room" },
        { locationId: place!.id, name: "Bar", tradingName: "Counter", active: false },
        { locationId: place!.id, name: "Garden", tradingName: "Terrace" },
        { locationId: place!.id, name: "Events", tradingName: "Events" },
      ])
      .returning();
    const { image } = await uploadImage(
      tx,
      { image: photo, names: { en: "Logo" } },
      { fallbackLanguage: "en" },
    );
    await tx.insert(tenantReceipts).values({ receipt: { logo: image.filename } });
    await tx.insert(departmentReceipts).values([
      { departmentId: rows[0]!.id, receipt: { logo: image.filename } },
      { departmentId: rows[1]!.id, receipt: { logo: image.filename } },
      { departmentId: rows[2]!.id, receipt: {} },
    ]);
    const departmentUses = [
      { kind: "department_receipt", id: rows[1]!.id, name: "Bar", active: false },
      { kind: "department_receipt", id: rows[0]!.id, name: "Dining", active: true },
    ];
    const uses = [{ kind: "receipt" }, ...departmentUses];
    expect(await listImageUsages(tx, image.id)).toEqual(uses);
    expect((await readImage(tx, image.id)).usageCount).toBe(3);
    for (const sort of ["date", "name"] as const) {
      expect((await listImages(tx, { sort })).images).toEqual([
        expect.objectContaining({ id: image.id, usageCount: 3 }),
      ]);
    }
    expect(await deleteImage(tx, image.id)).toEqual({ deleted: false, uses });
    await tx
      .update(departmentReceipts)
      .set({ receipt: {} })
      .where(eq(departmentReceipts.departmentId, rows[0]!.id));
    expect((await listImages(tx, {})).images[0]!.usageCount).toBe(2);
    expect(await deleteImage(tx, image.id)).toEqual({
      deleted: false,
      uses: [{ kind: "receipt" }, departmentUses[0]],
    });
    await tx.update(tenantReceipts).set({ receipt: {} });
    expect(await deleteImage(tx, image.id)).toEqual({ deleted: false, uses: [departmentUses[0]] });
    expect((await readImage(tx, image.id)).usageCount).toBe(1);
    await tx
      .update(departmentReceipts)
      .set({ receipt: {} })
      .where(eq(departmentReceipts.departmentId, rows[1]!.id));
    expect((await listImages(tx, {})).images[0]!.usageCount).toBe(0);
    expect(await deleteImage(tx, image.id)).toEqual({ deleted: true, uses: [] });
  });
});

it.each(["{", "null", "[]", "123", '{"logo":null}', '{"logo":[]}', '{"logo":{}}'])(
  "ignores malformed imported department receipt %s beside a valid explicit use",
  async (bad) => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const [place] = await tx
        .insert(locations)
        .values({
          name: "Restaurant",
          invoiceLocales: ["es-ES"],
          operationDescription: "Hospitality",
        })
        .returning();
      const [good, broken] = await tx
        .insert(departments)
        .values([
          { locationId: place!.id, name: "Dining", tradingName: "Dining" },
          { locationId: place!.id, name: "Bar", tradingName: "Bar" },
        ])
        .returning();
      const { image } = await uploadImage(
        tx,
        { image: photo, names: { en: "Logo" } },
        { fallbackLanguage: "en" },
      );
      await tx
        .insert(departmentReceipts)
        .values({ departmentId: good!.id, receipt: { logo: image.filename } });
      await tx.execute(
        sql`insert into department_receipts (department_id, receipt, updated_at) values (${broken!.id}, ${bad}, '2026-10-10T00:00:00Z')`,
      );
      const uses = [{ kind: "department_receipt", id: good!.id, name: "Dining", active: true }];
      expect(await listImageUsages(tx, image.id)).toEqual(uses);
      expect((await listImages(tx, { sort: "date" })).images[0]!.usageCount).toBe(1);
      expect((await listImages(tx, { sort: "name" })).images[0]!.usageCount).toBe(1);
      expect(await deleteImage(tx, image.id)).toEqual({ deleted: false, uses });
    });
  },
);
