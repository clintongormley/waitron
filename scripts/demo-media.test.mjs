import { createRequire } from "node:module";
import { resolve } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { DEMO_DATA_SETS, DEMO_MEDIA_ROOTS } from "../packages/country-packs/src/demo.ts";

const sharp = createRequire(resolve("apps/server/package.json"))("sharp");

it.each(Object.values(DEMO_DATA_SETS))(
  "$id ships product images with more than two colours",
  async ({ mediaDataSet, menus }) => {
    const images = new Set(
      [menus.restaurant, menus.deli, menus.lunch].flatMap((menu) =>
        menu.categories.flatMap((category) => category.products.map((product) => product.image)),
      ),
    );
    const placeholders = [];
    for (const image of images) {
      const path = fileURLToPath(new URL(image, DEMO_MEDIA_ROOTS[mediaDataSet]));
      // Nearest-neighbour sampling preserves the two colours of the placeholder tiles.
      const pixels = await sharp(path)
        .resize(32, 32, { kernel: "nearest" })
        .toColourspace("srgb")
        .removeAlpha()
        .raw()
        .toBuffer();
      const colours = new Set();
      for (let offset = 0; offset < pixels.length; offset += 3) {
        colours.add(pixels.readUIntBE(offset, 3));
      }
      if (colours.size <= 2) placeholders.push(image);
    }
    expect(placeholders).toEqual([]);
  },
);
