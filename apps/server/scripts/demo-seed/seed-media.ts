// `seedMedia` — the demo-seed's media step (Phase 2, Task 9). Task 6's `seedCatalogues` stores the
// PLAIN image basename (e.g. `"jamon-iberico.png"`) in each product's `image`; this step reads the
// committed per-dish PNG tile for that basename, content-addresses it into the venue's media dir
// under its SHA-256, and rewrites `products.image` to the served `<sha256hex>.png` name — the exact
// shape the public `GET /media/:filename` route serves (`MEDIA_FILENAME` in `src/media-api.ts`,
// `^[0-9a-f]{64}\.(jpg|png|webp)$`). After this, the till/dashboard `<img src="/media/<image>">`
// resolves to a real file on disk.
//
// The committed tiles under `media/` are the source of truth (authored by `gen-media.mjs`, a
// zero-dependency built-ins-only PNG generator — a dev convenience, not run here). This module only
// COPIES their bytes; it never rasterises anything.
//
// It runs inside the CALLER's transaction, under the tenant GUC the caller set with `withTenant` +
// `asAppUser`, so the `products` UPDATE adopts the current tenant and satisfies the FORCE-RLS
// `USING/WITH CHECK (tenant_id = current_tenant_id())`. The UPDATE is parameterised via Drizzle's
// `sql` template (CLAUDE.md §3) — never string-concatenated.
//
// `mediaDir` is PASSED IN (Task 11 resolves the real one from boot's `DEFAULT_MEDIA_ROOT`); this
// module does NOT import boot, so it stays a pure seed helper testable against a temp dir.

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
