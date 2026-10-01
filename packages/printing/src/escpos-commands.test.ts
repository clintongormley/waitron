import { describe, expect, it } from "vitest";
import { escPosCommands } from "./escpos-commands.js";
import { esc } from "./escpos.js";

const DRAWER_PULSE = [0x1b, 0x70, 0x00, 0x19, 0xfa];

/** A 40-dot, one-row image whose five data bytes are exactly the drawer pulse. */
const pulseShapedImage = () =>
  esc().raster(40, 1, (x) => (DRAWER_PULSE[x >> 3]! & (0x80 >> (x & 7))) !== 0);

const names = (payload: Uint8Array) => escPosCommands(payload).map(({ name }) => name);

describe("escPosCommands", () => {
  it("lists each command with where it starts and how many bytes it takes", () => {
    const payload = esc().init().align("center").printArea(512).feed(2).cut().kick().bytes();
    expect(escPosCommands(payload)).toEqual([
      { name: "ESC @", offset: 0, length: 2 },
      { name: "ESC a", offset: 2, length: 3 },
      { name: "GS L", offset: 5, length: 4 },
      { name: "GS W", offset: 9, length: 4 },
      { name: "ESC d", offset: 13, length: 3 },
      { name: "GS V", offset: 16, length: 3 },
      { name: "ESC p", offset: 19, length: 5 },
    ]);
  });

  it("does not report a drawer pulse that is only bytes inside an image", () => {
    const image = pulseShapedImage().bytes();
    expect([...image.slice(8)]).toEqual(DRAWER_PULSE);
    expect(escPosCommands(image)).toEqual([{ name: "GS v 0", offset: 0, length: 13 }]);
  });

  it("reports a drawer pulse sent after the image", () => {
    expect(names(pulseShapedImage().kick().bytes())).toEqual(["GS v 0", "ESC p"]);
  });

  it("does not report a drawer pulse that is only bytes inside stored QR data", () => {
    const qr = esc()
      .qr(String.fromCharCode(...DRAWER_PULSE))
      .bytes();
    expect(names(qr)).toEqual(["GS ( k", "GS ( k", "GS ( k", "GS ( k", "GS ( k"]);
  });

  it("reports text-mode commands and text, so a job can be checked for them", () => {
    const legacy = Uint8Array.from([0x1b, 0x74, 16, 0x1c, 0x2e, 0x43, 0x61, 0x0a, 0x1d, 0x56, 0]);
    expect(escPosCommands(legacy)).toEqual([
      { name: "ESC t", offset: 0, length: 3 },
      { name: "FS .", offset: 3, length: 2 },
      { name: "text", offset: 5, length: 2 },
      { name: "LF", offset: 7, length: 1 },
      { name: "GS V", offset: 8, length: 3 },
    ]);
  });

  it("refuses a command it does not know rather than guess its length", () => {
    expect(() => escPosCommands(Uint8Array.from([0x1b, 0x45, 1]))).toThrow(RangeError);
    expect(() => escPosCommands(Uint8Array.from([0x1d, 0x21, 0]))).toThrow(RangeError);
    expect(() => escPosCommands(Uint8Array.from([0x1c, 0x26]))).toThrow(RangeError);
  });

  it("refuses a command cut short by the end of the payload", () => {
    expect(() => escPosCommands(Uint8Array.from([0x1b]))).toThrow(RangeError);
    expect(() => escPosCommands(Uint8Array.from([0x1b, 0x70, 0]))).toThrow(RangeError);
    expect(() => escPosCommands(Uint8Array.from([0x1d, 0x76, 0x30, 0, 1, 0]))).toThrow(RangeError);
    expect(() => escPosCommands(Uint8Array.from([0x1d, 0x76, 0x30, 0, 1, 0, 2, 0, 0xff]))).toThrow(
      RangeError,
    );
    expect(() => escPosCommands(Uint8Array.from([0x1d, 0x28, 0x6b]))).toThrow(RangeError);
    expect(() => escPosCommands(Uint8Array.from([0x1d, 0x28, 0x6b, 3, 0, 0x31]))).toThrow(
      RangeError,
    );
  });

  it("lists nothing for an empty payload", () => {
    expect(escPosCommands(new Uint8Array())).toEqual([]);
  });
});
