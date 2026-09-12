import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { uploadImage } from "@waitron/media";

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
  for (const [imageBasename, productId] of productsByImage) {
    const { rows } = await tx.execute<{ descriptions: Record<string, string> }>(sql`
      select descriptions from products where tenant_id = ${tenantId} and id = ${productId}
    `);
    const product = rows[0];
    if (product === undefined)
      throw new Error("demo-seed: image product does not belong to this venue");
    const bytes = await readFile(join(SRC_DIR, imageBasename));
    const { image } = await uploadImage(
      tx,
      tenantId,
      {
        bytes,
        names: product.descriptions,
        altText: product.descriptions,
        labels: [],
      },
      { maxUploadBytes: 5 * 1024 * 1024 },
    );
    await tx.execute(
      sql`update products set image = ${image.filename} where tenant_id = ${tenantId} and id = ${productId}`,
    );
  }
}
