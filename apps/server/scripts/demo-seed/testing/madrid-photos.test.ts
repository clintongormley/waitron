import { expect, it } from "vitest";
import { madridWithPhotos } from "./madrid-photos.js";
import { stable, type CanonicalMadridSemantics } from "./madrid-semantics.js";

it("folds photo edits and deduplicates originals shared with replacement bytes without changing the capture", () => {
  const table = (rows: Record<string, Record<string, unknown>>) => ({
    columns: [],
    foreignKeys: [],
    rows,
  });
  const capture: CanonicalMadridSemantics = {
    tables: {
      media_images: table({
        a: { id: "a", filename: "abc.webp" },
        b: { id: "b", filename: "def.jpg" },
      }),
      media_image_data: table({
        a: { image_id: "a", bytes: "sha256:abc" },
        b: { image_id: "b", bytes: "sha256:def" },
      }),
      media_image_blobs: table({ source: { hash: "abc", bytes: "sha256:abc" } }),
      media_image_edits: table({
        b: {
          image_id: "b",
          source_hash: "abc",
          focus_x: 2000,
          focus_y: 7000,
          zoom: 150,
          revision: 2,
          original_filename: "bread.jpg",
        },
      }),
    },
  };
  const result = madridWithPhotos(capture);
  expect(result.tables.media_images!.rows).toEqual({
    a: {
      id: "a",
      filename: "abc.webp",
      original_hash: "abc",
      source_hash: null,
      focus_x: 5000,
      focus_y: 5000,
      zoom: 100,
      revision: 1,
      original_filename: null,
    },
    b: {
      id: "b",
      filename: "def.jpg",
      original_hash: "def",
      source_hash: "abc",
      focus_x: 2000,
      focus_y: 7000,
      zoom: 150,
      revision: 2,
      original_filename: "bread.jpg",
    },
  });
  expect(Object.values(result.tables.media_blobs!.rows)).toEqual(
    [
      { hash: "abc", format: "webp", bytes: "sha256:abc" },
      { hash: "def", format: "jpg", bytes: "sha256:def" },
    ].sort((a, b) => stable(a).localeCompare(stable(b))),
  );
  expect(Object.keys(result.tables).sort()).toEqual(["media_blobs", "media_images"]);
  expect(capture.tables.media_images!.rows.a).toEqual({ id: "a", filename: "abc.webp" });
});
