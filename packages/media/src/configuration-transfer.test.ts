import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { validateMediaConfiguration } from "./configuration-transfer.js";
const bytes = Buffer.from([0xff, 0xd8, 0xff, 1]);
function tables() {
  return {
    content_languages: [{ tenant_id: "tenant-a", default_language: "en", languages: ["en", "fr"] }],
    media_images: [
      {
        id: "image-a",
        tenant_id: "tenant-a",
        filename: `${createHash("sha256").update(bytes).digest("hex")}.jpg`,
        names: { en: "Bread" },
        alt_text: { en: "Loaf" },
        labels: ["Food"],
      },
    ],
    media_image_data: [
      { tenant_id: "tenant-a", image_id: "image-a", bytes: `\\x${bytes.toString("hex")}` },
    ],
  };
}
it("accepts the database bytea wire format with one matching metadata row", () => {
  expect(() => validateMediaConfiguration(tables())).not.toThrow();
  expect(() => validateMediaConfiguration({})).not.toThrow();
});
it.each([
  "mismatch",
  "missing",
  "extra",
  "duplicate",
  "type",
  "hex",
  "oversize",
  "tenant",
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
  if (kind === "tenant") input.media_image_data[0]!.tenant_id = "tenant-b";
  if (kind === "name") input.media_images[0]!.names.en = " ";
  if (kind === "alt") input.media_images[0]!.alt_text.en = " ";
  if (kind === "labels") input.media_images[0]!.labels = ["Food", "food"];
  expect(() => validateMediaConfiguration(input)).toThrow();
});
