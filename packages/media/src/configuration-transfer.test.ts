import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { validateMediaConfiguration } from "./configuration-transfer.js";
import { samplePreparedImage } from "./testing/sample-image.js";
const bytes = Buffer.from([0xff, 0xd8, 0xff, 1]);
function tables() {
  return {
    content_languages: [{ default_language: "en", languages: ["en", "fr"] }],
    media_images: [
      {
        id: "image-a",
        filename: `${createHash("sha256").update(bytes).digest("hex")}.jpg`,
        names: { en: "Bread" },
      },
    ],
    media_image_data: [{ image_id: "image-a", bytes: `\\x${bytes.toString("hex")}` }],
  };
}
/**
 * The shape a bundle really carries.
 *
 * `tables()` above stays readable — the metadata as objects — and this renders it the way
 * `exportConfigurationTables` does: `names` is one TEXT column holding JSON
 * (`packages/db/src/schema/columns.ts`), the export takes a raw `select *`, and nothing parses it on
 * the way into the bundle. A fixture in the object shape describes a bundle no venue
 * produces.
 */
function wire(input: ReturnType<typeof tables>) {
  return {
    ...input,
    media_images: input.media_images.map((image) => ({
      ...image,
      names: JSON.stringify(image.names),
    })),
  };
}

it("accepts image data written as \\x-prefixed hex with one matching metadata row", () => {
  expect(() => validateMediaConfiguration(wire(tables()))).not.toThrow();
  expect(() => validateMediaConfiguration({})).not.toThrow();
});

it("refuses metadata that is not the JSON text a raw read hands back", () => {
  // The object shape, which is what a reader assumes and what the engine never answers.
  const asObjects = tables();
  expect(() => validateMediaConfiguration(asObjects)).toThrow();
  // And text that is not JSON at all.
  const broken = wire(tables());
  broken.media_images[0]!.names = "{not json";
  expect(() => validateMediaConfiguration(broken)).toThrow();
});
it.each(["mismatch", "missing", "extra", "duplicate", "type", "hex", "oversize", "name"])(
  "refuses corrupt image data: %s",
  (kind) => {
    const input = tables();
    if (kind === "mismatch") input.media_images[0]!.filename = "0".repeat(64) + ".jpg";
    if (kind === "missing") input.media_image_data = [];
    if (kind === "extra") input.media_images = [];
    if (kind === "duplicate") input.media_image_data.push({ ...input.media_image_data[0]! });
    if (kind === "type") input.media_image_data[0]!.bytes = "\\x010203";
    if (kind === "hex") input.media_image_data[0]!.bytes = "\\xz123";
    if (kind === "oversize")
      input.media_image_data[0]!.bytes = "\\x" + "00".repeat(5 * 1024 * 1024 + 1);
    if (kind === "name") input.media_images[0]!.names.en = " ";
    expect(() => validateMediaConfiguration(wire(input))).toThrow();
  },
);

const otherBytes = Buffer.from([0xff, 0xd8, 0xff, 2]);
/** `tables()` plus a second, equally valid image, so a refusal can come from two rows together. */
function twoImages() {
  const input = tables();
  input.media_images.push({
    id: "image-b",
    filename: `${createHash("sha256").update(otherBytes).digest("hex")}.jpg`,
    names: { en: "Juice" },
  });
  input.media_image_data.push({ image_id: "image-b", bytes: `\\x${otherBytes.toString("hex")}` });
  return input;
}
const refused = expect.objectContaining({ code: "image.invalid_metadata" });

it("accepts two valid images", () => {
  expect(() => validateMediaConfiguration(wire(twoImages()))).not.toThrow();
});

it("refuses a data row whose image_id is not a string", () => {
  const input = wire(tables());
  (input.media_image_data[0] as Record<string, unknown>).image_id = 42;
  expect(() => validateMediaConfiguration(input)).toThrow(refused);
});

it("refuses two data rows for one image even when the row counts agree", () => {
  const input = wire(twoImages());
  input.media_image_data[1]!.image_id = "image-a";
  expect(() => validateMediaConfiguration(input)).toThrow(refused);
});

it.each(["id", "filename"])("refuses an image whose %s is not a string", (column) => {
  const input = wire(tables());
  (input.media_images[0] as Record<string, unknown>)[column] = 42;
  expect(() => validateMediaConfiguration(input)).toThrow(refused);
});

