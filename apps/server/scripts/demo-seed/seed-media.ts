import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { DEMO_MEDIA_ROOTS } from "@waitron/country-packs/demo";
import { eq } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import { DEFAULT_MAX_UPLOAD_BYTES, prepareImage, uploadImage } from "@waitron/media";
import { customerPresentationText, readContentLanguages } from "@waitron/catalogue";
import { FALLBACK_LOCALE } from "@waitron/shared";

export function demoMediaPath(
  mediaDataSet: string,
  basename: string,
  installedRoot: string | undefined,
): string {
  if (!Object.hasOwn(DEMO_MEDIA_ROOTS, mediaDataSet))
    throw new Error(`demo-seed: unregistered media dataset ${mediaDataSet}`);
  if (basename === "" || basename === "." || basename === ".." || /[/\\]/.test(basename))
    throw new Error("demo-seed: expected image basename");
  const source = installedRoot
    ? join(installedRoot, mediaDataSet)
    : fileURLToPath(DEMO_MEDIA_ROOTS[mediaDataSet]!);
  return join(source, basename);
}

export interface SeedMediaInput {
  mediaDataSet: string;
  /** Committed image basename → product id, from seedCatalogues. */
  productsByImage: Map<string, string>;
}

/** Store committed dish tiles and attach their references inside the caller's transaction. */
export async function seedMedia(
  tx: Transaction,
  { productsByImage, mediaDataSet }: SeedMediaInput,
): Promise<void> {
  // The image library names a photo per language, so a product's customer-facing name is what a tile
  // is named by — falling back to the staff name in the venue's default content language, which is
  // the one `uploadImage` requires an entry for.
  const { defaultLanguage } = await readContentLanguages(tx, FALLBACK_LOCALE);
  for (const [imageBasename, productId] of productsByImage) {
    // Read through the table definition: `customer_name` is a JSON column, and a raw read hands
    // back the stored TEXT, which `customerPresentationText` then treats as a whole name.
    const rows = await tx
      .select({ name: products.name, customerName: products.customerName })
      .from(products)
      .where(eq(products.id, productId));
    const product = rows[0];
    if (product === undefined) throw new Error("demo-seed: image product does not exist");
    const names = customerPresentationText(
      {
        name: product.name,
        customerName: product.customerName,
        kitchenName: null,
        variantName: null,
        variantCustomerName: null,
        variantKitchenName: null,
      },
      defaultLanguage,
    ).product;
    const bytes = await readFile(
      demoMediaPath(mediaDataSet, imageBasename, process.env.WAITRON_DEMO_MEDIA_SOURCE),
    );
    // Inside the caller's transaction, unlike the upload route: seeding runs before the venue sells.
    const image = await prepareImage(bytes, { maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES });
    const { image: stored } = await uploadImage(tx, { image, names });
    await tx.update(products).set({ image: stored.filename }).where(eq(products.id, productId));
  }
}
