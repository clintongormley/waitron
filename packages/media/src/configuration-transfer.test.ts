import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { validateMediaConfiguration } from "./configuration-transfer.js";
const bytes = Buffer.from([0xff, 0xd8, 0xff, 1]);
function tables() {
  return {
    content_languages: [{ default_language: "en", languages: ["en", "fr"] }],
    media_images: [
      {
        id: "image-a",
        filename: `${createHash("sha256").update(bytes).digest("hex")}.jpg`,
        names: { en: "Bread" },
        alt_text: { en: "Loaf" },
        labels: ["Food"],
      },
    ],
    media_image_data: [{ image_id: "image-a", bytes: `\\x${bytes.toString("hex")}` }],
  };
}
/**
 * The shape a bundle really carries.
 *
 * `tables()` above stays readable — the metadata as objects — and this renders it the way
 * `exportConfigurationTables` does: `names`, `alt_text` and `labels` are one TEXT column holding
 * JSON (`packages/db/src/schema/columns.ts`), the export takes a raw `select *`, and nothing parses
 * them on the way into the bundle. A fixture in the object shape describes a bundle no venue
 * produces, which is what this one did until the database path was run end to end and refused with
 * `image.invalid_metadata`.
 */
function wire(input: ReturnType<typeof tables>) {
  return {
    ...input,
    media_images: input.media_images.map((image) => ({
      ...image,
      names: JSON.stringify(image.names),
      alt_text: JSON.stringify(image.alt_text),
      labels: JSON.stringify(image.labels),
    })),
  };
}

it("accepts the database bytea wire format with one matching metadata row", () => {
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
it.each([
  "mismatch",
  "missing",
  "extra",
  "duplicate",
  "type",
  "hex",
  "oversize",
  "name",
  "alt",
  "labels",
])("refuses corrupt image data: %s", (kind) => {
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
  if (kind === "alt") input.media_images[0]!.alt_text.en = " ";
  if (kind === "labels") input.media_images[0]!.labels = ["Food", "food"];
  expect(() => validateMediaConfiguration(wire(input))).toThrow();
});

const otherBytes = Buffer.from([0xff, 0xd8, 0xff, 2]);
/** `tables()` plus a second, equally valid image, so a refusal can come from two rows together. */
function twoImages(secondLabels: string[] = ["Drink"]) {
  const input = tables();
  input.media_images.push({
    id: "image-b",
    filename: `${createHash("sha256").update(otherBytes).digest("hex")}.jpg`,
    names: { en: "Juice" },
    alt_text: { en: "A glass" },
    labels: secondLabels,
  });
  input.media_image_data.push({ image_id: "image-b", bytes: `\\x${otherBytes.toString("hex")}` });
  return input;
}
const refused = expect.objectContaining({ code: "image.invalid_metadata" });

it("accepts two valid images whose labels differ", () => {
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

it("refuses two images spelling one label with different case", () => {
  expect(() => validateMediaConfiguration(wire(twoImages(["food"])))).toThrow(refused);
});

it.each([
  ["no content-language row", []],
  ["a default language that is not a string", [{ default_language: 42, languages: ["en"] }]],
])("refuses a bundle with images and %s", (_case, rows) => {
  const input = { ...wire(tables()), content_languages: rows };
  expect(() => validateMediaConfiguration(input)).toThrow(refused);
});
