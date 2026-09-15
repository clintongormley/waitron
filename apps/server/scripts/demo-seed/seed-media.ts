import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { uploadImage } from "@waitron/media";
import { customerPresentationText, readContentLanguages } from "@waitron/catalogue";
import { FALLBACK_LOCALE } from "@waitron/shared";

/** The installed image supplies a copied asset directory; source/dev falls back beside this module. */
const SRC_DIR =
  process.env.WAITRON_DEMO_MEDIA_SOURCE || fileURLToPath(new URL("media", import.meta.url));

export interface SeedMediaInput {
  tenantId: string;
  /** Committed image basename → product id, from seedCatalogues. */
  productsByImage: Map<string, string>;
}

/** Store committed dish tiles and attach their references inside the caller's transaction. */
export async function seedMedia(
  tx: Transaction,
  { tenantId, productsByImage }: SeedMediaInput,
): Promise<void> {
  // The image library names a photo per language, so a product's customer-facing name is what a tile
  // is named by — falling back to the staff name in the venue's default content language, which is
  // the one `uploadImage` requires an entry for.
  const { defaultLanguage } = await readContentLanguages(tx, tenantId, FALLBACK_LOCALE);
  for (const [imageBasename, productId] of productsByImage) {
    const { rows } = await tx.execute<{
      name: string;
      customer_name: Record<string, string> | null;
    }>(sql`select name, customer_name from products where id = ${productId}`);
    const product = rows[0];
    if (product === undefined)
      throw new Error("demo-seed: image product does not belong to this venue");
    const names = customerPresentationText(
      {
        name: product.name,
        customerName: product.customer_name,
        kitchenName: null,
        variantName: null,
        variantCustomerName: null,
        variantKitchenName: null,
      },
      defaultLanguage,
    ).product;
    const bytes = await readFile(join(SRC_DIR, imageBasename));
    const { image } = await uploadImage(
      tx,
      tenantId,
      { bytes, names, altText: names, labels: [] },
      { maxUploadBytes: 5 * 1024 * 1024 },
    );
    await tx.execute(sql`update products set image = ${image.filename} where id = ${productId}`);
  }
}
