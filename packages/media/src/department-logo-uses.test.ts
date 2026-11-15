import { expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue, seedDepartmentReceipt } from "@waitron/db/testing/seed.js";
import { createDepartment, deleteDepartment, departments } from "@waitron/venue-service";
import { deleteImage, listImages, listImageUsages, readImage, uploadImage } from "./images.js";
import { samplePreparedImage } from "./testing/sample-image.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
});
const photo = await samplePreparedImage({ width: 19 });

it("counts only department logos and protects each until cleared despite retired venue values", async () => {
  await withTransaction(suite.db, async (tx) => {
    await seedVenue(tx, {
      name: "Dining room",
      invoiceLocales: ["es-ES"],
      operationDescription: "Hospitality",
    });
    const rows = await tx
      .insert(departments)
      .values([
        { name: "Dining", tradingName: "Room" },
        { name: "Bar", tradingName: "Counter", active: false },
        { name: "Garden", tradingName: "Terrace" },
        { name: "Events", tradingName: "Events" },
      ])
      .returning();
    const { image } = await uploadImage(
      tx,
      { image: photo, names: { en: "Logo" } },
      { fallbackLanguage: "en" },
    );

    await seedDepartmentReceipt(tx, rows[0]!.id, { logo: image.filename });
    await seedDepartmentReceipt(tx, rows[1]!.id, { logo: image.filename });
    await seedDepartmentReceipt(tx, rows[2]!.id, {});
    const departmentUses = [
      { kind: "department_receipt", id: rows[1]!.id, name: "Bar", active: false },
      { kind: "department_receipt", id: rows[0]!.id, name: "Dining", active: true },
    ];
    const uses = departmentUses;
    expect(await listImageUsages(tx, image.id)).toEqual(uses);
    expect((await readImage(tx, image.id)).usageCount).toBe(2);
    for (const sort of ["date", "name"] as const) {
      expect((await listImages(tx, { sort })).images).toEqual([
        expect.objectContaining({ id: image.id, usageCount: 2 }),
      ]);
    }
    expect(await deleteImage(tx, image.id)).toEqual({ deleted: false, uses });
    await tx
      .update(departments)
      .set({ receiptLogoImageId: null, receiptText: {} })
      .where(eq(departments.id, rows[0]!.id));
    expect((await listImages(tx, {})).images[0]!.usageCount).toBe(1);
    expect(await deleteImage(tx, image.id)).toEqual({
      deleted: false,
      uses: [departmentUses[0]],
    });

    expect(await deleteImage(tx, image.id)).toEqual({ deleted: false, uses: [departmentUses[0]] });
    expect((await readImage(tx, image.id)).usageCount).toBe(1);
    await tx
      .update(departments)
      .set({ receiptLogoImageId: null, receiptText: {} })
      .where(eq(departments.id, rows[1]!.id));
    expect((await listImages(tx, {})).images[0]!.usageCount).toBe(0);
    expect(await deleteImage(tx, image.id)).toEqual({ deleted: true, uses: [] });
  });
});

it.each(["{", "null", "[]", "123", '{"logo":null}', '{"logo":[]}', '{"logo":{}}'])(
  "ignores malformed imported department receipt %s beside a valid explicit use",
  async (bad) => {
    await withTransaction(suite.db, async (tx) => {
      await seedVenue(tx, {
        name: "Restaurant",
        invoiceLocales: ["es-ES"],
        operationDescription: "Hospitality",
      });
      const [good, broken] = await tx
        .insert(departments)
        .values([
          { name: "Dining", tradingName: "Dining" },
          { name: "Bar", tradingName: "Bar" },
        ])
        .returning();
      const { image } = await uploadImage(
        tx,
        { image: photo, names: { en: "Logo" } },
        { fallbackLanguage: "en" },
      );
      await seedDepartmentReceipt(tx, good!.id, { logo: image.filename });
      await tx.execute(
        sql`update departments set receipt_text = ${bad}, receipt_updated_at = '2026-10-10T00:00:00Z' where id = ${broken!.id}`,
      );
      const uses = [{ kind: "department_receipt", id: good!.id, name: "Dining", active: true }];
      expect(await listImageUsages(tx, image.id)).toEqual(uses);
      expect((await listImages(tx, { sort: "date" })).images[0]!.usageCount).toBe(1);
      expect((await listImages(tx, { sort: "name" })).images[0]!.usageCount).toBe(1);
      expect(await deleteImage(tx, image.id)).toEqual({ deleted: false, uses });
    });
  },
);

it("protects a deleted department's retained receipt logo after its name is reused", async () => {
  await withTransaction(suite.db, async (tx) => {
    await seedVenue(tx, {
      name: "Restaurant",
      invoiceLocales: ["es-ES"],
      operationDescription: "Hospitality",
    });
    await createDepartment(tx, { name: "Survivor" });
    const old = await createDepartment(tx, { name: "Dining" });
    const { image } = await uploadImage(
      tx,
      { image: photo, names: { en: "Retained logo" } },
      { fallbackLanguage: "en" },
    );
    await seedDepartmentReceipt(tx, old.id, { logo: image.filename });
    await deleteDepartment(
      tx,
      {
        removeSets: async () => {},
        readImpact: async () => ({ refusals: [], removes: [] }),
        clear: async () => {},
      },
      old.id,
      new Date("2026-10-11T12:00:00Z"),
    );
    await createDepartment(tx, { name: "Dining" });
    const uses = [{ kind: "department_receipt", id: old.id, name: "Dining", active: false }];
    expect(await listImageUsages(tx, image.id)).toEqual(uses);
    expect((await readImage(tx, image.id)).usageCount).toBe(1);
    for (const sort of ["date", "name"] as const)
      expect((await listImages(tx, { sort })).images[0]!.usageCount).toBe(1);
    expect(await deleteImage(tx, image.id)).toEqual({ deleted: false, uses });
    expect(await tx.select().from(departments).where(eq(departments.id, old.id))).toEqual([
      expect.objectContaining({ id: old.id, receiptLogoImageId: image.id, receiptText: {} }),
    ]);
  });
});