it.each([
  ["no content-language row", []],
  ["a default language that is not a string", [{ default_language: 42, languages: ["en"] }]],
])("refuses a bundle with images and %s", (_case, rows) => {
  const input = { ...wire(tables()), content_languages: rows };
  expect(() => validateMediaConfiguration(input)).toThrow(refused);
});

it.each(["und", "not a tag"])(
  "refuses a bundle with images whose default language is %s, as not a language",
  (defaultLanguage) => {
    const input = {
      ...wire(tables()),
      content_languages: [{ default_language: defaultLanguage, languages: ["en"] }],
    };
    expect(() => validateMediaConfiguration(input)).toThrow(
      expect.objectContaining({ code: "content.language_invalid" }),
    );
  },
);

const replacement = await samplePreparedImage({ width: 31 });
function editedTables(): Record<string, Record<string, unknown>[]> {
  return {
    ...wire(twoImages()),
    media_image_blobs: [
      {
        hash: replacement.filename.slice(0, 64),
        bytes: `\\x${Buffer.from(replacement.bytes).toString("hex")}`,
      },
    ],
    media_image_edits: ["image-a", "image-b"].map((image_id) => ({
      image_id,
      source_hash: replacement.filename.slice(0, 64),
      focus_x: 1000,
      focus_y: 8000,
      zoom: 225,
      revision: 2,
      original_filename: "dish.webp",
    })),
  };
}

it("accepts two edits sharing one immutable blob and an original-source edit", () => {
  const input = editedTables();
  expect(() => validateMediaConfiguration(input)).not.toThrow();
  input.media_image_edits![0]!.source_hash = null;
  input.media_image_edits![0]!.original_filename = null;
  expect(() => validateMediaConfiguration(input)).not.toThrow();
});

it.each([
  "blob-key",
  "blob-hash",
  "blob-type",
  "blob-missing-bytes",
  "blob-hex",
  "blob-oversize",
  "duplicate-blob",
  "dangling-source",
  "dangling-image",
  "duplicate-edit",
  "focus-fraction",
  "focus-string",
  "focus-range",
  "zoom-range",
  "revision-zero",
  "revision-unsafe",
  "filename-type",
  "filename-control",
  "filename-long",
  "duplicate-image",
])("refuses edited configuration before writes: %s", (fault) => {
  const input = editedTables();
  const blob = input.media_image_blobs![0]!;
  const edit = input.media_image_edits![0]!;
  if (fault === "blob-key") blob.hash = "A".repeat(64);
  if (fault === "blob-hash") {
    blob.hash = "a".repeat(64);
    for (const row of input.media_image_edits!) row.source_hash = blob.hash;
  }
  if (fault === "blob-type") blob.bytes = "\\xffd8ff01";
  if (fault === "blob-missing-bytes") delete blob.bytes;
  if (fault === "blob-hex") blob.bytes = "\\xzz";
  if (fault === "blob-oversize") blob.bytes = "\\x" + "00".repeat(5 * 1024 * 1024 + 1);
  if (fault === "duplicate-blob") input.media_image_blobs!.push({ ...blob });
  if (fault === "dangling-source") edit.source_hash = "a".repeat(64);
  if (fault === "dangling-image") edit.image_id = "missing";
  if (fault === "duplicate-edit") input.media_image_edits!.push({ ...edit });
  if (fault === "focus-fraction") edit.focus_x = 0.5;
  if (fault === "focus-string") edit.focus_y = "5000";
  if (fault === "focus-range") edit.focus_x = 10001;
  if (fault === "zoom-range") edit.zoom = 99;
  if (fault === "revision-zero") edit.revision = 0;
  if (fault === "revision-unsafe") edit.revision = Number.MAX_SAFE_INTEGER + 1;
  if (fault === "filename-type") edit.original_filename = [];
  if (fault === "filename-control") edit.original_filename = "a\0b";
  if (fault === "filename-long") edit.original_filename = "a".repeat(256);
  if (fault === "duplicate-image") input.media_images!.push({ ...input.media_images![0]! });
  expect(() => validateMediaConfiguration(input)).toThrow(refused);
});
