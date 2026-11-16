import { seedPhotoMetadata } from "@waitron/db/testing/seed.js";
import { createHash } from "node:crypto";
import { type Database, type Transaction } from "@waitron/db";

/**
 * A media-library file name standing in for a test's made-up one: `"lemonade.jpg"` becomes the
 * SHA-256 of `lemonade` in hex plus `.jpg`, the shape `media_images` accepts, the same every time.
 */
export function libraryImageName(madeUp: string): string {
  const dot = madeUp.lastIndexOf(".");
  const label = madeUp.slice(0, dot);
  const extension = madeUp.slice(dot + 1);
  if (dot <= 0 || !["jpg", "png", "webp"].includes(extension)) {
    throw new Error(`not a test image name: ${madeUp}`);
  }
  return `${createHash("sha256").update(label).digest("hex")}.${extension}`;
}

/** Puts each made-up image in the media library, which a product, section or menu image must name. */
export async function seedLibraryImages(
  db: Database | Transaction,
  ...madeUp: string[]
): Promise<void> {
  for (const name of madeUp)
    await seedPhotoMetadata(db, { filename: libraryImageName(name), names: {} });
}
