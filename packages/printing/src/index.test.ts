import { describe, expect, it } from "vitest";
import {
  DOTS_PER_COLUMN,
  TEXT_BAND_HEIGHT,
  chooseQrDots,
  columnsFor,
  dpiValue,
  drawTextBand,
  esc,
  escPosCommands,
  gridForWidth,
  labelAmountLines,
  prepareText,
  QR_QUIET_ZONE,
  readRasterText,
  safeWidthDots,
  textGrid,
  withQuietZone,
  wrapText,
} from "./index.js";

describe("package barrel", () => {
  it("re-exports the layout, text-drawing and command helpers", () => {
    expect(columnsFor("80mm")).toBe(42);
    expect(DOTS_PER_COLUMN).toBe(12);
    expect(safeWidthDots("58mm")).toBe(360);
    expect(dpiValue("203dpi")).toBe(203);
    expect(QR_QUIET_ZONE).toBe(4);
    expect(chooseQrDots(45, 180, 504)).toBe(6);
    expect(prepareText("€\u{202f}日")).toBe("€ ?");
    expect(labelAmountLines("A", "B", 10)).toEqual(["A        B"]);
    expect(wrapText("a b", 1)).toEqual(["a", "b"]);
    expect(withQuietZone([[true]], 1)[1]).toEqual([false, true, false]);
    expect(textGrid("80mm", "203dpi")).toEqual(gridForWidth(576));
    const band = drawTextBand("€", gridForWidth(360));
    expect(readRasterText(360, TEXT_BAND_HEIGHT, band)).toBe("€");
    expect(escPosCommands(esc().init().bytes())).toEqual([{ name: "ESC @", offset: 0, length: 2 }]);
  });
});
