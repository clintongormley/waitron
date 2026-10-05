import { describe, expect, it } from "vitest";
import { LOGO_MAX_HEIGHT_DOTS, ditherToRaster, type MonoRaster } from "./dither.js";

function flat(width: number, height: number, value: number): Uint8Array {
  return new Uint8Array(width * height).fill(value);
}

function dotAt(raster: MonoRaster, x: number, y: number): boolean {
  const stride = Math.ceil(raster.widthDots / 8);
  return (raster.bits[y * stride + (x >> 3)]! & (0x80 >> (x & 7))) !== 0;
}

function dotsIn(raster: MonoRaster, x0: number, y0: number, x1: number, y1: number): number {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (dotAt(raster, x, y)) n++;
  return n;
}

describe("ditherToRaster", () => {
  it("bounds a logo at 160 dots high", () => {
    expect(LOGO_MAX_HEIGHT_DOTS).toBe(160);
  });

  it("prints no dot for an all-white picture, sized exactly with each row padded to whole bytes", () => {
    const raster = ditherToRaster({ width: 10, height: 3, pixels: flat(10, 3, 255) });
    expect(raster.widthDots).toBe(10);
    expect(raster.heightDots).toBe(3);
    expect([...raster.bits]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("prints every dot of an all-black picture, leaving the padding bits clear", () => {
    const raster = ditherToRaster({ width: 10, height: 2, pixels: flat(10, 2, 0) });
    expect([...raster.bits]).toEqual([0xff, 0xc0, 0xff, 0xc0]);
  });

  it("prints about half the dots of a 50% grey, spread over the whole picture rather than in one block", () => {
    const size = 64;
    const raster = ditherToRaster({ width: size, height: size, pixels: flat(size, size, 128) });
    const half = size / 2;
    const quarterArea = half * half;
    for (const [x0, y0] of [
      [0, 0],
      [half, 0],
      [0, half],
      [half, half],
    ] as const) {
      const share = dotsIn(raster, x0, y0, x0 + half, y0 + half) / quarterArea;
      expect(share).toBeGreaterThan(0.4);
      expect(share).toBeLessThan(0.6);
    }
    for (let y = 0; y < size; y++) {
      const share = dotsIn(raster, 0, y, size, y + 1) / size;
      expect(share).toBeGreaterThan(0.3);
      expect(share).toBeLessThan(0.7);
    }
  });

  it("prints more dots for a darker grey than a lighter one", () => {
    const dark = ditherToRaster({ width: 32, height: 32, pixels: flat(32, 32, 64) });
    const light = ditherToRaster({ width: 32, height: 32, pixels: flat(32, 32, 192) });
    expect(dotsIn(dark, 0, 0, 32, 32) / 1024).toBeCloseTo(0.75, 1);
    expect(dotsIn(light, 0, 0, 32, 32) / 1024).toBeCloseTo(0.25, 1);
  });

  it("carries a pixel's error to its neighbours, so a grey pixel next to white ones prints", () => {
    // The first 150 does not print, leaving an error of 150 - 255 = -105; 7/16 of it takes the
    // second to about 104, below the threshold of 128.
    const raster = ditherToRaster({ width: 2, height: 1, pixels: Uint8Array.of(150, 150) });
    expect([dotAt(raster, 0, 0), dotAt(raster, 1, 0)]).toEqual([false, true]);
  });

  it("refuses a pixel buffer whose length is not width × height, or a size that is not a positive integer", () => {
    expect(() => ditherToRaster({ width: 2, height: 2, pixels: flat(3, 1, 0) })).toThrow(
      RangeError,
    );
    expect(() => ditherToRaster({ width: 0, height: 1, pixels: flat(0, 1, 0) })).toThrow(
      RangeError,
    );
    expect(() => ditherToRaster({ width: 1.5, height: 2, pixels: flat(3, 1, 0) })).toThrow(
      RangeError,
    );
  });

  it("names the input it was given when it refuses a size", () => {
    expect(() => ditherToRaster({ width: 0, height: 1, pixels: flat(0, 1, 0) })).toThrow(
      "ditherToRaster width must be an integer >= 1, got 0",
    );
    expect(() => ditherToRaster({ width: 1, height: 0, pixels: flat(1, 0, 0) })).toThrow(
      "ditherToRaster height must be an integer >= 1, got 0",
    );
  });
});
