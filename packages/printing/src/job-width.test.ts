import { describe, expect, it } from "vitest";
import { esc, type EscSetting } from "./escpos.js";
import { SETTING_WIDTHS } from "./layout.js";
import { centredForPrinter, jobWidthDots } from "./job-width.js";
import { escPosCommands } from "./testing/escpos-commands.js";

/** Every command the builder sends, so each step of the walk is crossed. */
function ticket(setting: EscSetting, widthDots: number): Uint8Array {
  return esc(setting)
    .init()
    .printArea(widthDots)
    .align("center")
    .line("Table 4")
    .qr("https://example.test/q")
    .bitmap({ widthDots: 16, heightDots: 1, bits: Uint8Array.of(0x1b, 0x40) })
    .kick()
    .feedAndCut()
    .bytes();
}

function joined(...parts: Uint8Array[]): Uint8Array {
  return Uint8Array.from(parts.flatMap((part) => [...part]));
}

const setting58: EscSetting = { paperWidth: "58mm", resolution: "180dpi" };

/** The payload with each real `GS L`'s margin, found by the test oracle, set to `margin`. */
function withMargins(payload: Uint8Array, margin: number): number[] {
  const expected = [...payload];
  for (const command of escPosCommands(payload)) {
    if (command.name === "GS L") {
      expected[command.offset + 2] = margin & 0xff;
      expected[command.offset + 3] = margin >> 8;
    }
  }
  return expected;
}

describe("jobWidthDots", () => {
  it.each(SETTING_WIDTHS)(
    "reads $widthDots dots from a $paperWidth $resolution printout and from its first ten bytes",
    ({ paperWidth, resolution, widthDots }) => {
      const payload = ticket({ paperWidth, resolution }, widthDots);
      expect(jobWidthDots(payload)).toBe(widthDots);
      expect(jobWidthDots(payload.slice(0, 10))).toBe(widthDots);
    },
  );

  it.each([
    ["cut inside a fixed-length command", ticket(setting58, 360).slice(0, -1)],
    ["cut inside an image's data", ticket(setting58, 360).slice(0, 20)],
    ["cut after a command's first byte", joined(ticket(setting58, 360), Uint8Array.of(0x1d))],
    [
      "holding a command the builder never sends",
      joined(ticket(setting58, 360), Uint8Array.of(0x1b, 0x74, 0x00)),
    ],
    ["holding plain text", joined(ticket(setting58, 360), Uint8Array.of(0x41))],
    ["with no print area", esc(setting58).init().line("Hi").feedAndCut().bytes()],
    ["with two print-area widths", joined(ticket(setting58, 360), ticket(setting58, 384))],
  ])("answers null for a payload %s", (_case, payload) => {
    expect(jobWidthDots(payload)).toBeNull();
  });
});

describe("centredForPrinter", () => {
  it.each([
    [360, 512, 76],
    [384, 576, 96],
    [512, 512, 0],
  ])("moves a %i-dot printout onto a %i-dot printer with a %i-dot margin", (job, dots, margin) => {
    const payload = ticket(setting58, job);
    expect([...centredForPrinter(payload, dots)]).toEqual(withMargins(payload, margin));
  });

  it("sets the margin of every print area, as a joined kitchen ticket has two", () => {
    const payload = joined(ticket(setting58, 360), ticket(setting58, 360).slice(2));
    expect(escPosCommands(payload).filter(({ name }) => name === "GS L")).toHaveLength(2);
    expect([...centredForPrinter(payload, 512)]).toEqual(withMargins(payload, 76));
  });

  it("leaves image bytes that look like a margin command alone", () => {
    const payload = esc(setting58)
      .init()
      .printArea(360)
      .bitmap({ widthDots: 32, heightDots: 1, bits: Uint8Array.of(0x1d, 0x4c, 0x00, 0x00) })
      .feedAndCut()
      .bytes();
    const centred = centredForPrinter(payload, 512);
    expect([...centred]).toEqual(withMargins(payload, 76));
    expect([...centred.slice(18, 22)]).toEqual([0x1d, 0x4c, 0x00, 0x00]);
    expect([...payload.slice(2, 6)]).toEqual([0x1d, 0x4c, 0x00, 0x00]);
  });

  it.each([
    ["wider than the printer", ticket(setting58, 512), 384],
    ["unrecognised", Uint8Array.of(0x41), 512],
  ])("refuses a printout %s", (_case, payload, dots) => {
    expect(() => centredForPrinter(payload, dots)).toThrow(RangeError);
  });
});
