// Copy committed product image tiles into the venue media directory under their
// content hashes and update product image names in the caller's transaction.
// The caller supplies mediaDir; the helper does not generate images.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";

/** The committed source tiles live beside this module, in `demo-seed/media/`. */
const SRC_DIR = fileURLToPath(new URL("media", import.meta.url));

export interface SeedMediaInput {
  /** Absolute directory the served media files are written into — Task 11 passes boot's
   * `config.mediaDir` so the running dev server serves exactly what the seed wrote. Created if absent. */
  mediaDir: string;
  /** image basename → product id, from `seedCatalogues`. Each product's `image` currently holds the
   * plain basename; this step replaces it with the content-addressed served name. */
  productsByImage: Map<string, string>;
}

/**
 * Copy each seeded product's committed placeholder tile into `mediaDir` under its content hash and
 * rewrite `products.image` to the served `<sha256hex>.png` name. Idempotent on the filesystem side (a
 * content-addressed name is stable, so re-running rewrites the same bytes to the same path), and
 * order-independent (each product is handled on its own row).
 */
export async function seedMedia(
  tx: Transaction,
  { mediaDir, productsByImage }: SeedMediaInput,
): Promise<void> {
  await mkdir(mediaDir, { recursive: true });

  for (const [imageBasename, productId] of productsByImage) {
    const bytes = await readFile(join(SRC_DIR, imageBasename));
    const hashedName = `${createHash("sha256").update(bytes).digest("hex")}.png`;
    await writeFile(join(mediaDir, hashedName), bytes);
    await tx.execute(sql`update products set image = ${hashedName} where id = ${productId}`);
  }
}
