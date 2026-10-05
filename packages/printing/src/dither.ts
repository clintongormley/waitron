/** The tallest a receipt logo prints: 20 mm at 203 dpi, 22.6 mm at 180 dpi. */
export const LOGO_MAX_HEIGHT_DOTS = 160;

/** A 1-bit picture: rows MSB-first, a set bit prints, each row zero-padded to a whole byte. */
export interface MonoRaster {
  widthDots: number;
  heightDots: number;
  bits: Uint8Array;
}

const THRESHOLD = 128;

function assertSize(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be an integer >= 1, got ${value}`);
  }
}

/**
 * Floyd–Steinberg dithering of an 8-bit greyscale picture (0 black, 255 white, one byte per pixel,
 * row by row): a pixel below {@link THRESHOLD} prints, and its error passes 7/16 right, 3/16 down
 * left, 5/16 down and 1/16 down right.
 */
export function ditherToRaster(input: {
  width: number;
  height: number;
  pixels: Uint8Array;
}): MonoRaster {
  const { width, height, pixels } = input;
  assertSize("width", width);
  assertSize("height", height);
  if (pixels.length !== width * height) {
    throw new RangeError(
      `expected ${width * height} greyscale pixels for ${width} × ${height}, got ${pixels.length}`,
    );
  }
  const values = Float32Array.from(pixels);
  const stride = Math.ceil(width / 8);
  const bits = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      const old = values[at]!;
      const prints = old < THRESHOLD;
      if (prints) bits[y * stride + (x >> 3)]! |= 0x80 >> (x & 7);
      const error = old - (prints ? 0 : 255);
      if (x + 1 < width) values[at + 1]! += (error * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) values[at + width - 1]! += (error * 3) / 16;
        values[at + width]! += (error * 5) / 16;
        if (x + 1 < width) values[at + width + 1]! += error / 16;
      }
    }
  }
  return { widthDots: width, heightDots: height, bits };
}
