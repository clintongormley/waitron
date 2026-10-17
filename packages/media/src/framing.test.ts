import { describe, expect, it } from "vitest";
import { cropRect, DEFAULT_FRAMING, rasterCrop, validateFraming } from "./framing.js";

describe("photo framing", () => {
  it("resets to a centred crop without zoom", () => {
    expect(cropRect(1200, 800, 1, DEFAULT_FRAMING)).toEqual({
      left: 200,
      top: 0,
      width: 800,
      height: 800,
    });
    const till = cropRect(1200, 800, 4 / 3, DEFAULT_FRAMING);
    expect(till.left).toBeCloseTo(66.6666666667, 9);
    expect(till.width).toBeCloseTo(1066.6666666667, 9);
    expect([till.top, till.height]).toEqual([0, 800]);
    expect(cropRect(600, 900, 1, DEFAULT_FRAMING)).toEqual({
      left: 0,
      top: 150,
      width: 600,
      height: 600,
    });
  });

  it.each([
    { frame: { x: 0, y: 0, zoom: 100 }, want: { left: 0, top: 0, width: 600, height: 600 } },
    {
      frame: { x: 10000, y: 10000, zoom: 100 },
      want: { left: 0, top: 300, width: 600, height: 600 },
    },
    {
      frame: { x: 5000, y: 5000, zoom: 400 },
      want: { left: 225, top: 375, width: 150, height: 150 },
    },
    {
      frame: { x: 10000, y: 10000, zoom: 400 },
      want: { left: 450, top: 750, width: 150, height: 150 },
    },
  ])("keeps a portrait crop in bounds at $frame", ({ frame, want }) => {
    expect(cropRect(600, 900, 1, frame)).toEqual(want);
  });

  it("preserves the source aspect for a full display crop", () => {
    expect(cropRect(1200, 800, 1.5, DEFAULT_FRAMING)).toEqual({
      left: 0,
      top: 0,
      width: 1200,
      height: 800,
    });
    expect(cropRect(1200, 800, 1.5, { x: 10000, y: 0, zoom: 400 })).toEqual({
      left: 900,
      top: 0,
      width: 300,
      height: 200,
    });
  });

  it.each([
    {
      width: 7,
      height: 11,
      ratio: 1,
      frame: { x: 5000, y: 5000, zoom: 400 },
      want: { left: 2, top: 4, width: 3, height: 3 },
    },
    {
      width: 11,
      height: 7,
      ratio: 4 / 3,
      frame: { x: 10000, y: 10000, zoom: 400 },
      want: { left: 8, top: 5, width: 3, height: 2 },
    },
    {
      width: 1,
      height: 1,
      ratio: 4 / 3,
      frame: { x: 5000, y: 5000, zoom: 400 },
      want: { left: 0, top: 0, width: 1, height: 1 },
    },
    {
      width: 1,
      height: 13,
      ratio: 1,
      frame: { x: 10000, y: 10000, zoom: 400 },
      want: { left: 0, top: 12, width: 1, height: 1 },
    },
  ])(
    "rounds outward for $width × $height without losing the focal area",
    ({ width, height, ratio, frame, want }) => {
      const continuous = cropRect(width, height, ratio, frame);
      const raster = rasterCrop(width, height, ratio, frame);
      expect(raster).toEqual(want);
      expect(continuous.left - raster.left).toBeGreaterThanOrEqual(0);
      expect(continuous.left - raster.left).toBeLessThan(1);
      expect(continuous.top - raster.top).toBeGreaterThanOrEqual(0);
      expect(continuous.top - raster.top).toBeLessThan(1);
      expect(raster.left + raster.width).toBeGreaterThanOrEqual(continuous.left + continuous.width);
      expect(raster.left + raster.width - continuous.left - continuous.width).toBeLessThan(1);
      expect(raster.top + raster.height).toBeGreaterThanOrEqual(continuous.top + continuous.height);
      expect(raster.top + raster.height - continuous.top - continuous.height).toBeLessThan(1);
    },
  );

  it.each([
    { x: 0, y: 10000, zoom: 100 },
    { x: 10000, y: 0, zoom: 400 },
    { x: 4321, y: 8765, zoom: 237 },
  ])("accepts integral framing $x/$y/$zoom", (input) => {
    expect(validateFraming(input)).toEqual(input);
  });

  it.each([
    null,
    undefined,
    [],
    [5000, 5000, 100],
    "centre",
    100,
    true,
    {},
    { x: 5000, y: 5000 },
    { x: 5000, y: 5000, zoom: 100, extra: 1 },
    ...["x", "y", "zoom"].flatMap((field) =>
      [null, undefined, "100", 1.5, NaN, Infinity, -Infinity].map((value) => ({
        x: 5000,
        y: 5000,
        zoom: 100,
        [field]: value,
      })),
    ),
    { x: -1, y: 5000, zoom: 100 },
    { x: 10001, y: 5000, zoom: 100 },
    { x: 5000, y: -1, zoom: 100 },
    { x: 5000, y: 10001, zoom: 100 },
    { x: 5000, y: 5000, zoom: 99 },
    { x: 5000, y: 5000, zoom: 401 },
  ])("refuses malformed framing %#", (input) => {
    expect(() => validateFraming(input)).toThrow(
      expect.objectContaining({
        code: "image.invalid_framing",
        params: { field: "framing" },
      }),
    );
  });
});
