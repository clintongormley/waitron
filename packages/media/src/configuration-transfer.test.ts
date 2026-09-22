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
