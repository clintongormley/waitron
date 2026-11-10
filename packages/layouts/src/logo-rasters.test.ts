import { describe, expect, it } from "vitest";
import { encodeLogoRaster, readLogoRaster } from "./logo-rasters.js";

describe("logo rasters", () => {
  it("encodes a 1-bit raster as the store keeps it", () => {
    const bits = Uint8Array.of(0x80, 0x01);
    expect(encodeLogoRaster({ widthDots: 9, heightDots: 1, bits })).toEqual({
      widthDots: 9,
      heightDots: 1,
      data: "gAE=",
    });
  });
  it.each([null, "{"])("omits an absent or unreadable stored picture %j", (picture) => {
    expect(readLogoRaster(picture, "58mm")).toBeNull();
  });
  it("decodes the printable stored picture", () => {
    expect(readLogoRaster('{"widthDots":8,"heightDots":1,"data":"gA=="}', "58mm")).toEqual({
      widthDots: 8,
      heightDots: 1,
      bits: new Uint8Array([128]),
    });
  });
  const picture = { widthDots: 8, heightDots: 1, data: "gA==" };
  it.each([
    ["non-object", 7],
    ["array", [picture]],
    ["missing width", { heightDots: 1, data: "gA==" }],
    ["width too wide", { ...picture, widthDots: 361 }],
    ["height too high", { ...picture, heightDots: 161 }],
    ["zero width", { ...picture, widthDots: 0 }],
    ["negative height", { ...picture, heightDots: -1 }],
    ["fractional width", { ...picture, widthDots: 7.5 }],
    ["text width", { ...picture, widthDots: "8" }],
    ["non-text data", { ...picture, data: [0] }],
    ["short data", { widthDots: 16, heightDots: 2, data: "AAAA" }],
    ["long data", { ...picture, data: "AAA=" }],
    ["non-base64 data", { ...picture, data: "!!!!" }],
    ["oversized data", { ...picture, data: "A".repeat(10_000_000) }],
  ])("omits a corrupt stored picture: %s", (_, input) => {
    expect(readLogoRaster(JSON.stringify(input), "58mm")).toBeNull();
  });
});
