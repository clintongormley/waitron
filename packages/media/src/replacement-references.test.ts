import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, products, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  activateDueMenuPublications,
  addMember,
  CATALOGUE_MIGRATIONS,
  createCatalogue,
  createProduct,
  menuDocumentHash,
  menuPublications,
  menuScheduledPublications,
  menuVersionImages,
  menuVersions,
  previewMenu,
  publishMenu,
  queueMenuPublication,
  readMenuStructure,
  sectionMembers,
  sections,
  updateProduct,
} from "@waitron/catalogue";
import { departmentReceipts, departments, VENUE_SERVICE_MIGRATIONS } from "@waitron/venue-service";
import { saveImage, readCurrentImage } from "./image-edits.js";
import { deleteImage, listImageUsages, readImage, readImageBytes, uploadImage } from "./images.js";
import { MEDIA_MIGRATIONS } from "./migrations.js";
import { samplePreparedImage } from "./testing/sample-image.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS, MEDIA_MIGRATIONS],
});
const original = await samplePreparedImage({ width: 27 });
const replacement = await samplePreparedImage({ width: 51 });

it("changes presentation without rewriting product, variant, section, folder, receipt or frozen menu references", async () => {
  await seedTenant(suite.db);
  const at = new Date("2026-10-17T10:00:00Z");
  const due = new Date("2026-10-17T11:00:00Z");
  const image = await withTransaction(suite.db, async (tx) => {
    const { image } = await uploadImage(
      tx,
      { image: original, names: { en: "Dish", es: "Plato" } },
      { fallbackLanguage: "en" },
    );
    const menu = await createCatalogue(tx, { name: "Lunch" });
    const included = await createCatalogue(tx, { name: "Drinks", image: image.filename });
    const product = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Staff dish",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
      image: image.filename,
    });
    await tx.insert(products).values({
      catalogueId: menu.id,
      parentId: product.id,
      name: "Large",
      pricingUnit: "each",
      unitPrice: 300,
      vatClass: "general",
      image: image.filename,
    });
    const root = (await readMenuStructure(tx, menu.id)).rootSectionId;
    const includedRoot = (await readMenuStructure(tx, included.id)).rootSectionId;
    await addMember(tx, root, { kind: "product", productId: product.id });
    await tx.insert(sectionMembers).values({
      sectionId: root,
      childSectionId: includedRoot,
      position: 1,
      showAsFolder: true,
      folderOverrides: { image: image.filename },
    });
    await publishMenu(tx, menu.id, (await previewMenu(tx, menu.id)).hash, "manager");
    await updateProduct(tx, product.id, {
      customerName: { en: "Queued dish", es: "Plato programado" },
    });
    await queueMenuPublication(tx, menu.id, (await previewMenu(tx, menu.id)).hash, due, "manager", {
      at,
    });
    const [place] = await tx
      .insert(locations)
      .values({
        name: "Restaurant",
        invoiceLocales: ["es-ES"],
        operationDescription: "Hospitality",
      })
      .returning();
    for (const active of [true, false]) {
      const [department] = await tx
        .insert(departments)
        .values({
          locationId: place!.id,
          name: active ? "Dining" : "Closed",
          tradingName: "Room",
          active,
        })
        .returning();
      await tx
        .insert(departmentReceipts)
        .values({ departmentId: department!.id, receipt: { logo: image.filename } });
    }
    return image;
  });
  const uses = await listImageUsages(suite.db, image.id);
  expect(uses.map((use) => use.kind).sort()).toEqual([
    "department_receipt",
    "department_receipt",
    "menu_include",
    "menu_version",
    "product",
    "scheduled_menu_version",
    "section",
    "variant",
  ]);
  const snapshot = async () => ({
    products: await suite.db.select().from(products),
    sections: await suite.db.select().from(sections),
    members: await suite.db.select().from(sectionMembers),
    versions: await suite.db.select().from(menuVersions),
    images: await suite.db.select().from(menuVersionImages),
    live: await suite.db.select().from(menuPublications),
    queued: await suite.db.select().from(menuScheduledPublications),
    receipts: await suite.db
      .select({ id: departmentReceipts.departmentId, receipt: departmentReceipts.receipt })
      .from(departmentReceipts),
  });
  const before = await snapshot();
  const framing = { x: 9000, y: 1000, zoom: 250 };
  const saved = await withTransaction(suite.db, (tx) =>
    saveImage(
      tx,
      image.id,
      { names: image.names, framing, expectedRevision: 1 },
      replacement,
      {
        "58mm": { widthDots: 8, heightDots: 1, data: "gA==" },
        "80mm": { widthDots: 8, heightDots: 1, data: "QA==" },
      },
      "en",
    ),
  );
  expect(saved).toMatchObject({
    id: image.id,
    filename: original.filename,
    names: image.names,
    usageCount: 8,
    framing,
    revision: 2,
    sourceFilename: replacement.filename,
  });
  expect(await snapshot()).toEqual(before);
  expect(await listImageUsages(suite.db, image.id)).toEqual(uses);
  expect(await withTransaction(suite.db, (tx) => deleteImage(tx, image.id))).toEqual({
    deleted: false,
    uses,
  });
  for (const version of before.versions)
    expect(menuDocumentHash(version.document)).toBe(version.contentHash);
  const immutable = await readImageBytes(suite.db, original.filename);
  expect(immutable!.bytes).toEqual(original.bytes);
  expect(createHash("sha256").update(immutable!.bytes).digest("hex") + ".webp").toBe(
    original.filename,
  );
  await withTransaction(suite.db, (tx) => activateDueMenuPublications(tx, due));
  const [live] = await suite.db
    .select()
    .from(menuPublications)
    .where(eq(menuPublications.menuId, before.queued[0]!.menuId));
  expect(live!.versionId).toBe(before.queued[0]!.versionId);
  expect(await suite.db.select().from(menuVersions)).toEqual(before.versions);
  expect(await suite.db.select().from(menuVersionImages)).toEqual(before.images);
  expect(await readCurrentImage(suite.db, original.filename)).toEqual({
    imageId: image.id,
    revision: 2,
    sourceFilename: replacement.filename,
    framing,
    bytes: replacement.bytes,
  });
  expect((await readImage(suite.db, image.id)).usageCount).toBe(7);
});
