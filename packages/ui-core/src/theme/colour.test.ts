import { describe, expect, test } from "vitest";
import {
  contrastRatio,
  fromOklch,
  hexToRgb,
  relativeLuminance,
  toOklch,
  withLightness,
} from "./colour.js";

const hexByte = (v: number) => v.toString(16).padStart(2, "0");

describe("contrastRatio", () => {
  test("black on white is 21, either way round", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(contrastRatio("#ffffff", "#000000")).toBe(21);
  });

  test("matches the reference for the brand blue on two pale surfaces", () => {
    expect(contrastRatio("#1f6feb", "#f7f7f8").toFixed(2)).toBe("4.33");
    expect(contrastRatio("#1f6feb", "#ffffff").toFixed(2)).toBe("4.63");
  });

  test("reads uppercase hex as the same colour", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBe(21);
  });
});

describe("relativeLuminance", () => {
  test("agrees with the 0.03928 cut-off colors.test.ts used, for every 8-bit channel", () => {
    const old = (hex: string) => {
      const [r, g, b] = [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    for (let v = 0; v <= 255; v++) {
      const grey = `#${hexByte(v).repeat(3)}`;
      expect(relativeLuminance(grey)).toBe(old(grey));
    }
  });
});

describe("toOklch", () => {
  test("pure red", () => {
    const red = toOklch("#ff0000");
    expect(red.L).toBeCloseTo(0.62796, 4);
    expect(red.C).toBeCloseTo(0.25768, 4);
    expect(red.H).toBeCloseTo(0.51023, 4);
  });

  test("black is all zeros", () => {
    expect(toOklch("#000000")).toEqual({ L: 0, C: 0, H: 0 });
  });

  test("white has full lightness and no chroma", () => {
    const white = toOklch("#ffffff");
    expect(white.L).toBeCloseTo(1, 6);
    expect(white.C).toBeLessThan(1e-6);
  });
});

describe("fromOklch", () => {
  test("round-trips every colour of the six-step grid", () => {
    const steps = [0, 51, 102, 153, 204, 255].map(hexByte);
    for (const r of steps) {
      for (const g of steps) {
        for (const b of steps) {
          const hex = `#${r}${g}${b}`;
          expect(fromOklch(toOklch(hex))).toBe(hex);
        }
      }
    }
  });

  test("reduces an out-of-gamut chroma into sRGB", () => {
    expect(fromOklch({ L: 0.7, C: 0.4, H: 2 })).toBe("#9da81c");
  });

  // From the reference's fromOklch; a 61st round, or a 59th-round stop, answers differently
  // (~/waitron-campaign/a841-plan1-probes/t9/rounds.mjs, output-rounds.txt; Task 1's review).
  test("gives up on the chroma after 60 rounds and drops it", () => {
    expect(fromOklch({ L: 0.0978, C: 0.4114, H: -3.0531 })).toBe("#030303");
    expect(fromOklch({ L: 0.0612, C: 0.334, H: -2.5203 })).toBe("#000102");
  });
});

describe("withLightness", () => {
  test("the extremes of lightness are black and white", () => {
    expect(withLightness("#1e5b3a", 0)).toBe("#000000");
    expect(withLightness("#1e5b3a", 1)).toBe("#ffffff");
  });
});

describe("hexToRgb", () => {
  test("reads channels as fractions of 255", () => {
    expect(hexToRgb("#ff0033")).toEqual([1, 0, 0.2]);
  });

  test.each(["#fff", "1f6feb", "#gggggg", "x#1f6feb", "#1f6feb0"])(
    "refuses %s with a RangeError",
    (hex) => {
      expect(() => hexToRgb(hex)).toThrow(RangeError);
    },
  );

  test("names the value it refuses, as given", () => {
    expect(() => hexToRgb("#ABC")).toThrow(new RangeError("not a #rrggbb colour: #ABC"));
  });
});
