import { describe, expect, it } from "vitest";
import { esc } from "@waitron/printing";
import { opensDrawer } from "./decode-ticket.js";

const REAL_TIME_PULSE = [0x10, 0x14, 0x01, 0x00, 0x05];

describe("opensDrawer", () => {
  it("finds either drawer pulse, and neither in a ticket without one", () => {
    expect(opensDrawer(esc().init().kick().bytes())).toBe(true);
    expect(opensDrawer(Uint8Array.from([0x1b, 0x40, ...REAL_TIME_PULSE]))).toBe(true);
    expect(opensDrawer(esc().init().feedAndCut().bytes())).toBe(false);
  });

  it("is not fooled by a pulse's bytes inside an image", () => {
    const image = esc()
      .raster(40, 1, (x) => (REAL_TIME_PULSE[x >> 3]! & (0x80 >> (x & 7))) !== 0)
      .bytes();
    expect(opensDrawer(image)).toBe(false);
  });
});
